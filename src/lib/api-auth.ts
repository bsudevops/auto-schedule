import "server-only";
import { and, eq, gt, isNotNull, isNull, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { apiKeys, organizations, workspaceMembers, workspaces } from "@/db/schema";
import { sha256 } from "./crypto";
import type { Member } from "./permissions";
import { redis } from "./redis";

export const API_SCOPES = {
  "posts:read": "Read posts",
  "posts:write": "Create, schedule and delete posts",
  "channels:read": "Read connected channels",
  "analytics:read": "Read analytics",
} as const;
export type ApiScope = keyof typeof API_SCOPES;

export type ApiContext = { keyId: string; member: Member; workspace: typeof workspaces.$inferSelect; scopes: string[] };

export const apiError = (status: number, error: string, extra?: Record<string, string>) =>
  NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store", ...extra } });

const PER_MINUTE = Number(process.env.API_RATE_LIMIT_PER_MINUTE ?? 120);

/**
 * Checks the Bearer key, its scope, and that the person who created it is still a member.
 * The key acts with that person's current role, so it can never do more than they can.
 */
export async function authenticate(req: Request, scope: ApiScope | null): Promise<ApiContext | NextResponse> {
  const header = req.headers.get("authorization") ?? "";
  const m = header.match(/^Bearer\s+(\S+)$/i);
  if (!m) return apiError(401, "Send your API key as: Authorization: Bearer <key>", { "WWW-Authenticate": "Bearer" });
  const [row] = await db
    .select({ key: apiKeys, workspace: workspaces, role: workspaceMembers.role })
    .from(apiKeys)
    .innerJoin(workspaces, eq(workspaces.id, apiKeys.workspaceId))
    .innerJoin(organizations, eq(organizations.id, workspaces.orgId))
    .innerJoin(workspaceMembers, and(eq(workspaceMembers.workspaceId, apiKeys.workspaceId), eq(workspaceMembers.userId, apiKeys.createdBy)))
    .where(and(eq(apiKeys.keyHash, sha256(m[1]!)), isNull(apiKeys.revokedAt), or(isNull(apiKeys.expiresAt), gt(apiKeys.expiresAt, new Date())), isNull(workspaces.archivedAt), isNull(organizations.deletionRequestedAt)));
  if (!row) return apiError(401, "That API key isn't valid, expired, was revoked, or its creator left the workspace.", { "WWW-Authenticate": "Bearer" });
  if (scope && !row.key.scopes.includes(scope)) return apiError(403, `This key doesn't have the ${scope} scope.`);

  const limited = await rateLimit(row.key.id);
  if (limited) return limited;
  await touch(row.key);
  return { keyId: row.key.id, member: { userId: row.key.createdBy, role: row.role, active: true }, workspace: row.workspace, scopes: row.key.scopes };
}

/** Per-key rate limit. Returns the 429 response when the key is over it. */
async function rateLimit(keyId: string): Promise<NextResponse | null> {
  try {
    const bucket = `rl:api:${keyId}:${Math.floor(Date.now() / 60_000)}`;
    const n = await redis().incr(bucket);
    if (n === 1) await redis().expire(bucket, 90);
    if (n > PER_MINUTE) return apiError(429, `Rate limit: ${PER_MINUTE} requests a minute.`, { "Retry-After": String(60 - (Math.floor(Date.now() / 1000) % 60)) });
  } catch {
    // If Redis is down, serve the request rather than fail it.
  }
  return null;
}

async function touch(key: { id: string; lastUsedAt: Date | null }) {
  if (!key.lastUsedAt || Date.now() - key.lastUsedAt.getTime() > 60_000) {
    await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, key.id));
  }
}

/** A connected app's token that covers every workspace its person owns or manages. Each tool call names the workspace. */
export type AccountContext = { keyId: string; userId: string; scopes: string[] };

/**
 * Checks a Bearer token issued to a connected app for all workspaces. Returns null when the token is
 * anything else (such as a workspace API key), so the caller can fall back to authenticate().
 */
export async function authenticateAccount(req: Request): Promise<AccountContext | NextResponse | null> {
  const m = (req.headers.get("authorization") ?? "").match(/^Bearer\s+(\S+)$/i);
  if (!m) return null;
  const [key] = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.keyHash, sha256(m[1]!)), isNull(apiKeys.workspaceId), isNotNull(apiKeys.oauthClientId), isNull(apiKeys.revokedAt), gt(apiKeys.expiresAt, new Date())));
  if (!key) return null;
  const limited = await rateLimit(key.id);
  if (limited) return limited;
  await touch(key);
  return { keyId: key.id, userId: key.createdBy, scopes: key.scopes };
}
