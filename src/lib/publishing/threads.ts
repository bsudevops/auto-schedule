import { env, form, http, kindForStatus, poll, type HttpResponse } from "./http";
import { PublishError, type ConnectedAccount, type ProviderAdapter, type PublishInput, type PublishMedia, type PublishResult, type Publisher, type TokenSet } from "./types";

/**
 * Threads, through Meta's Threads API (graph.threads.net). Its own app ID and secret, separate from Facebook's.
 * Posting is two steps: create a container, wait for it to finish processing, then publish it.
 * Long-lived tokens last 60 days and are renewed with the token itself.
 */
const GRAPH = "https://graph.threads.net";
const VERSION = () => env("THREADS_API_VERSION") || "v1.0";
const SCOPES = "threads_basic,threads_content_publish,threads_manage_replies,threads_read_replies,threads_manage_insights";

type ThreadsErr = { error?: { message?: string; code?: number; error_subcode?: number } };

export function threadsError(res: HttpResponse, action: string): PublishError {
  const e = (res.body as ThreadsErr | null)?.error;
  const msg = e?.message || `HTTP ${res.status}`;
  if (res.status === 401 || e?.code === 190) return new PublishError(`${action}: Threads rejected the access token. Reconnect the channel.`, "auth", e);
  if (res.status === 429 || e?.code === 4 || e?.code === 17 || e?.code === 32 || e?.code === 613) return new PublishError(`${action}: Threads rate limit reached. We'll retry later.`, "rate", e);
  return new PublishError(`${action}: ${msg}`, kindForStatus(res.status), e);
}

export async function threadsCall<T>(method: "GET" | "POST", path: string, token: string, params: Record<string, string>, action: string): Promise<T> {
  const url = `${GRAPH}/${VERSION()}/${path.replace(/^\//, "")}`;
  const all = { ...params, access_token: token };
  const res = method === "GET" ? await http(`${url}?${form(all)}`) : await http(url, { method: "POST", body: form(all), timeoutMs: 60_000 });
  if (res.status >= 400 || (res.body as ThreadsErr | null)?.error) throw threadsError(res, action);
  return res.body as T;
}

async function longLived(shortToken: string): Promise<TokenSet> {
  const res = await http(`${GRAPH}/access_token?${form({ grant_type: "th_exchange_token", client_secret: env("THREADS_APP_SECRET"), access_token: shortToken })}`);
  if (res.status >= 400) throw threadsError(res, "Getting a long-lived Threads token");
  const b = res.body as { access_token: string; expires_in?: number };
  // Threads renews a long-lived token with the token itself, so it doubles as the refresh token.
  return { accessToken: b.access_token, refreshToken: b.access_token, expiresAt: b.expires_in ? new Date(Date.now() + b.expires_in * 1000) : null };
}

export const threadsProvider: ProviderAdapter = {
  id: "threads",
  name: "Threads",
  platforms: ["threads"],
  envVars: ["THREADS_APP_ID", "THREADS_APP_SECRET"],
  configured: () => Boolean(env("THREADS_APP_ID") && env("THREADS_APP_SECRET")),
  authorizeUrl(state, redirectUri) {
    return `https://threads.net/oauth/authorize?${form({ client_id: env("THREADS_APP_ID"), redirect_uri: redirectUri, scope: SCOPES, response_type: "code", state })}`;
  },
  async exchangeCode(code, redirectUri) {
    const res = await http(`${GRAPH}/oauth/access_token`, {
      method: "POST",
      body: form({ client_id: env("THREADS_APP_ID"), client_secret: env("THREADS_APP_SECRET"), grant_type: "authorization_code", redirect_uri: redirectUri, code }),
    });
    if (res.status >= 400) throw threadsError(res, "Signing in with Threads");
    const short = res.body as { access_token: string; user_id: string | number };
    const tokens = await longLived(short.access_token);
    const me = await threadsCall<{ id: string; username?: string; name?: string; threads_profile_picture_url?: string }>(
      "GET", "me", tokens.accessToken, { fields: "id,username,name,threads_profile_picture_url" }, "Reading your Threads profile");
    let followers: number | null = null;
    try {
      const ins = await threadsCall<{ data: { name: string; total_value?: { value: number } }[] }>("GET", `${me.id}/threads_insights`, tokens.accessToken, { metric: "followers_count" }, "Reading followers");
      followers = ins.data.find((d) => d.name === "followers_count")?.total_value?.value ?? null;
    } catch {
      followers = null; // insights need the insights scope; the account still connects without it
    }
    const account: ConnectedAccount = {
      platform: "threads",
      externalId: String(me.id),
      handle: me.username ?? String(me.id),
      displayName: me.name || me.username || "Threads account",
      avatarUrl: me.threads_profile_picture_url ?? null,
      followers,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt?.toISOString() ?? null,
      meta: {},
    };
    return [account];
  },
  async refresh(token) {
    const res = await http(`${GRAPH}/refresh_access_token?${form({ grant_type: "th_refresh_token", access_token: token })}`);
    if (res.status >= 400) throw threadsError(res, "Renewing the Threads token");
    const b = res.body as { access_token: string; expires_in?: number };
    return { accessToken: b.access_token, refreshToken: b.access_token, expiresAt: b.expires_in ? new Date(Date.now() + b.expires_in * 1000) : null };
  },
};

const mediaParams = (m: PublishMedia): Record<string, string> =>
  m.kind === "video" ? { media_type: "VIDEO", video_url: m.url } : { media_type: "IMAGE", image_url: m.url, ...(m.altText ? { alt_text: m.altText.slice(0, 1000) } : {}) };

async function waitFinished(id: string, token: string) {
  await poll(
    async () => {
      const s = await threadsCall<{ status?: string; error_message?: string }>("GET", id, token, { fields: "status,error_message" }, "Checking the Threads upload");
      if (s.status === "FINISHED" || s.status === "PUBLISHED") return true;
      if (s.status === "ERROR" || s.status === "EXPIRED") throw new PublishError(`Threads couldn't process the media (${s.error_message ?? s.status}).`, "permanent");
      return undefined;
    },
    { attempts: 40, intervalMs: 5_000, what: "The Threads media" },
  );
}

export const threadsPublisher: Publisher = {
  async publish({ channel, accessToken: t, caption, firstComment, media }: PublishInput): Promise<PublishResult> {
    if (media.length > 20) throw new PublishError("Threads posts can have at most 20 photos or videos.", "permanent");
    if (!caption.trim() && !media.length) throw new PublishError("Threads posts need text or media.", "permanent");
    const user = channel.externalId;
    const text = caption.slice(0, 500);
    let creationId: string;

    if (media.length === 0) {
      ({ id: creationId } = await threadsCall<{ id: string }>("POST", `${user}/threads`, t, { media_type: "TEXT", text }, "Creating the Threads post"));
    } else if (media.length === 1) {
      ({ id: creationId } = await threadsCall<{ id: string }>("POST", `${user}/threads`, t, { ...mediaParams(media[0]!), text }, "Sending the media to Threads"));
    } else {
      const children: string[] = [];
      for (const m of media) {
        const { id } = await threadsCall<{ id: string }>("POST", `${user}/threads`, t, { ...mediaParams(m), is_carousel_item: "true" }, "Sending the media to Threads");
        children.push(id);
      }
      for (const id of children) await waitFinished(id, t);
      ({ id: creationId } = await threadsCall<{ id: string }>("POST", `${user}/threads`, t, { media_type: "CAROUSEL", children: children.join(","), text }, "Creating the Threads carousel"));
    }
    await waitFinished(creationId, t);
    const { id } = await threadsCall<{ id: string }>("POST", `${user}/threads_publish`, t, { creation_id: creationId }, "Publishing to Threads");

    const warnings: string[] = [];
    let url: string | null = null;
    try {
      ({ permalink: url = null } = await threadsCall<{ permalink?: string | null }>("GET", id, t, { fields: "permalink" }, "Reading the post link"));
    } catch {
      warnings.push("Posted, but Threads didn't return a link to the post.");
    }
    if (firstComment.trim()) {
      try {
        const { id: replyId } = await threadsCall<{ id: string }>("POST", `${user}/threads`, t, { media_type: "TEXT", text: firstComment.slice(0, 500), reply_to_id: id }, "Adding the first reply");
        await waitFinished(replyId, t);
        await threadsCall("POST", `${user}/threads_publish`, t, { creation_id: replyId }, "Adding the first reply");
      } catch (e) {
        warnings.push(`The first reply wasn't added: ${(e as Error).message}`);
      }
    }
    return { externalId: id, url, warnings };
  },
};
