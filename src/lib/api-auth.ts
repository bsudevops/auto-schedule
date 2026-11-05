import "server-only";
import { and, eq, gt, isNull, or } from "drizzle-orm";
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

  try {
    const bucket = `rl:api:${row.key.id}:${Math.floor(Date.now() / 60_000)}`;
    const n = await redis().incr(bucket);
    if (n === 1) await redis().expire(bucket, 90);
    if (n > PER_MINUTE) return apiError(429, `Rate limit: ${PER_MINUTE} requests a minute.`, { "Retry-After": String(60 - (Math.floor(Date.now() / 1000) % 60)) });
  } catch {
    // If Redis is down, serve the request rather than fail it.
  }
  if (!row.key.lastUsedAt || Date.now() - row.key.lastUsedAt.getTime() > 60_000) {
    await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.key.id));
  }
  return { keyId: row.key.id, member: { userId: row.key.createdBy, role: row.role, active: true }, workspace: row.workspace, scopes: row.key.scopes };
}
