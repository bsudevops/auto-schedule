import { http, kindForStatus, type HttpResponse } from "./http";
import { PublishError, type ConnectedAccount, type ProviderAdapter, type PublishInput, type PublishResult, type Publisher } from "./types";

/**
 * DEV.to (Forem). People connect with an API key from their DEV settings. A post becomes an article:
 * the first line is the title, the rest is the Markdown body, and hashtags become its tags (up to 4).
 */
const API = "https://dev.to/api";

export function devtoError(res: HttpResponse, action: string): PublishError {
  const b = res.body as { error?: string; status?: number } | null;
  const msg = b?.error || `HTTP ${res.status}`;
  if (res.status === 401) return new PublishError(`${action}: DEV rejected the API key. Reconnect the channel with a new key.`, "auth", b);
  if (res.status === 429) return new PublishError(`${action}: DEV rate limit reached. We'll retry later.`, "rate", b);
  return new PublishError(`${action}: ${msg}`, kindForStatus(res.status), b);
}

const headers = (key: string) => ({ "api-key": key, Accept: "application/vnd.forem.api-v1+json", "Content-Type": "application/json" });

export const devtoProvider: ProviderAdapter = {
  id: "devto",
  name: "DEV.to",
  platforms: ["devto"],
  envVars: [],
  configured: () => true,
  connect: "credentials",
  fields: [{ name: "apiKey", label: "DEV API key", type: "password", help: "Create one at dev.to under Settings, Extensions, DEV Community API Keys." }],
  authorizeUrl: () => {
    throw new Error("DEV connects with an API key, not a sign-in page.");
  },
  exchangeCode: async () => [],
  async connectWithCredentials(input) {
    const key = (input.apiKey ?? "").trim();
    if (!/^[A-Za-z0-9]{16,64}$/.test(key)) throw new PublishError("That doesn't look like a DEV API key.", "permanent");
    const res = await http(`${API}/users/me`, { headers: headers(key) });
    if (res.status >= 400) throw devtoError(res, "Checking the DEV API key");
    const u = res.body as { id: number; username: string; name?: string; profile_image?: string };
    const account: ConnectedAccount = {
      platform: "devto",
      externalId: String(u.id),
      handle: u.username,
      displayName: u.name || u.username,
      avatarUrl: u.profile_image ?? null,
      followers: null,
      accessToken: key,
      refreshToken: null,
      expiresAt: null,
      meta: {},
    };
    return [account];
  },
};

/** Splits a caption into an article: title from the first line, tags from hashtags (DEV allows 4, letters and numbers only). */
export function toArticle(caption: string) {
  const lines = caption.split("\n");
  const firstIdx = lines.findIndex((l) => l.trim());
  const title = (firstIdx >= 0 ? lines[firstIdx]!.trim().replace(/^#+\s*/, "") : "").slice(0, 128);
  const body = (firstIdx >= 0 ? lines.slice(firstIdx + 1) : lines).join("\n").trim();
  const tags = [...new Set([...caption.matchAll(/(^|\s)#([A-Za-z0-9]+)/g)].map((m) => m[2]!.toLowerCase()))].slice(0, 4);
  return { title, body, tags };
}

export const devtoPublisher: Publisher = {
  async publish({ accessToken: key, caption, media }: PublishInput): Promise<PublishResult> {
    if (media.some((m) => m.kind === "video")) throw new PublishError("DEV articles take images only.", "permanent");
    const { title, body, tags } = toArticle(caption);
    if (!title) throw new PublishError("DEV articles need a title on the first line.", "permanent");
    const [cover, ...inline] = media;
    const markdown = [body || title, ...inline.map((m) => `![${m.altText.replace(/[[\]]/g, "")}](${m.url})`)].join("\n\n");
    const res = await http(`${API}/articles`, {
      method: "POST",
      headers: headers(key),
      body: JSON.stringify({ article: { title, body_markdown: markdown, published: true, tags, ...(cover ? { main_image: cover.url } : {}) } }),
      timeoutMs: 60_000,
    });
    if (res.status >= 400) throw devtoError(res, "Publishing to DEV");
    const a = res.body as { id: number; url: string };
    return { externalId: String(a.id), url: a.url, warnings: [] };
  },
};
