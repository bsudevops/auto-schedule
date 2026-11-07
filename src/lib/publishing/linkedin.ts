import { env, form, http, kindForStatus, poll, type HttpResponse } from "./http";
import { PublishError, type ConnectedAccount, type ProviderAdapter, type PublishInput, type PublishResult, type Publisher, type TokenSet } from "./types";

/**
 * LinkedIn personal profiles and company pages, through the versioned REST API (/rest/posts).
 * Company pages need the Community Management API product on the LinkedIn app, which adds the organization scopes.
 */
const apiVersion = () => env("LINKEDIN_API_VERSION") || "202410";
const scopes = () => env("LINKEDIN_SCOPES") || "openid profile w_member_social";

/**
 * LinkedIn only grants the Community Management API (company pages) to an app with no other products,
 * so pages can come from a second app: LINKEDIN_PAGES_CLIENT_ID / LINKEDIN_PAGES_CLIENT_SECRET.
 * That app can't use Sign In with LinkedIn, so it lists the pages the person administers and nothing else.
 */
const PAGES_SCOPES = "r_organization_social w_organization_social rw_organization_admin r_organization_admin";
const pagesScopes = () => env("LINKEDIN_PAGES_SCOPES") || PAGES_SCOPES;

export function headers(token: string, json = true): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "LinkedIn-Version": apiVersion(),
    "X-Restli-Protocol-Version": "2.0.0",
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}

export function linkedinError(res: HttpResponse, action: string): PublishError {
  const b = res.body as { message?: string; serviceErrorCode?: number } | null;
  const msg = b?.message || `HTTP ${res.status}`;
  const kind = kindForStatus(res.status);
  if (kind === "auth") return new PublishError(`${action}: LinkedIn rejected the access token. Reconnect the channel.`, "auth", b);
  if (kind === "rate") return new PublishError(`${action}: LinkedIn rate limit reached. We'll retry later.`, "rate", b);
  return new PublishError(`${action}: ${msg}`, kind, b);
}

/**
 * LinkedIn's "little text" format treats some characters as markup, so they must be escaped.
 * Hashtags become hashtag templates so they stay clickable.
 */
export function toLittleText(text: string): string {
  const escape = (t: string) => t.replace(/[\\|{}@[\]()<>#*_~]/g, (c) => `\\${c}`);
  let out = "";
  let last = 0;
  for (const m of text.matchAll(/(^|[^\p{L}\p{N}_&])#([\p{L}\p{N}_]+)/gu)) {
    const start = m.index! + m[1]!.length;
    out += escape(text.slice(last, start)) + `{hashtag|\\#|${m[2]}}`;
    last = start + 1 + m[2]!.length;
  }
  return out + escape(text.slice(last));
}

function tokenSet(b: { access_token: string; expires_in?: number; refresh_token?: string }): TokenSet {
  return {
    accessToken: b.access_token,
    refreshToken: b.refresh_token ?? null,
    expiresAt: b.expires_in ? new Date(Date.now() + b.expires_in * 1000) : null,
  };
}

export const linkedinProvider: ProviderAdapter = {
  id: "linkedin",
  name: "LinkedIn",
  platforms: ["linkedin"],
  envVars: ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"],
  configured: () => Boolean(env("LINKEDIN_CLIENT_ID") && env("LINKEDIN_CLIENT_SECRET")),
  authorizeUrl(state, redirectUri) {
    const q = form({ response_type: "code", client_id: env("LINKEDIN_CLIENT_ID"), redirect_uri: redirectUri, state, scope: scopes() });
    return `https://www.linkedin.com/oauth/v2/authorization?${q}`;
  },
  async exchangeCode(code, redirectUri) {
    const tokens = await exchangeWith(code, redirectUri, "LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET");
    const t = tokens.accessToken;
    const base = { accessToken: t, refreshToken: tokens.refreshToken, expiresAt: tokens.expiresAt?.toISOString() ?? null, followers: null };

    const me = await http("https://api.linkedin.com/v2/userinfo", { headers: { Authorization: `Bearer ${t}` } });
    if (me.status >= 400) throw linkedinError(me, "Reading your LinkedIn profile");
    const u = me.body as { sub: string; name?: string; picture?: string };
    const out: ConnectedAccount[] = [
      { ...base, platform: "linkedin", externalId: `person:${u.sub}`, handle: u.name ?? "LinkedIn profile", displayName: u.name ?? "LinkedIn profile", avatarUrl: u.picture ?? null, meta: { author: `urn:li:person:${u.sub}`, kind: "person" } },
    ];

    if (scopes().includes("rw_organization_admin")) out.push(...(await adminPages(t, base, {})));
    return out;
  },
  refresh: (refreshToken) => refreshWith(refreshToken, "LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"),
};

/** The company pages this token's member administers (up to 50). */
async function adminPages(t: string, base: Omit<ConnectedAccount, "platform" | "externalId" | "handle" | "displayName" | "avatarUrl" | "meta">, extraMeta: Record<string, unknown>): Promise<ConnectedAccount[]> {
  const acl = await http(`https://api.linkedin.com/rest/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED`, { headers: headers(t, false) });
  if (acl.status >= 400) throw linkedinError(acl, "Listing the LinkedIn pages you administer");
  const orgs = ((acl.body as { elements?: { organization: string }[] }).elements ?? []).map((e) => e.organization);
  const out: ConnectedAccount[] = [];
  for (const urn of orgs.slice(0, 50)) {
    const id = urn.split(":").pop()!;
    const org = await http(`https://api.linkedin.com/rest/organizations/${encodeURIComponent(id)}`, { headers: headers(t, false) });
    if (org.status >= 400) continue;
    const o = org.body as { localizedName?: string; vanityName?: string };
    out.push({ ...base, platform: "linkedin", externalId: `organization:${id}`, handle: o.vanityName ?? o.localizedName ?? id, displayName: o.localizedName ?? "LinkedIn page", avatarUrl: null, meta: { author: urn, kind: "organization", ...extraMeta } });
  }
  return out;
}

async function exchangeWith(code: string, redirectUri: string, idVar: string, secretVar: string): Promise<TokenSet> {
  const res = await http("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form({ grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: env(idVar), client_secret: env(secretVar) }),
  });
  if (res.status >= 400) throw linkedinError(res, "Signing in with LinkedIn");
  return tokenSet(res.body as { access_token: string; expires_in: number; refresh_token?: string });
}

async function refreshWith(refreshToken: string, idVar: string, secretVar: string): Promise<TokenSet> {
  const res = await http("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: env(idVar), client_secret: env(secretVar) }),
  });
  if (res.status >= 400) throw linkedinError(res, "Refreshing the LinkedIn token");
  return tokenSet(res.body as { access_token: string; expires_in: number; refresh_token?: string });
}

/** Company pages through the second LinkedIn app (Community Management API only). Channels it adds carry meta.app = "pages". */
export const linkedinPagesProvider: ProviderAdapter = {
  id: "linkedin_pages",
  name: "LinkedIn company page",
  platforms: ["linkedin"],
  envVars: ["LINKEDIN_PAGES_CLIENT_ID", "LINKEDIN_PAGES_CLIENT_SECRET"],
  configured: () => Boolean(env("LINKEDIN_PAGES_CLIENT_ID") && env("LINKEDIN_PAGES_CLIENT_SECRET")),
  authorizeUrl(state, redirectUri) {
    const q = form({ response_type: "code", client_id: env("LINKEDIN_PAGES_CLIENT_ID"), redirect_uri: redirectUri, state, scope: pagesScopes() });
    return `https://www.linkedin.com/oauth/v2/authorization?${q}`;
  },
  async exchangeCode(code, redirectUri) {
    const tokens = await exchangeWith(code, redirectUri, "LINKEDIN_PAGES_CLIENT_ID", "LINKEDIN_PAGES_CLIENT_SECRET");
    const base = { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, expiresAt: tokens.expiresAt?.toISOString() ?? null, followers: null };
    const pages = await adminPages(tokens.accessToken, base, { app: "pages" });
    if (!pages.length) throw new PublishError("LinkedIn didn't return any company page you administer. Sign in with a page admin account.", "permanent");
    return pages;
  },
  refresh: (refreshToken) => refreshWith(refreshToken, "LINKEDIN_PAGES_CLIENT_ID", "LINKEDIN_PAGES_CLIENT_SECRET"),
};

async function download(url: string): Promise<Buffer> {
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  } catch (e) {
    throw new PublishError(`Couldn't read the media file: ${(e as Error).message}`, "temporary");
  }
  if (!res.ok) throw new PublishError(`Couldn't read the media file (HTTP ${res.status}).`, res.status >= 500 ? "temporary" : "permanent");
  return Buffer.from(await res.arrayBuffer());
}

async function uploadImage(token: string, author: string, url: string): Promise<string> {
  const init = await http("https://api.linkedin.com/rest/images?action=initializeUpload", {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({ initializeUploadRequest: { owner: author } }),
  });
  if (init.status >= 400) throw linkedinError(init, "Starting the image upload to LinkedIn");
  const { uploadUrl, image } = (init.body as { value: { uploadUrl: string; image: string } }).value;
  const bytes = await download(url);
  const put = await http(uploadUrl, { method: "PUT", headers: { Authorization: `Bearer ${token}` }, body: new Uint8Array(bytes), timeoutMs: 300_000 });
  if (put.status >= 400) throw linkedinError(put, "Uploading the image to LinkedIn");
  return image;
}

async function uploadVideo(token: string, author: string, url: string): Promise<string> {
  const bytes = await download(url);
  const init = await http("https://api.linkedin.com/rest/videos?action=initializeUpload", {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({ initializeUploadRequest: { owner: author, fileSizeBytes: bytes.length, uploadCaptions: false, uploadThumbnail: false } }),
  });
  if (init.status >= 400) throw linkedinError(init, "Starting the video upload to LinkedIn");
  const v = (init.body as { value: { video: string; uploadToken?: string; uploadInstructions: { uploadUrl: string; firstByte: number; lastByte: number }[] } }).value;
  const etags: string[] = [];
  for (const part of v.uploadInstructions) {
    const put = await http(part.uploadUrl, { method: "PUT", body: new Uint8Array(bytes.subarray(part.firstByte, part.lastByte + 1)), timeoutMs: 300_000 });
    if (put.status >= 400) throw linkedinError(put, "Uploading the video to LinkedIn");
    etags.push(put.headers.get("etag") ?? "");
  }
  const fin = await http("https://api.linkedin.com/rest/videos?action=finalizeUpload", {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({ finalizeUploadRequest: { video: v.video, uploadToken: v.uploadToken ?? "", uploadedPartIds: etags } }),
  });
  if (fin.status >= 400) throw linkedinError(fin, "Finishing the video upload to LinkedIn");
  await poll(
    async () => {
      const r = await http(`https://api.linkedin.com/rest/videos/${encodeURIComponent(v.video)}`, { headers: headers(token, false) });
      if (r.status >= 400) throw linkedinError(r, "Checking the LinkedIn video");
      const s = (r.body as { status?: string }).status;
      if (s === "AVAILABLE") return true;
      if (s === "PROCESSING_FAILED") throw new PublishError("LinkedIn couldn't process the video. Check its format and length.", "permanent");
      return undefined;
    },
    { attempts: 60, intervalMs: 5_000, what: "The LinkedIn video" },
  );
  return v.video;
}

export const linkedinPublisher: Publisher = {
  async publish({ channel, accessToken: t, caption, firstComment, media }: PublishInput): Promise<PublishResult> {
    const author = channel.meta.author as string | undefined;
    if (!author) throw new PublishError("This LinkedIn channel is missing its account details. Reconnect it.", "auth");
    const warnings: string[] = [];
    let content: Record<string, unknown> | undefined;
    const video = media.find((m) => m.kind === "video");
    if (video) {
      if (media.length > 1) warnings.push("LinkedIn takes one video per post, so only the video was posted.");
      content = { media: { id: await uploadVideo(t, author, video.url) } };
    } else if (media.length === 1) {
      content = { media: { id: await uploadImage(t, author, media[0]!.url), altText: media[0]!.altText || undefined } };
    } else if (media.length > 1) {
      const images = [];
      for (const m of media) images.push({ id: await uploadImage(t, author, m.url), altText: m.altText || undefined });
      content = { multiImage: { images } };
    }

    const res = await http("https://api.linkedin.com/rest/posts", {
      method: "POST",
      headers: headers(t),
      body: JSON.stringify({
        author,
        commentary: toLittleText(caption),
        visibility: "PUBLIC",
        distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
        lifecycleState: "PUBLISHED",
        isReshareDisabledByAuthor: false,
        ...(content ? { content } : {}),
      }),
    });
    if (res.status >= 400) throw linkedinError(res, "Posting to LinkedIn");
    const urn = res.headers.get("x-restli-id") ?? res.headers.get("x-linkedin-id");
    if (!urn) throw new PublishError("LinkedIn accepted the post but didn't return its ID.", "permanent");

    if (firstComment.trim()) {
      const c = await http(`https://api.linkedin.com/rest/socialActions/${encodeURIComponent(urn)}/comments`, {
        method: "POST",
        headers: headers(t),
        body: JSON.stringify({ actor: author, object: urn, message: { text: firstComment } }),
      });
      if (c.status >= 400) warnings.push(`The post went out, but the first comment failed: ${linkedinError(c, "Adding the first comment").message}`);
    }
    return { externalId: urn, url: `https://www.linkedin.com/feed/update/${urn}/`, warnings };
  },
};
