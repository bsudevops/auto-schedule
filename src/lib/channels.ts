import "server-only";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "@/db";
import { channels, pendingConnections } from "@/db/schema";
import { decryptSecret, encryptSecret } from "./crypto";
import type { ConnectContext, ConnectedAccount, Provider } from "./publishing/types";

export const CONNECT_COOKIE = "oauth_connect";
export const CALLBACK_PATH = "/api/channels/callback";
const TEN_MINUTES = 600;

type ConnectState = { state: string; workspaceId: string; provider: Provider; userId: string; exp: number; ctx?: ConnectContext };

/** The OAuth state lives in an encrypted, httpOnly cookie, bound to the user, workspace and provider. */
export function newConnectState(workspaceId: string, provider: Provider, userId: string, ctx?: ConnectContext) {
  const state = randomBytes(24).toString("base64url");
  const cookie = encryptSecret(JSON.stringify({ state, workspaceId, provider, userId, exp: Date.now() + TEN_MINUTES * 1000, ...(ctx ? { ctx } : {}) } satisfies ConnectState));
  return {
    state,
    cookie: {
      name: CONNECT_COOKIE,
      value: cookie,
      options: { httpOnly: true, sameSite: "lax" as const, secure: (process.env.APP_URL ?? "").startsWith("https://"), path: CALLBACK_PATH, maxAge: TEN_MINUTES },
    },
  };
}

export function readConnectState(cookieValue: string | undefined, provider: string, stateParam: string | null, userId: string): ConnectState | null {
  if (!cookieValue || !stateParam) return null;
  let s: ConnectState;
  try {
    s = JSON.parse(decryptSecret(cookieValue)) as ConnectState;
  } catch {
    return null;
  }
  const a = Buffer.from(s.state);
  const b = Buffer.from(stateParam);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (s.provider !== provider || s.userId !== userId || s.exp < Date.now()) return null;
  return s;
}

export async function savePending(workspaceId: string, userId: string, provider: Provider, accounts: ConnectedAccount[]) {
  const [row] = await db
    .insert(pendingConnections)
    .values({ workspaceId, userId, provider, payloadEnc: encryptSecret(JSON.stringify(accounts)), expiresAt: new Date(Date.now() + 15 * 60_000) })
    .returning({ id: pendingConnections.id });
  return row!.id;
}

export async function loadPending(id: string, workspaceId: string, userId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await db
    .select()
    .from(pendingConnections)
    .where(and(eq(pendingConnections.id, id), eq(pendingConnections.workspaceId, workspaceId), eq(pendingConnections.userId, userId), gt(pendingConnections.expiresAt, new Date())));
  if (!row) return null;
  return { id: row.id, provider: row.provider as Provider, accounts: JSON.parse(decryptSecret(row.payloadEnc)) as ConnectedAccount[] };
}

export const accountKey = (a: { platform: string; externalId: string }) => `${a.platform}:${a.externalId}`;

/** Adds or renews channels. Reconnecting an account that's already in the workspace updates its tokens in place. */
export async function saveChannels(workspaceId: string, userId: string, accounts: ConnectedAccount[]) {
  for (const a of accounts) {
    const values = {
      handle: a.handle,
      displayName: a.displayName,
      avatarUrl: a.avatarUrl,
      followers: a.followers,
      accessTokenEnc: encryptSecret(a.accessToken),
      refreshTokenEnc: a.refreshToken ? encryptSecret(a.refreshToken) : null,
      tokenExpiresAt: a.expiresAt ? new Date(a.expiresAt) : null,
      meta: a.meta,
      status: "connected" as const,
      lastError: null,
      connectedBy: userId,
    };
    await db
      .insert(channels)
      .values({ workspaceId, platform: a.platform, externalId: a.externalId, ...values })
      .onConflictDoUpdate({ target: [channels.workspaceId, channels.platform, channels.externalId], set: { ...values, updatedAt: sql`now()` } });
  }
}
