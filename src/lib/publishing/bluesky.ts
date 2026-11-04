import sharp from "sharp";
import { http, kindForStatus, type HttpResponse } from "./http";
import { PublishError, type ConnectedAccount, type ProviderAdapter, type PublishInput, type PublishMedia, type PublishResult, type Publisher } from "./types";

/**
 * Bluesky, through the AT Protocol. People connect with their handle and an app password (made in
 * Bluesky's settings), not their main password. Nothing to set up on the server.
 * We keep the app password encrypted and open a short session for each publish.
 */
const SERVICE = "https://bsky.social";
const PUBLIC_API = "https://public.api.bsky.app"; // unauthenticated reads
const MAX_BLOB = 976_000; // Bluesky's image limit is about 1 MB
const MAX_GRAPHEMES = 300;

type XrpcErr = { error?: string; message?: string };

export function blueskyError(res: HttpResponse, action: string): PublishError {
  const b = res.body as XrpcErr | null;
  const msg = b?.message || b?.error || `HTTP ${res.status}`;
  if (res.status === 401 || b?.error === "AuthenticationRequired" || b?.error === "ExpiredToken" || b?.error === "InvalidToken")
    return new PublishError(`${action}: Bluesky didn't accept the app password. Reconnect the channel with a new one.`, "auth", b);
  if (res.status === 429 || b?.error === "RateLimitExceeded") return new PublishError(`${action}: Bluesky rate limit reached. We'll retry later.`, "rate", b);
  return new PublishError(`${action}: ${msg}`, kindForStatus(res.status), b);
}

async function xrpc<T>(method: "GET" | "POST", nsid: string, action: string, opts: { token?: string; body?: unknown; raw?: Buffer; contentType?: string; query?: Record<string, string>; base?: string } = {}): Promise<T> {
  const q = opts.query ? `?${new URLSearchParams(opts.query)}` : "";
  const headers: Record<string, string> = {};
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  let body: BodyInit | undefined;
  if (opts.raw) {
    headers["Content-Type"] = opts.contentType ?? "application/octet-stream";
    body = new Uint8Array(opts.raw);
  } else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  const res = await http(`${opts.base ?? SERVICE}/xrpc/${nsid}${q}`, { method, headers, body, timeoutMs: 60_000 });
  if (res.status >= 400) throw blueskyError(res, action);
  return res.body as T;
}

type Session = { accessJwt: string; did: string; handle: string };

async function createSession(identifier: string, password: string, action: string): Promise<Session> {
  return xrpc<Session>("POST", "com.atproto.server.createSession", action, { body: { identifier, password } });
}

/** Normalises what people type: "@name.bsky.social", "name", or an email for the login. */
export function normaliseHandle(input: string): string {
  const s = input.trim().replace(/^@/, "");
  if (s.includes("@")) return s; // an email address works as the login identifier
  return s.includes(".") ? s.toLowerCase() : `${s.toLowerCase()}.bsky.social`;
}

/** App passwords look like xxxx-xxxx-xxxx-xxxx; anything else is probably the account password. */
export const looksLikeAppPassword = (p: string) => /^[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/i.test(p.trim());

export const blueskyProvider: ProviderAdapter = {
  id: "bluesky",
  name: "Bluesky",
  platforms: ["bluesky"],
  envVars: [],
  configured: () => true,
  connect: "credentials",
  fields: [
    { name: "handle", label: "Handle or email", type: "text", placeholder: "yourname.bsky.social" },
    { name: "appPassword", label: "App password", type: "password", placeholder: "xxxx-xxxx-xxxx-xxxx", help: "Make one in Bluesky under Settings, Privacy and security, App passwords. Don't use your main password." },
  ],
  authorizeUrl: () => {
    throw new Error("Bluesky connects with an app password, not a sign-in page.");
  },
  exchangeCode: async () => [],
  async connectWithCredentials(input) {
    const identifier = normaliseHandle(input.handle ?? "");
    const password = (input.appPassword ?? "").trim();
    if (!identifier || !password) throw new PublishError("Enter your handle and an app password.", "permanent");
    if (!looksLikeAppPassword(password)) throw new PublishError("That doesn't look like an app password. Make one in Bluesky's settings and paste it here.", "permanent");
    const s = await createSession(identifier, password, "Signing in to Bluesky");
    const p = await xrpc<{ did: string; handle: string; displayName?: string; avatar?: string; followersCount?: number }>(
      "GET", "app.bsky.actor.getProfile", "Reading your Bluesky profile", { token: s.accessJwt, query: { actor: s.did } });
    const account: ConnectedAccount = {
      platform: "bluesky",
      externalId: s.did,
      handle: p.handle,
      displayName: p.displayName || p.handle,
      avatarUrl: p.avatar ?? null,
      followers: p.followersCount ?? null,
      accessToken: password,
      refreshToken: null,
      expiresAt: null,
      meta: { did: s.did, login: identifier },
    };
    return [account];
  },
};

/* ------------------------------ Posting ----------------------------- */

const encoder = new TextEncoder();
const byteLen = (s: string) => encoder.encode(s).length;

export function graphemeCount(s: string): number {
  return [...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(s)].length;
}

export type Facet = { index: { byteStart: number; byteEnd: number }; features: Record<string, string>[] };

/** Rich-text facets so links and hashtags are clickable. Bluesky counts positions in UTF-8 bytes. */
export function buildFacets(text: string): Facet[] {
  const facets: Facet[] = [];
  for (const m of text.matchAll(/https?:\/\/[^\s<>"']+/g)) {
    const url = m[0].replace(/[).,!?:;]+$/, "");
    const start = byteLen(text.slice(0, m.index));
    facets.push({ index: { byteStart: start, byteEnd: start + byteLen(url) }, features: [{ $type: "app.bsky.richtext.facet#link", uri: url }] });
  }
  for (const m of text.matchAll(/(^|\s)#([\p{L}\p{N}_]+)/gu)) {
    const at = m.index! + m[1]!.length;
    const tag = m[2]!;
    if (/^\d+$/.test(tag)) continue; // "#1" is not a hashtag
    const start = byteLen(text.slice(0, at));
    facets.push({ index: { byteStart: start, byteEnd: start + byteLen(`#${tag}`) }, features: [{ $type: "app.bsky.richtext.facet#tag", tag }] });
  }
  return facets.sort((a, b) => a.index.byteStart - b.index.byteStart);
}

async function imageBlob(m: PublishMedia, token: string) {
  const res = await fetch(m.url, { signal: AbortSignal.timeout(120_000) }).catch(() => null);
  if (!res?.ok) throw new PublishError("Couldn't read the image from storage.", "temporary");
  let bytes = Buffer.from(await res.arrayBuffer());
  let type = m.mimeType;
  const meta = await sharp(bytes).metadata().catch(() => null);
  if (bytes.length > MAX_BLOB) {
    // Shrink to fit Bluesky's limit, stepping the quality down until it does.
    for (const [w, q] of [[2000, 85], [1600, 80], [1200, 75], [1000, 70]] as const) {
      bytes = await sharp(bytes).rotate().resize({ width: w, height: w, fit: "inside", withoutEnlargement: true }).jpeg({ quality: q, mozjpeg: true }).toBuffer();
      type = "image/jpeg";
      if (bytes.length <= MAX_BLOB) break;
    }
    if (bytes.length > MAX_BLOB) throw new PublishError("This image is too large for Bluesky even after shrinking it.", "permanent");
  }
  const up = await xrpc<{ blob: unknown }>("POST", "com.atproto.repo.uploadBlob", "Uploading the image to Bluesky", { token, raw: bytes, contentType: type });
  const aspectRatio = meta?.width && meta?.height ? { width: meta.width, height: meta.height } : undefined;
  return { alt: m.altText.slice(0, 2000), image: up.blob, ...(aspectRatio ? { aspectRatio } : {}) };
}

export const blueskyPublisher: Publisher = {
  async publish({ channel, accessToken: password, caption, firstComment, media }: PublishInput): Promise<PublishResult> {
    if (media.some((m) => m.kind === "video")) throw new PublishError("Bluesky video posting isn't supported yet. Use photos for Bluesky.", "permanent");
    if (media.length > 4) throw new PublishError("Bluesky posts can have at most 4 photos.", "permanent");
    if (graphemeCount(caption) > MAX_GRAPHEMES) throw new PublishError(`Bluesky posts are limited to ${MAX_GRAPHEMES} characters.`, "permanent");
    if (!caption.trim() && !media.length) throw new PublishError("Bluesky posts need text or photos.", "permanent");

    const login = String(channel.meta.login ?? channel.handle);
    const s = await createSession(login, password, "Signing in to Bluesky");
    const images = [];
    for (const m of media) images.push(await imageBlob(m, s.accessJwt));

    const record: Record<string, unknown> = { $type: "app.bsky.feed.post", text: caption, createdAt: new Date().toISOString(), langs: ["en"] };
    const facets = buildFacets(caption);
    if (facets.length) record.facets = facets;
    if (images.length) record.embed = { $type: "app.bsky.embed.images", images };

    const post = await xrpc<{ uri: string; cid: string }>("POST", "com.atproto.repo.createRecord", "Posting to Bluesky", {
      token: s.accessJwt,
      body: { repo: s.did, collection: "app.bsky.feed.post", record },
    });
    const rkey = post.uri.split("/").pop()!;
    const warnings: string[] = [];
    if (firstComment.trim()) {
      try {
        const text = firstComment.slice(0, 300);
        const reply: Record<string, unknown> = {
          $type: "app.bsky.feed.post", text, createdAt: new Date().toISOString(),
          reply: { root: { uri: post.uri, cid: post.cid }, parent: { uri: post.uri, cid: post.cid } },
        };
        const rf = buildFacets(text);
        if (rf.length) reply.facets = rf;
        await xrpc("POST", "com.atproto.repo.createRecord", "Adding the first reply", { token: s.accessJwt, body: { repo: s.did, collection: "app.bsky.feed.post", record: reply } });
      } catch (e) {
        warnings.push(`The first reply wasn't added: ${(e as Error).message}`);
      }
    }
    return { externalId: post.uri, url: `https://bsky.app/profile/${s.handle}/post/${rkey}`, warnings };
  },
};

/** Public profile figures need no session. */
export async function blueskyFollowers(did: string): Promise<number | null> {
  const p = await xrpc<{ followersCount?: number }>("GET", "app.bsky.actor.getProfile", "Reading followers", { query: { actor: did }, base: PUBLIC_API });
  return p.followersCount ?? null;
}

/** Like, repost, reply and quote counts for one post, from the public API. */
export async function blueskyPostFigures(uri: string) {
  const r = await xrpc<{ posts?: { likeCount?: number; repostCount?: number; replyCount?: number; quoteCount?: number }[] }>(
    "GET", "app.bsky.feed.getPosts", "Reading post figures", { query: { uris: uri }, base: PUBLIC_API });
  const p = r.posts?.[0];
  return { likes: p?.likeCount ?? null, shares: (p?.repostCount ?? 0) + (p?.quoteCount ?? 0), comments: p?.replyCount ?? null };
}
