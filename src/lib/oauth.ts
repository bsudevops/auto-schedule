import "server-only";
import { and, eq, gt, isNull } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import { db } from "@/db";
import { apiKeys, oauthClients, oauthCodes, oauthGrants, workspaceMembers } from "@/db/schema";
import { API_SCOPES } from "./api-auth";
import { newApiKey, safeEqualHex, sha256 } from "./crypto";
import { can } from "./permissions";

/**
 * OAuth 2.1 sign-in for the MCP server, so assistants such as Claude can connect without a pasted key.
 * The person signs in, picks one workspace and the permissions, and the app gets a one-hour access
 * token (stored as an API key, so every existing check applies) plus a refresh token that rotates on each use.
 */

export const ACCESS_TTL_S = 3600;
const REFRESH_TTL_MS = 90 * 24 * 3600 * 1000;
const CODE_TTL_MS = 10 * 60 * 1000;

export const issuer = () => (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
export const mcpResource = () => `${issuer()}/api/mcp`;
export const resourceMetadataUrl = () => `${issuer()}/.well-known/oauth-protected-resource`;
const ALL_SCOPES = Object.keys(API_SCOPES);

export const protectedResourceMetadata = () => ({
  resource: mcpResource(),
  authorization_servers: [issuer()],
  scopes_supported: ALL_SCOPES,
  bearer_methods_supported: ["header"],
  resource_name: "BSU Scheduler",
});

export const authorizationServerMetadata = () => ({
  issuer: issuer(),
  authorization_endpoint: `${issuer()}/oauth/authorize`,
  token_endpoint: `${issuer()}/oauth/token`,
  registration_endpoint: `${issuer()}/oauth/register`,
  scopes_supported: ALL_SCOPES,
  response_types_supported: ["code"],
  grant_types_supported: ["authorization_code", "refresh_token"],
  code_challenge_methods_supported: ["S256"],
  token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
});

export class OAuthError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

/** Redirect addresses must be HTTPS, or http on this computer for local tools. No fragments. */
export function validRedirectUri(raw: unknown): raw is string {
  if (typeof raw !== "string" || raw.length > 500) return false;
  try {
    const u = new URL(raw);
    if (u.hash) return false;
    if (u.protocol === "https:") return true;
    return u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  } catch {
    return false;
  }
}

/** Requested scopes, limited to the ones that exist. No scope asked for means all of them. */
export function parseScopes(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return [...ALL_SCOPES];
  const asked = raw.trim().split(/\s+/);
  return ALL_SCOPES.filter((s) => asked.includes(s));
}

export const pkceChallenge = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

export function verifyPkce(verifier: string | null | undefined, challenge: string): boolean {
  if (!verifier || !/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return false;
  return Buffer.from(pkceChallenge(verifier)).equals(Buffer.from(challenge));
}

/** A resource indicator, when sent, must name this MCP server. */
export function resourceOk(resource: string | null | undefined): boolean {
  if (!resource) return true;
  return resource.replace(/\/$/, "") === mcpResource();
}

const token = (prefix: string) => `${prefix}${randomBytes(32).toString("base64url")}`;

/** RFC 7591 dynamic client registration. */
export async function registerClient(body: Record<string, unknown>) {
  const uris = body.redirect_uris;
  if (!Array.isArray(uris) || !uris.length || uris.length > 10 || !uris.every(validRedirectUri)) {
    throw new OAuthError("invalid_redirect_uri", "Send 1 to 10 redirect_uris, each HTTPS (or http on localhost).");
  }
  const method = typeof body.token_endpoint_auth_method === "string" ? body.token_endpoint_auth_method : "client_secret_basic";
  if (!["none", "client_secret_post", "client_secret_basic"].includes(method)) {
    throw new OAuthError("invalid_client_metadata", "token_endpoint_auth_method must be none, client_secret_post or client_secret_basic.");
  }
  const name = typeof body.client_name === "string" && body.client_name.trim() ? body.client_name.trim().slice(0, 80) : "AI assistant";
  const id = token("bsuc_");
  const secret = method === "none" ? null : token("bsucs_");
  await db.insert(oauthClients).values({ id, name, redirectUris: uris as string[], secretHash: secret ? sha256(secret) : null });
  return {
    client_id: id,
    ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: name,
    redirect_uris: uris,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: method,
  };
}

export async function getClient(id: string | null | undefined) {
  if (!id) return undefined;
  const [c] = await db.select().from(oauthClients).where(eq(oauthClients.id, id));
  return c;
}

/** Checks the client's secret if it has one. Public clients rely on PKCE. */
export async function authenticateClient(id: string | null, secret: string | null) {
  const c = await getClient(id);
  if (!c) throw new OAuthError("invalid_client", "Unknown client.", 401);
  if (c.secretHash && (!secret || !safeEqualHex(sha256(secret), c.secretHash))) throw new OAuthError("invalid_client", "Wrong client secret.", 401);
  return c;
}

/** The person can connect an app to a workspace only if they could create an API key there. */
export async function canConnect(userId: string, workspaceId: string): Promise<boolean> {
  const [m] = await db.select().from(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)));
  return !!m && can({ userId, role: m.role, active: true }, "manage_api");
}

export async function createCode(v: { clientId: string; userId: string; workspaceId: string; scopes: string[]; redirectUri: string; codeChallenge: string; resource: string | null }) {
  const code = token("bsuo_");
  await db.insert(oauthCodes).values({ ...v, codeHash: sha256(code), expiresAt: new Date(Date.now() + CODE_TTL_MS) });
  return code;
}

async function issueAccess(clientId: string, clientName: string, userId: string, workspaceId: string, scopes: string[]) {
  const k = newApiKey();
  const [row] = await db
    .insert(apiKeys)
    .values({ workspaceId, name: clientName, prefix: k.prefix, keyHash: k.hash, scopes, createdBy: userId, expiresAt: new Date(Date.now() + ACCESS_TTL_S * 1000), oauthClientId: clientId })
    .returning({ id: apiKeys.id });
  return { key: k.key, id: row!.id };
}

const tokenResponse = (access: string, refresh: string, scopes: string[]) => ({
  access_token: access,
  token_type: "Bearer",
  expires_in: ACCESS_TTL_S,
  refresh_token: refresh,
  scope: scopes.join(" "),
});

export async function exchangeCode(client: { id: string; name: string }, p: { code: string | null; redirectUri: string | null; verifier: string | null; resource: string | null }) {
  if (!p.code) throw new OAuthError("invalid_request", "code is missing.");
  // Claim the code atomically so it can be used once only.
  const [c] = await db
    .update(oauthCodes)
    .set({ usedAt: new Date() })
    .where(and(eq(oauthCodes.codeHash, sha256(p.code)), isNull(oauthCodes.usedAt), gt(oauthCodes.expiresAt, new Date())))
    .returning();
  if (!c || c.clientId !== client.id) throw new OAuthError("invalid_grant", "That code is invalid, expired or already used.");
  if (p.redirectUri !== c.redirectUri) throw new OAuthError("invalid_grant", "redirect_uri doesn't match the one used to sign in.");
  if (!verifyPkce(p.verifier, c.codeChallenge)) throw new OAuthError("invalid_grant", "code_verifier doesn't match.");
  if (!resourceOk(p.resource)) throw new OAuthError("invalid_target", "Unknown resource.");
  if (!(await canConnect(c.userId, c.workspaceId))) throw new OAuthError("invalid_grant", "You no longer manage that workspace.");
  const access = await issueAccess(client.id, client.name, c.userId, c.workspaceId, c.scopes);
  const refresh = token("bsur_");
  await db.insert(oauthGrants).values({
    clientId: client.id,
    userId: c.userId,
    workspaceId: c.workspaceId,
    scopes: c.scopes,
    refreshHash: sha256(refresh),
    refreshExpiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    accessKeyId: access.id,
    lastUsedAt: new Date(),
  });
  return tokenResponse(access.key, refresh, c.scopes);
}

export async function refreshGrant(client: { id: string; name: string }, refreshToken: string | null, scope: string | null) {
  if (!refreshToken) throw new OAuthError("invalid_request", "refresh_token is missing.");
  const next = token("bsur_");
  // Rotate atomically: the old refresh token stops working the moment it is used.
  const [g] = await db
    .update(oauthGrants)
    .set({ refreshHash: sha256(next), refreshExpiresAt: new Date(Date.now() + REFRESH_TTL_MS), lastUsedAt: new Date() })
    .where(and(eq(oauthGrants.refreshHash, sha256(refreshToken)), eq(oauthGrants.clientId, client.id), isNull(oauthGrants.revokedAt), gt(oauthGrants.refreshExpiresAt, new Date())))
    .returning();
  if (!g) throw new OAuthError("invalid_grant", "That refresh token is invalid, expired or was revoked.");
  if (!(await canConnect(g.userId, g.workspaceId))) {
    await revokeGrant(g.id);
    throw new OAuthError("invalid_grant", "You no longer manage that workspace.");
  }
  // A refresh may narrow the scopes, never widen them.
  const scopes = scope ? parseScopes(scope).filter((s) => g.scopes.includes(s)) : g.scopes;
  if (g.accessKeyId) await db.update(apiKeys).set({ revokedAt: new Date() }).where(and(eq(apiKeys.id, g.accessKeyId), isNull(apiKeys.revokedAt)));
  const access = await issueAccess(client.id, client.name, g.userId, g.workspaceId, scopes);
  await db.update(oauthGrants).set({ accessKeyId: access.id }).where(eq(oauthGrants.id, g.id));
  return tokenResponse(access.key, next, scopes);
}

/** Disconnects an app: its refresh token and current access token stop working at once. */
export async function revokeGrant(grantId: string) {
  const [g] = await db.update(oauthGrants).set({ revokedAt: new Date() }).where(and(eq(oauthGrants.id, grantId), isNull(oauthGrants.revokedAt))).returning();
  if (g?.accessKeyId) await db.update(apiKeys).set({ revokedAt: new Date() }).where(eq(apiKeys.id, g.accessKeyId));
  return !!g;
}
