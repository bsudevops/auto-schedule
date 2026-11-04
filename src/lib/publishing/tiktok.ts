import { env, form, http, kindForStatus, poll, type HttpResponse } from "./http";
import { PublishError, type ProviderAdapter, type PublishInput, type PublishResult, type Publisher, type TokenSet } from "./types";

/**
 * TikTok through the Content Posting API (direct post).
 * TikTok downloads the video from our media URL, so the media domain must be verified in the TikTok developer portal.
 * Until TikTok audits the app, posts can only be published as private (SELF_ONLY).
 */
const API = "https://open.tiktokapis.com/v2";
const SCOPES = "user.info.basic,user.info.profile,user.info.stats,video.publish,video.list";

type TikTokBody = { data?: Record<string, unknown>; error?: { code?: string; message?: string } };

export function tiktokError(res: HttpResponse, action: string): PublishError {
  const b = res.body as (TikTokBody & { error_description?: string; error?: string | TikTokBody["error"] }) | null;
  const err = typeof b?.error === "object" ? b.error : undefined;
  const code = err?.code ?? (typeof b?.error === "string" ? b.error : undefined);
  const msg = err?.message || b?.error_description || code || `HTTP ${res.status}`;
  if (code === "access_token_invalid" || code === "scope_not_authorized" || code === "invalid_grant" || res.status === 401)
    return new PublishError(`${action}: TikTok rejected the access token. Reconnect the channel.`, "auth", b);
  if (code === "rate_limit_exceeded" || code === "spam_risk_too_many_posts" || res.status === 429)
    return new PublishError(`${action}: TikTok limits how often an account can post. We'll retry later.`, "rate", b);
  if (code === "internal_error" || res.status >= 500) return new PublishError(`${action}: ${msg}`, "temporary", b);
  return new PublishError(`${action}: ${msg}`, kindForStatus(res.status) === "temporary" ? "temporary" : "permanent", b);
}

const failed = (res: HttpResponse) => {
  const e = (res.body as TikTokBody | null)?.error;
  return res.status >= 400 || (e?.code !== undefined && e.code !== "ok");
};

async function api<T>(path: string, token: string, body: unknown, action: string): Promise<T> {
  const res = await http(`${API}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify(body ?? {}),
  });
  if (failed(res)) throw tiktokError(res, action);
  return (res.body as { data: T }).data;
}

async function tokenRequest(params: Record<string, string>, action: string): Promise<{ open_id: string } & TokenSet> {
  const res = await http(`${API}/oauth/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form({ client_key: env("TIKTOK_CLIENT_KEY"), client_secret: env("TIKTOK_CLIENT_SECRET"), ...params }),
  });
  const b = res.body as { access_token?: string; expires_in?: number; refresh_token?: string; open_id?: string; error?: string } | null;
  if (res.status >= 400 || !b?.access_token) throw tiktokError(res, action);
  return {
    open_id: b.open_id ?? "",
    accessToken: b.access_token,
    refreshToken: b.refresh_token ?? null,
    expiresAt: b.expires_in ? new Date(Date.now() + b.expires_in * 1000) : null,
  };
}

export const tiktokProvider: ProviderAdapter = {
  id: "tiktok",
  name: "TikTok",
  platforms: ["tiktok"],
  envVars: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"],
  configured: () => Boolean(env("TIKTOK_CLIENT_KEY") && env("TIKTOK_CLIENT_SECRET")),
  authorizeUrl(state, redirectUri) {
    const q = form({ client_key: env("TIKTOK_CLIENT_KEY"), scope: SCOPES, response_type: "code", redirect_uri: redirectUri, state });
    return `https://www.tiktok.com/v2/auth/authorize/?${q}`;
  },
  async exchangeCode(code, redirectUri) {
    const tk = await tokenRequest({ code, grant_type: "authorization_code", redirect_uri: redirectUri }, "Signing in with TikTok");
    const res = await http(`${API}/user/info/?fields=open_id,avatar_url,display_name,username,follower_count`, { headers: { Authorization: `Bearer ${tk.accessToken}` } });
    if (failed(res)) throw tiktokError(res, "Reading your TikTok profile");
    const u = (res.body as { data: { user: { open_id: string; avatar_url?: string; display_name?: string; username?: string; follower_count?: number } } }).data.user;
    return [
      {
        platform: "tiktok",
        externalId: u.open_id || tk.open_id,
        handle: u.username ?? u.display_name ?? "tiktok",
        displayName: u.display_name ?? u.username ?? "TikTok account",
        avatarUrl: u.avatar_url ?? null,
        followers: u.follower_count ?? null,
        accessToken: tk.accessToken,
        refreshToken: tk.refreshToken,
        expiresAt: tk.expiresAt?.toISOString() ?? null,
        meta: {},
      },
    ];
  },
  async refresh(refreshToken) {
    const tk = await tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken }, "Refreshing the TikTok token");
    return { accessToken: tk.accessToken, refreshToken: tk.refreshToken ?? refreshToken, expiresAt: tk.expiresAt };
  },
};

type CreatorInfo = { privacy_level_options: string[]; comment_disabled?: boolean; duet_disabled?: boolean; stitch_disabled?: boolean; max_video_post_duration_sec?: number };

/** Uses the preferred privacy level when the account allows it, otherwise the most public option it offers. */
export function pickPrivacy(options: string[], preferred: string): string {
  if (options.includes(preferred)) return preferred;
  for (const p of ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"]) if (options.includes(p)) return p;
  throw new PublishError("TikTok didn't offer any privacy setting for this account.", "permanent");
}

export const tiktokPublisher: Publisher = {
  async publish({ channel, accessToken: t, caption, media }: PublishInput): Promise<PublishResult> {
    const video = media.find((m) => m.kind === "video");
    if (!video || media.length !== 1) throw new PublishError("TikTok posts need exactly one video.", "permanent");
    const info = await api<CreatorInfo>("/post/publish/creator_info/query/", t, {}, "Checking the TikTok account");
    const privacy = pickPrivacy(info.privacy_level_options ?? [], env("TIKTOK_PRIVACY_LEVEL") || "PUBLIC_TO_EVERYONE");
    const warnings = privacy === "SELF_ONLY" ? ["TikTok posted this as private. Public posting needs TikTok to audit the app."] : [];
    const { publish_id } = await api<{ publish_id: string }>(
      "/post/publish/video/init/",
      t,
      {
        post_info: { title: caption.slice(0, 2200), privacy_level: privacy, disable_comment: Boolean(info.comment_disabled), disable_duet: Boolean(info.duet_disabled), disable_stitch: Boolean(info.stitch_disabled) },
        source_info: { source: "PULL_FROM_URL", video_url: video.url },
      },
      "Sending the video to TikTok",
    );
    const done = await poll(
      async () => {
        const s = await api<{ status: string; fail_reason?: string; publicaly_available_post_id?: (string | number)[] }>("/post/publish/status/fetch/", t, { publish_id }, "Checking the TikTok upload");
        if (s.status === "PUBLISH_COMPLETE") return s;
        if (s.status === "FAILED") throw new PublishError(`TikTok couldn't publish the video (${s.fail_reason ?? "unknown reason"}).`, "permanent");
        return undefined;
      },
      { attempts: 60, intervalMs: 5_000, what: "The TikTok video" },
    );
    const postId = done.publicaly_available_post_id?.[0];
    return {
      externalId: postId ? String(postId) : publish_id,
      url: postId ? `https://www.tiktok.com/@${encodeURIComponent(channel.handle)}/video/${postId}` : null,
      warnings,
    };
  },
};
