import { env, form, http, kindForStatus, type HttpResponse } from "./http";
import { PublishError, type ConnectedAccount, type ProviderAdapter, type PublishInput, type PublishMedia, type PublishResult, type Publisher, type TokenSet } from "./types";
import { defaultYoutubeOptions, youtubeOptions, youtubeTitle } from "../youtube-options";

/**
 * Google: YouTube (Data API v3) and Google Business Profile.
 * Both use one Google Cloud OAuth client (GOOGLE_PUBLISH_CLIENT_ID and SECRET), separate from Google sign-in,
 * with offline access so the worker can refresh tokens.
 */
const clientId = () => env("GOOGLE_PUBLISH_CLIENT_ID");
const clientSecret = () => env("GOOGLE_PUBLISH_CLIENT_SECRET");
const configured = () => Boolean(clientId() && clientSecret());

type GoogleErr = { error?: { code?: number; message?: string; status?: string; errors?: { reason?: string }[] } | string; error_description?: string };

export function googleError(res: HttpResponse, action: string, product = "Google"): PublishError {
  const b = res.body as GoogleErr | null;
  const e = typeof b?.error === "object" ? b.error : null;
  const reason = e?.errors?.[0]?.reason ?? "";
  const msg = e?.message || b?.error_description || (typeof b?.error === "string" ? b.error : "") || `HTTP ${res.status}`;
  if (res.status === 401 || b?.error === "invalid_grant") return new PublishError(`${action}: ${product} rejected the access token. Reconnect the channel.`, "auth", b);
  if (res.status === 429 || /rateLimitExceeded|userRateLimitExceeded|quotaExceeded/.test(reason)) return new PublishError(`${action}: ${product} rate limit or daily quota reached. We'll retry later.`, "rate", b);
  if (res.status === 403 && /insufficientPermissions|forbidden/i.test(reason)) return new PublishError(`${action}: ${msg}. Reconnect the channel and allow every permission.`, "auth", b);
  return new PublishError(`${action}: ${msg}`, kindForStatus(res.status), b);
}

function authorizeUrl(scopes: string, state: string, redirectUri: string) {
  return `https://accounts.google.com/o/oauth2/v2/auth?${form({
    client_id: clientId(), redirect_uri: redirectUri, response_type: "code", scope: scopes, state,
    access_type: "offline", prompt: "consent", include_granted_scopes: "true",
  })}`;
}

async function tokenRequest(params: Record<string, string>, action: string): Promise<TokenSet> {
  const res = await http("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form({ ...params, client_id: clientId(), client_secret: clientSecret() }),
  });
  if (res.status >= 400) throw googleError(res, action);
  const b = res.body as { access_token: string; expires_in?: number; refresh_token?: string };
  return { accessToken: b.access_token, refreshToken: b.refresh_token ?? null, expiresAt: b.expires_in ? new Date(Date.now() + b.expires_in * 1000) : null };
}

async function refresh(refreshToken: string): Promise<TokenSet> {
  const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken }, "Refreshing the Google token");
  return { ...t, refreshToken: t.refreshToken ?? refreshToken };
}

export async function gget<T>(url: string, token: string, action: string, product?: string): Promise<T> {
  const res = await http(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status >= 400) throw googleError(res, action, product);
  return res.body as T;
}

const tokenFields = (t: TokenSet) => ({ accessToken: t.accessToken, refreshToken: t.refreshToken, expiresAt: t.expiresAt?.toISOString() ?? null });

/* ------------------------------ YouTube ----------------------------- */

const YT = "https://www.googleapis.com/youtube/v3";

export const youtubeProvider: ProviderAdapter = {
  id: "youtube",
  name: "YouTube",
  platforms: ["youtube"],
  envVars: ["GOOGLE_PUBLISH_CLIENT_ID", "GOOGLE_PUBLISH_CLIENT_SECRET"],
  configured,
  authorizeUrl: (state, redirectUri) =>
    authorizeUrl("https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube.force-ssl", state, redirectUri),
  async exchangeCode(code, redirectUri) {
    const t = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri }, "Signing in with Google");
    const r = await gget<{ items?: { id: string; snippet: { title: string; customUrl?: string; thumbnails?: { default?: { url: string } } }; statistics?: { subscriberCount?: string; hiddenSubscriberCount?: boolean } }[] }>(
      `${YT}/channels?part=snippet,statistics&mine=true`, t.accessToken, "Reading your YouTube channel", "YouTube");
    return (r.items ?? []).map((c): ConnectedAccount => ({
      platform: "youtube",
      externalId: c.id,
      handle: (c.snippet.customUrl ?? c.id).replace(/^@/, ""),
      displayName: c.snippet.title,
      avatarUrl: c.snippet.thumbnails?.default?.url ?? null,
      followers: c.statistics?.hiddenSubscriberCount ? null : Number(c.statistics?.subscriberCount ?? NaN) || null,
      ...tokenFields(t),
      meta: {},
    }));
  },
  refresh,
};

export { youtubeTitle };

export const youtubePublisher: Publisher = {
  async publish({ channel, accessToken: t, caption, media, options, thumbnail }: PublishInput): Promise<PublishResult> {
    const video = media.find((m) => m.kind === "video");
    if (!video || media.length !== 1) throw new PublishError("YouTube posts need exactly one video.", "permanent");
    const parsed0 = youtubeOptions.safeParse(options ?? {});
    const o = parsed0.success ? parsed0.data : defaultYoutubeOptions();
    // A server-wide override (YOUTUBE_PRIVACY_STATUS) still wins, for unverified Google projects that can only upload private videos.
    const forced = String(channel.meta.privacy ?? env("YOUTUBE_PRIVACY_STATUS") ?? "");
    const privacy = forced && forced !== "public" ? forced : o.visibility;
    const snippet: Record<string, unknown> = {
      title: o.title || youtubeTitle(caption),
      description: caption.replace(/[<>]/g, "").slice(0, 5000),
      categoryId: o.categoryId || String(channel.meta.categoryId ?? "22"),
    };
    if (o.tags.length) snippet.tags = o.tags;
    if (o.language) {
      snippet.defaultLanguage = o.language;
      snippet.defaultAudioLanguage = o.language;
    }
    const body: Record<string, unknown> = {
      snippet,
      status: {
        privacyStatus: privacy,
        selfDeclaredMadeForKids: o.madeForKids,
        license: o.license,
        embeddable: o.embeddable,
        publicStatsViewable: o.showLikes,
        containsSyntheticMedia: o.alteredContent,
      },
      paidProductPlacementDetails: { hasPaidProductPlacement: o.paidPromotion },
    };
    if (o.recordingDate) body.recordingDetails = { recordingDate: `${o.recordingDate}T00:00:00Z` };
    const parts = Object.keys(body).join(",");
    // Resumable upload: open a session, then send the bytes to the address Google returns.
    const init = await http(`https://www.googleapis.com/upload/youtube/v3/videos?${form({ uploadType: "resumable", part: parts, notifySubscribers: String(o.notifySubscribers) })}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": video.mimeType, "X-Upload-Content-Length": String(video.sizeBytes) },
      body: JSON.stringify(body),
    });
    if (init.status >= 400) throw googleError(init, "Starting the YouTube upload", "YouTube");
    const location = init.headers.get("location");
    if (!location) throw new PublishError("YouTube didn't return an upload address.", "temporary");

    const source = await fetch(video.url, { signal: AbortSignal.timeout(600_000) }).catch(() => null);
    if (!source?.ok || !source.body) throw new PublishError("Couldn't read the video file from storage.", "temporary");
    let up: Response;
    try {
      up = await fetch(location, {
        method: "PUT",
        headers: { "Content-Type": video.mimeType, "Content-Length": String(video.sizeBytes) },
        body: source.body,
        // @ts-expect-error Node's fetch needs duplex for a streamed body; the DOM type doesn't know it
        duplex: "half",
        redirect: "error",
        signal: AbortSignal.timeout(1_800_000),
      });
    } catch (e) {
      throw new PublishError(`The YouTube upload was interrupted: ${(e as Error).message}`, "temporary");
    }
    const text = await up.text();
    let parsed: unknown = null;
    try { parsed = JSON.parse(text); } catch { parsed = null; }
    if (up.status >= 400) throw googleError({ status: up.status, headers: up.headers, body: parsed, text }, "Uploading the video to YouTube", "YouTube");
    const v = parsed as { id?: string; status?: { uploadStatus?: string; rejectionReason?: string } } | null;
    if (!v?.id) throw new PublishError("YouTube accepted the upload but returned no video ID.", "temporary");
    if (v.status?.uploadStatus === "rejected") throw new PublishError(`YouTube rejected the video (${v.status.rejectionReason ?? "no reason given"}).`, "permanent");

    // The video is up. Thumbnail and playlist are extras: if one fails, the post still counts as published, with a warning.
    const warnings: string[] = [];
    if (privacy !== o.visibility) warnings.push(`Uploaded as ${privacy}. Unverified Google Cloud projects can only upload private videos until Google audits the app.`);
    if (thumbnail) warnings.push(...(await setThumbnail(t, v.id, thumbnail)));
    if (o.playlistId) warnings.push(...(await addToPlaylist(t, v.id, o.playlistId)));
    return { externalId: v.id, url: `https://www.youtube.com/watch?v=${v.id}`, warnings };
  },
};

const THUMB_MAX = 2 * 1024 * 1024;
const networkFailure = (e: Error): HttpResponse => ({ status: 0, headers: new Headers(), body: { error: e.message }, text: e.message });

async function setThumbnail(t: string, videoId: string, img: PublishMedia): Promise<string[]> {
  if (!/^image\/(jpeg|png)$/.test(img.mimeType)) return ["The thumbnail wasn't set: YouTube takes JPG or PNG images."];
  if (img.sizeBytes > THUMB_MAX) return ["The thumbnail wasn't set: YouTube thumbnails must be 2 MB or smaller."];
  const src = await fetch(img.url, { signal: AbortSignal.timeout(60_000) }).catch(() => null);
  if (!src?.ok) return ["The thumbnail wasn't set: couldn't read the image from storage."];
  const bytes = await src.arrayBuffer();
  const r = await http(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?${form({ videoId, uploadType: "media" })}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${t}`, "Content-Type": img.mimeType },
    body: bytes,
    timeoutMs: 120_000,
  }).catch(networkFailure);
  if (r.status >= 200 && r.status < 300) return [];
  const why = googleError(r, "The thumbnail wasn't set", "YouTube").message;
  return [/verif|forbidden|permission/i.test(why) ? `${why} Custom thumbnails need a verified YouTube channel (youtube.com/verify).` : why];
}

async function addToPlaylist(t: string, videoId: string, playlistId: string): Promise<string[]> {
  const r = await http("https://www.googleapis.com/youtube/v3/playlistItems?part=snippet", {
    method: "POST",
    headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
    body: JSON.stringify({ snippet: { playlistId, resourceId: { kind: "youtube#video", videoId } } }),
  }).catch(networkFailure);
  if (r.status >= 200 && r.status < 300) return [];
  return [googleError(r, "The video wasn't added to the playlist", "YouTube").message];
}

/** The channel's own playlists, for the playlist picker. */
export async function youtubePlaylists(t: string): Promise<{ id: string; title: string }[]> {
  const out: { id: string; title: string }[] = [];
  let pageToken = "";
  for (let i = 0; i < 4; i++) {
    const r = await gget<{ items?: { id: string; snippet?: { title?: string } }[]; nextPageToken?: string }>(
      `https://www.googleapis.com/youtube/v3/playlists?${form({ part: "snippet", mine: "true", maxResults: "50", ...(pageToken ? { pageToken } : {}) })}`, t, "Listing your playlists", "YouTube");
    for (const p of r.items ?? []) out.push({ id: p.id, title: p.snippet?.title || "Untitled playlist" });
    if (!r.nextPageToken) break;
    pageToken = r.nextPageToken;
  }
  return out;
}

/* ----------------------- Google Business Profile ----------------------- */

export const googleBusinessProvider: ProviderAdapter = {
  id: "google_business",
  name: "Google Business Profile",
  platforms: ["google_business"],
  envVars: ["GOOGLE_PUBLISH_CLIENT_ID", "GOOGLE_PUBLISH_CLIENT_SECRET"],
  configured,
  authorizeUrl: (state, redirectUri) => authorizeUrl("https://www.googleapis.com/auth/business.manage", state, redirectUri),
  async exchangeCode(code, redirectUri) {
    const t = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri }, "Signing in with Google");
    const accounts = await gget<{ accounts?: { name: string; accountName?: string }[] }>(
      "https://mybusinessaccountmanagement.googleapis.com/v1/accounts", t.accessToken, "Listing your business accounts", "Google Business Profile");
    const out: ConnectedAccount[] = [];
    for (const a of accounts.accounts ?? []) {
      let pageToken = "";
      do {
        const r = await gget<{ locations?: { name: string; title?: string; storefrontAddress?: { locality?: string } }[]; nextPageToken?: string }>(
          `https://mybusinessbusinessinformation.googleapis.com/v1/${a.name}/locations?${form({ readMask: "name,title,storefrontAddress", pageSize: "100", ...(pageToken ? { pageToken } : {}) })}`,
          t.accessToken, "Listing your business locations", "Google Business Profile");
        for (const l of r.locations ?? []) {
          const locationId = l.name.replace(/^locations\//, "");
          const title = l.title ?? "Business location";
          out.push({
            platform: "google_business",
            externalId: `${a.name}/locations/${locationId}`,
            handle: l.storefrontAddress?.locality ? `${title}, ${l.storefrontAddress.locality}` : title,
            displayName: title,
            avatarUrl: null,
            followers: null,
            ...tokenFields(t),
            meta: { account: a.name, location: `locations/${locationId}` },
          });
        }
        pageToken = r.nextPageToken ?? "";
      } while (pageToken);
    }
    return out;
  },
  refresh,
};

export const googleBusinessPublisher: Publisher = {
  async publish({ channel, accessToken: t, caption, media }: PublishInput): Promise<PublishResult> {
    if (media.some((m) => m.kind === "video")) throw new PublishError("Google Business Profile posts take photos only.", "permanent");
    if (media.length > 1) throw new PublishError("Google Business Profile posts take one photo.", "permanent");
    if (!caption.trim()) throw new PublishError("Google Business Profile posts need text.", "permanent");
    const body: Record<string, unknown> = { languageCode: String(channel.meta.languageCode ?? "en"), summary: caption.slice(0, 1500), topicType: "STANDARD" };
    if (media[0]) body.media = [{ mediaFormat: "PHOTO", sourceUrl: media[0].url }];
    const res = await http(`https://mybusiness.googleapis.com/v4/${channel.externalId}/localPosts`, {
      method: "POST",
      headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      timeoutMs: 60_000,
    });
    if (res.status >= 400) throw googleError(res, "Posting to Google Business Profile", "Google Business Profile");
    const p = res.body as { name: string; searchUrl?: string; state?: string };
    const warnings = p.state === "PROCESSING" ? ["Google is still reviewing the post; it shows up once approved."] : [];
    return { externalId: p.name, url: p.searchUrl ?? null, warnings };
  },
};
