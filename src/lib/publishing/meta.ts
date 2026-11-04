import { createHmac } from "node:crypto";
import { env, form, http, poll, type HttpResponse } from "./http";
import { PublishError, type ConnectedAccount, type ProviderAdapter, type PublishInput, type PublishResult, type Publisher } from "./types";

/**
 * Facebook Pages and Instagram professional accounts, both through the Meta Graph API.
 * One OAuth login returns every Page the person manages, plus the Instagram account linked to each Page.
 */
const version = () => env("META_GRAPH_VERSION") || "v21.0";
const graph = (path: string) => `https://graph.facebook.com/${version()}/${path.replace(/^\//, "")}`;

export const META_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "pages_manage_engagement",
  "pages_read_user_content",
  "read_insights",
  "business_management",
  "instagram_basic",
  "instagram_content_publish",
  "instagram_manage_comments",
  "instagram_manage_insights",
];

/** appsecret_proof proves each call comes from our server, so a leaked token alone can't be used elsewhere (when the app requires it). */
const proof = (token: string) => createHmac("sha256", env("META_APP_SECRET")).update(token).digest("hex");

type GraphError = { error?: { message?: string; code?: number; error_subcode?: number; is_transient?: boolean; error_user_msg?: string } };

export function metaError(res: HttpResponse, action: string): PublishError {
  const e = (res.body as GraphError | null)?.error;
  const msg = e?.error_user_msg || e?.message || `HTTP ${res.status}`;
  const code = e?.code;
  if (code === 190 || code === 102 || code === 10 || (code !== undefined && code >= 200 && code < 300) || res.status === 401)
    return new PublishError(`${action}: Meta rejected the access token (${msg}). Reconnect the channel.`, "auth", e);
  if (code === 4 || code === 17 || code === 32 || code === 613 || code === 80001 || res.status === 429)
    return new PublishError(`${action}: Meta rate limit reached. We'll retry later.`, "rate", e);
  if (e?.is_transient || code === 1 || code === 2 || res.status >= 500) return new PublishError(`${action}: ${msg}`, "temporary", e);
  return new PublishError(`${action}: ${msg}`, "permanent", e);
}

export async function call<T>(method: "GET" | "POST", path: string, token: string, params: Record<string, string>, action: string): Promise<T> {
  const all = { ...params, access_token: token, appsecret_proof: proof(token) };
  const res =
    method === "GET"
      ? await http(`${graph(path)}?${form(all)}`)
      : await http(graph(path), { method: "POST", body: form(all), timeoutMs: 120_000 });
  if (res.status >= 400 || (res.body as GraphError | null)?.error) throw metaError(res, action);
  return res.body as T;
}

/* ------------------------------ OAuth ------------------------------ */

type PageRow = {
  id: string;
  name: string;
  access_token: string;
  followers_count?: number;
  picture?: { data?: { url?: string } };
  instagram_business_account?: { id: string; username?: string; name?: string; profile_picture_url?: string; followers_count?: number };
};

export const metaProvider: ProviderAdapter = {
  id: "meta",
  name: "Facebook and Instagram",
  platforms: ["facebook", "instagram"],
  envVars: ["META_APP_ID", "META_APP_SECRET"],
  configured: () => Boolean(env("META_APP_ID") && env("META_APP_SECRET")),
  authorizeUrl(state, redirectUri) {
    const q = form({ client_id: env("META_APP_ID"), redirect_uri: redirectUri, state, response_type: "code", scope: META_SCOPES.join(",") });
    return `https://www.facebook.com/${version()}/dialog/oauth?${q}`;
  },
  async exchangeCode(code, redirectUri) {
    const base = { client_id: env("META_APP_ID"), client_secret: env("META_APP_SECRET") };
    const short = await http(`${graph("oauth/access_token")}?${form({ ...base, redirect_uri: redirectUri, code })}`);
    if (short.status >= 400) throw metaError(short, "Signing in with Facebook");
    const shortToken = (short.body as { access_token: string }).access_token;
    // Swap for a long-lived user token. Page tokens derived from it don't expire.
    const long = await http(`${graph("oauth/access_token")}?${form({ ...base, grant_type: "fb_exchange_token", fb_exchange_token: shortToken })}`);
    if (long.status >= 400) throw metaError(long, "Signing in with Facebook");
    const userToken = (long.body as { access_token: string }).access_token;

    const fields = "id,name,access_token,followers_count,picture{url},instagram_business_account{id,username,name,profile_picture_url,followers_count}";
    const pages: PageRow[] = [];
    let next: string | null = `${graph("me/accounts")}?${form({ fields, limit: "100", access_token: userToken, appsecret_proof: proof(userToken) })}`;
    for (let i = 0; next && i < 10; i++) {
      const res: HttpResponse = await http(next);
      if (res.status >= 400) throw metaError(res, "Listing your Facebook Pages");
      const body = res.body as { data: PageRow[]; paging?: { next?: string } };
      pages.push(...body.data);
      next = body.paging?.next ?? null;
    }

    const out: ConnectedAccount[] = [];
    for (const p of pages) {
      out.push({
        platform: "facebook",
        externalId: p.id,
        handle: p.name,
        displayName: p.name,
        avatarUrl: p.picture?.data?.url ?? null,
        followers: p.followers_count ?? null,
        accessToken: p.access_token,
        refreshToken: null,
        expiresAt: null,
        meta: {},
      });
      const ig = p.instagram_business_account;
      if (ig) {
        out.push({
          platform: "instagram",
          externalId: ig.id,
          handle: ig.username ?? ig.id,
          displayName: ig.name || ig.username || "Instagram account",
          avatarUrl: ig.profile_picture_url ?? null,
          followers: ig.followers_count ?? null,
          accessToken: p.access_token,
          refreshToken: null,
          expiresAt: null,
          meta: { pageId: p.id },
        });
      }
    }
    return out;
  },
};

/* ---------------------------- Facebook ----------------------------- */

export const facebookPublisher: Publisher = {
  async publish({ channel, accessToken: t, caption, firstComment, media }: PublishInput): Promise<PublishResult> {
    const page = channel.externalId;
    const warnings: string[] = [];
    let postId: string;
    let commentTarget: string;
    const videos = media.filter((m) => m.kind === "video");
    if (videos.length) {
      if (media.length > 1) warnings.push("Facebook takes one video per post, so only the first video was posted.");
      const r = await call<{ id: string }>("POST", `${page}/videos`, t, { file_url: videos[0]!.url, description: caption }, "Uploading the video to Facebook");
      postId = r.id;
      commentTarget = r.id;
    } else if (media.length === 1) {
      const r = await call<{ id: string; post_id?: string }>("POST", `${page}/photos`, t, { url: media[0]!.url, caption, alt_text_custom: media[0]!.altText }, "Posting the photo to Facebook");
      postId = r.post_id ?? r.id;
      commentTarget = postId;
    } else if (media.length > 1) {
      const ids: string[] = [];
      for (const m of media) {
        const r = await call<{ id: string }>("POST", `${page}/photos`, t, { url: m.url, published: "false", alt_text_custom: m.altText }, "Uploading photos to Facebook");
        ids.push(r.id);
      }
      const params: Record<string, string> = { message: caption };
      ids.forEach((id, i) => (params[`attached_media[${i}]`] = JSON.stringify({ media_fbid: id })));
      const r = await call<{ id: string }>("POST", `${page}/feed`, t, params, "Posting to Facebook");
      postId = r.id;
      commentTarget = r.id;
    } else {
      const r = await call<{ id: string }>("POST", `${page}/feed`, t, { message: caption }, "Posting to Facebook");
      postId = r.id;
      commentTarget = r.id;
    }
    if (firstComment.trim()) {
      try {
        await call("POST", `${commentTarget}/comments`, t, { message: firstComment }, "Adding the first comment");
      } catch (e) {
        warnings.push(`The post went out, but the first comment failed: ${(e as Error).message}`);
      }
    }
    return { externalId: postId, url: `https://www.facebook.com/${postId}`, warnings };
  },
};

/* ---------------------------- Instagram ---------------------------- */

async function waitForContainer(id: string, token: string) {
  await poll(
    async () => {
      const r = await call<{ status_code: string; status?: string }>("GET", id, token, { fields: "status_code,status" }, "Checking Instagram processing");
      if (r.status_code === "FINISHED") return true;
      if (r.status_code === "ERROR" || r.status_code === "EXPIRED")
        throw new PublishError(`Instagram couldn't process the media (${r.status ?? r.status_code}). Check the file's format and size.`, "permanent");
      return undefined;
    },
    { attempts: 60, intervalMs: 5_000, what: "Instagram media" },
  );
}

export const instagramPublisher: Publisher = {
  async publish({ channel, accessToken: t, caption, firstComment, media }: PublishInput): Promise<PublishResult> {
    const ig = channel.externalId;
    const warnings: string[] = [];
    if (!media.length) throw new PublishError("Instagram posts need at least one photo or video.", "permanent");
    const item = (m: PublishInput["media"][number], extra: Record<string, string>) =>
      m.kind === "video" ? { media_type: media.length > 1 ? "VIDEO" : "REELS", video_url: m.url, ...extra } : { image_url: m.url, alt_text: m.altText, ...extra };

    let creation: string;
    if (media.length === 1) {
      creation = (await call<{ id: string }>("POST", `${ig}/media`, t, item(media[0]!, { caption }), "Sending media to Instagram")).id;
    } else {
      const children: string[] = [];
      for (const m of media) children.push((await call<{ id: string }>("POST", `${ig}/media`, t, item(m, { is_carousel_item: "true" }), "Sending media to Instagram")).id);
      for (const c of children) await waitForContainer(c, t);
      creation = (await call<{ id: string }>("POST", `${ig}/media`, t, { media_type: "CAROUSEL", children: children.join(","), caption }, "Building the Instagram carousel")).id;
    }
    await waitForContainer(creation, t);
    const { id } = await call<{ id: string }>("POST", `${ig}/media_publish`, t, { creation_id: creation }, "Publishing to Instagram");

    let url: string | null = null;
    try {
      url = (await call<{ permalink?: string }>("GET", id, t, { fields: "permalink" }, "Reading the post link")).permalink ?? null;
    } catch {
      /* the link is nice to have */
    }
    if (firstComment.trim()) {
      try {
        await call("POST", `${id}/comments`, t, { message: firstComment }, "Adding the first comment");
      } catch (e) {
        warnings.push(`The post went out, but the first comment failed: ${(e as Error).message}`);
      }
    }
    return { externalId: id, url, warnings };
  },
};
