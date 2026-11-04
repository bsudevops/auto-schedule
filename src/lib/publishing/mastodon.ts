import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { mastodonApps } from "@/db/schema";
import { decryptSecret, encryptSecret } from "../crypto";
import { checkWebhookUrl, safeRequest } from "../safe-http";
import { form, kindForStatus, poll, type HttpResponse } from "./http";
import { PublishError, type ConnectContext, type ConnectedAccount, type ProviderAdapter, type PublishInput, type PublishResult, type Publisher } from "./types";

/**
 * Mastodon and other servers that speak its API. The person names their server; we register an app
 * there on first use and sign in with OAuth. Every request goes through safeRequest, because the
 * server address comes from the customer.
 */
const SCOPES = "read write";

/** "mastodon.social", "@me@mastodon.social" or "https://mastodon.social/@me" all become "mastodon.social". */
export function normaliseInstance(input: string): string | null {
  let s = input.trim().toLowerCase();
  if (!s) return null;
  const at = s.match(/^@?[^@\s/]+@([^@\s/]+)$/);
  if (at) s = at[1]!;
  s = s.replace(/^https?:\/\//, "").split(/[/?#]/)[0]!.replace(/:\d+$/, "");
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(s) || s.includes("..")) return null;
  return s;
}

async function req(method: string, instance: string, path: string, opts: { token?: string; form?: Record<string, string>; json?: unknown; body?: Buffer; contentType?: string; timeoutMs?: number; idempotency?: string } = {}): Promise<HttpResponse> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.idempotency) headers["Idempotency-Key"] = opts.idempotency;
  let body: string | Buffer | undefined;
  if (opts.form) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    body = form(opts.form).toString();
  } else if (opts.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.json);
  } else if (opts.body) {
    headers["Content-Type"] = opts.contentType!;
    body = opts.body;
  }
  let r: Awaited<ReturnType<typeof safeRequest>>;
  try {
    r = await safeRequest(`https://${instance}${path}`, { method, headers, body, timeoutMs: opts.timeoutMs ?? 30_000 });
  } catch (e) {
    throw new PublishError(`Couldn't reach ${instance}: ${(e as Error).message}`, "temporary");
  }
  let parsed: unknown = null;
  try { parsed = r.text ? JSON.parse(r.text) : null; } catch { parsed = null; }
  return { status: r.status, headers: new Headers(r.headers), body: parsed, text: r.text };
}

export function mastodonError(res: HttpResponse, action: string): PublishError {
  const b = res.body as { error?: string; error_description?: string } | null;
  const msg = b?.error_description || b?.error || `HTTP ${res.status}`;
  if (res.status === 401 || res.status === 403) return new PublishError(`${action}: the Mastodon server rejected the access token. Reconnect the channel.`, "auth", b);
  if (res.status === 429) return new PublishError(`${action}: the Mastodon server's rate limit was reached. We'll retry later.`, "rate", b);
  return new PublishError(`${action}: ${msg}`, kindForStatus(res.status), b);
}

/** Finds or registers our app on the server. */
async function appFor(instance: string, redirectUri: string) {
  const [row] = await db.select().from(mastodonApps).where(and(eq(mastodonApps.instance, instance), eq(mastodonApps.redirectUri, redirectUri)));
  if (row) return { clientId: row.clientId, clientSecret: decryptSecret(row.clientSecretEnc) };
  const res = await req("POST", instance, "/api/v1/apps", {
    form: { client_name: process.env.NEXT_PUBLIC_BRAND_NAME || "BSU Scheduler", redirect_uris: redirectUri, scopes: SCOPES, website: process.env.APP_URL ?? "" },
  });
  if (res.status >= 400) throw mastodonError(res, `Registering with ${instance}`);
  const b = res.body as { client_id?: string; client_secret?: string };
  if (!b?.client_id || !b.client_secret) throw new PublishError(`${instance} didn't return app credentials. Is it a Mastodon server?`, "permanent");
  await db.insert(mastodonApps).values({ instance, redirectUri, clientId: b.client_id, clientSecretEnc: encryptSecret(b.client_secret) }).onConflictDoNothing();
  const [saved] = await db.select().from(mastodonApps).where(and(eq(mastodonApps.instance, instance), eq(mastodonApps.redirectUri, redirectUri)));
  return { clientId: saved!.clientId, clientSecret: decryptSecret(saved!.clientSecretEnc) };
}

const instanceOf = (ctx?: ConnectContext) => {
  const i = normaliseInstance(ctx?.instance ?? "");
  if (!i) throw new PublishError("Missing Mastodon server.", "permanent");
  return i;
};

export const mastodonProvider: ProviderAdapter = {
  id: "mastodon",
  name: "Mastodon",
  platforms: ["mastodon"],
  envVars: [],
  configured: () => true,
  contextFields: [{ name: "instance", label: "Your Mastodon server", type: "text", placeholder: "mastodon.social", help: "The address of the server your account is on." }],
  async prepareContext(input, redirectUri) {
    const instance = normaliseInstance(input.instance ?? "");
    if (!instance) return { ok: false, error: "Enter your server's address, like mastodon.social." };
    const check = checkWebhookUrl(`https://${instance}/`);
    if (!check.ok) return { ok: false, error: "That server address isn't reachable on the public internet." };
    try {
      const info = await req("GET", instance, "/api/v2/instance", { timeoutMs: 10_000 });
      if (info.status >= 400 || !(info.body as { domain?: string } | null)?.domain) {
        const v1 = await req("GET", instance, "/api/v1/instance", { timeoutMs: 10_000 });
        if (v1.status >= 400 || !(v1.body as { uri?: string } | null)?.uri) return { ok: false, error: `${instance} doesn't look like a Mastodon server.` };
      }
      await appFor(instance, redirectUri);
    } catch (e) {
      return { ok: false, error: e instanceof PublishError ? e.message : `Couldn't reach ${instance}.` };
    }
    return { ok: true, ctx: { instance } };
  },
  async authorizeUrl(state, redirectUri, ctx) {
    const instance = instanceOf(ctx);
    const app = await appFor(instance, redirectUri);
    return `https://${instance}/oauth/authorize?${form({ client_id: app.clientId, redirect_uri: redirectUri, response_type: "code", scope: SCOPES, state })}`;
  },
  async exchangeCode(code, redirectUri, ctx) {
    const instance = instanceOf(ctx);
    const app = await appFor(instance, redirectUri);
    const res = await req("POST", instance, "/oauth/token", {
      form: { grant_type: "authorization_code", code, client_id: app.clientId, client_secret: app.clientSecret, redirect_uri: redirectUri, scope: SCOPES },
    });
    if (res.status >= 400) throw mastodonError(res, "Signing in to Mastodon");
    const token = (res.body as { access_token: string }).access_token;
    const me = await req("GET", instance, "/api/v1/accounts/verify_credentials", { token });
    if (me.status >= 400) throw mastodonError(me, "Reading your Mastodon profile");
    const u = me.body as { id: string; username: string; display_name?: string; avatar?: string; followers_count?: number };
    const account: ConnectedAccount = {
      platform: "mastodon",
      externalId: `${instance}:${u.id}`,
      handle: `${u.username}@${instance}`,
      displayName: u.display_name || u.username,
      avatarUrl: u.avatar ?? null,
      followers: u.followers_count ?? null,
      accessToken: token,
      refreshToken: null,
      expiresAt: null,
      meta: { instance, accountId: u.id },
    };
    return [account];
  },
};

function multipart(fields: Record<string, string>, file: { name: string; type: string; data: Buffer }) {
  const boundary = `----bsu${randomUUID().replace(/-/g, "")}`;
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`), file.data, Buffer.from(`\r\n--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

export const mastodonPublisher: Publisher = {
  async publish({ channel, accessToken: token, caption, firstComment, media }: PublishInput): Promise<PublishResult> {
    const instance = String(channel.meta.instance ?? "");
    if (!normaliseInstance(instance)) throw new PublishError("This Mastodon channel has no server saved. Reconnect it.", "auth");
    if (media.length > 4) throw new PublishError("Mastodon posts can have at most 4 attachments.", "permanent");
    if (!caption.trim() && !media.length) throw new PublishError("Mastodon posts need text or media.", "permanent");

    const mediaIds: string[] = [];
    for (const m of media) {
      const file = await fetch(m.url, { signal: AbortSignal.timeout(300_000) }).catch(() => null);
      if (!file?.ok) throw new PublishError("Couldn't read the file from storage.", "temporary");
      const data = Buffer.from(await file.arrayBuffer());
      const { body, contentType } = multipart(m.altText ? { description: m.altText.slice(0, 1500) } : {}, { name: m.kind === "video" ? "video.mp4" : "image.jpg", type: m.mimeType, data });
      const up = await req("POST", instance, "/api/v2/media", { token, body, contentType, timeoutMs: 300_000 });
      if (up.status >= 400) throw mastodonError(up, "Uploading media to Mastodon");
      const att = up.body as { id: string; url: string | null };
      if (up.status === 202 || !att.url) {
        await poll(
          async () => {
            const s = await req("GET", instance, `/api/v1/media/${att.id}`, { token });
            if (s.status === 200 && (s.body as { url?: string | null }).url) return true;
            if (s.status >= 400 && s.status !== 206) throw mastodonError(s, "Checking the Mastodon upload");
            return undefined;
          },
          { attempts: 60, intervalMs: 5_000, what: "The Mastodon media" },
        );
      }
      mediaIds.push(att.id);
    }

    const visibility = String(channel.meta.visibility ?? "public");
    const res = await req("POST", instance, "/api/v1/statuses", { token, json: { status: caption, media_ids: mediaIds, visibility }, idempotency: randomUUID() });
    if (res.status >= 400) throw mastodonError(res, "Posting to Mastodon");
    const st = res.body as { id: string; url?: string | null; uri: string };
    const warnings: string[] = [];
    if (firstComment.trim()) {
      const r = await req("POST", instance, "/api/v1/statuses", { token, json: { status: firstComment, in_reply_to_id: st.id, visibility }, idempotency: randomUUID() });
      if (r.status >= 400) warnings.push(`The first reply wasn't added: ${mastodonError(r, "Replying").message}`);
    }
    return { externalId: st.id, url: st.url ?? st.uri, warnings };
  },
};

export async function mastodonFollowers(instance: string, accountId: string, token: string): Promise<number | null> {
  const r = await req("GET", instance, `/api/v1/accounts/${encodeURIComponent(accountId)}`, { token });
  if (r.status >= 400) throw mastodonError(r, "Reading followers");
  return (r.body as { followers_count?: number }).followers_count ?? null;
}

export async function mastodonPostFigures(instance: string, statusId: string, token: string) {
  const r = await req("GET", instance, `/api/v1/statuses/${encodeURIComponent(statusId)}`, { token });
  if (r.status >= 400) throw mastodonError(r, "Reading post figures");
  const s = r.body as { favourites_count?: number; reblogs_count?: number; replies_count?: number };
  return { likes: s.favourites_count ?? null, shares: s.reblogs_count ?? null, comments: s.replies_count ?? null };
}
