import { env, form, http, kindForStatus, poll, type HttpResponse } from "./http";
import { PublishError, type ConnectedAccount, type ProviderAdapter, type PublishInput, type PublishResult, type Publisher, type TokenSet } from "./types";

/**
 * Pinterest API v5. Each board is its own channel, so a post goes to a chosen board.
 * Images are pinned from their URL; videos are registered, uploaded, then pinned once processed.
 */
const API = () => (env("PINTEREST_SANDBOX") === "true" ? "https://api-sandbox.pinterest.com/v5" : "https://api.pinterest.com/v5");
const SCOPES = "boards:read,pins:read,pins:write,user_accounts:read";

type PinErr = { code?: number; message?: string };

export function pinterestError(res: HttpResponse, action: string): PublishError {
  const b = res.body as PinErr | null;
  const msg = b?.message || `HTTP ${res.status}`;
  if (res.status === 401) return new PublishError(`${action}: Pinterest rejected the access token. Reconnect the channel.`, "auth", b);
  if (res.status === 429) return new PublishError(`${action}: Pinterest rate limit reached. We'll retry later.`, "rate", b);
  return new PublishError(`${action}: ${msg}`, kindForStatus(res.status), b);
}

async function api<T>(method: "GET" | "POST", path: string, token: string, action: string, body?: unknown): Promise<T> {
  const res = await http(`${API()}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    timeoutMs: 60_000,
  });
  if (res.status >= 400) throw pinterestError(res, action);
  return res.body as T;
}

async function tokenRequest(params: Record<string, string>, action: string): Promise<TokenSet> {
  const basic = Buffer.from(`${env("PINTEREST_APP_ID")}:${env("PINTEREST_APP_SECRET")}`).toString("base64");
  const res = await http(`${API()}/oauth/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: form(params),
  });
  if (res.status >= 400) throw pinterestError(res, action);
  const b = res.body as { access_token: string; refresh_token?: string; expires_in?: number };
  return { accessToken: b.access_token, refreshToken: b.refresh_token ?? null, expiresAt: b.expires_in ? new Date(Date.now() + b.expires_in * 1000) : null };
}

type Board = { id: string; name: string; privacy?: string };

export const pinterestProvider: ProviderAdapter = {
  id: "pinterest",
  name: "Pinterest",
  platforms: ["pinterest"],
  envVars: ["PINTEREST_APP_ID", "PINTEREST_APP_SECRET"],
  configured: () => Boolean(env("PINTEREST_APP_ID") && env("PINTEREST_APP_SECRET")),
  authorizeUrl(state, redirectUri) {
    return `https://www.pinterest.com/oauth/?${form({ client_id: env("PINTEREST_APP_ID"), redirect_uri: redirectUri, response_type: "code", scope: SCOPES, state })}`;
  },
  async exchangeCode(code, redirectUri) {
    const t = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri }, "Signing in with Pinterest");
    const me = await api<{ username: string; profile_image?: string; follower_count?: number; business_name?: string }>("GET", "/user_account", t.accessToken, "Reading your Pinterest profile");
    const boards: Board[] = [];
    let bookmark = "";
    do {
      const page = await api<{ items: Board[]; bookmark?: string | null }>("GET", `/boards?${form({ page_size: "100", ...(bookmark ? { bookmark } : {}) })}`, t.accessToken, "Listing your boards");
      boards.push(...page.items);
      bookmark = page.bookmark ?? "";
    } while (bookmark && boards.length < 500);
    return boards
      .filter((b) => b.privacy !== "SECRET")
      .map((b): ConnectedAccount => ({
        platform: "pinterest",
        externalId: b.id,
        handle: me.username,
        displayName: `${me.business_name || me.username} · ${b.name}`,
        avatarUrl: me.profile_image ?? null,
        followers: me.follower_count ?? null,
        accessToken: t.accessToken,
        refreshToken: t.refreshToken,
        expiresAt: t.expiresAt?.toISOString() ?? null,
        meta: { boardId: b.id, boardName: b.name },
      }));
  },
  async refresh(refreshToken) {
    const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken }, "Refreshing the Pinterest token");
    return { ...t, refreshToken: t.refreshToken ?? refreshToken };
  },
};

/** The first line is the pin's title (100 characters); the whole caption is its description (500). */
export function pinText(caption: string) {
  const first = caption.split("\n").find((l) => l.trim())?.trim() ?? "";
  return { title: first.slice(0, 100), description: caption.slice(0, 500) };
}

/** The first link in the caption becomes the pin's destination. */
export const firstLink = (caption: string) => caption.match(/https?:\/\/[^\s<>"']+/)?.[0]?.replace(/[).,!?]+$/, "") ?? null;

async function uploadVideo(token: string, url: string, mimeType: string): Promise<string> {
  const reg = await api<{ media_id: string; upload_url: string; upload_parameters: Record<string, string> }>("POST", "/media", token, "Registering the video with Pinterest", { media_type: "video" });
  const file = await fetch(url, { signal: AbortSignal.timeout(600_000) }).catch(() => null);
  if (!file?.ok) throw new PublishError("Couldn't read the video file from storage.", "temporary");
  const fd = new FormData();
  for (const [k, v] of Object.entries(reg.upload_parameters)) fd.append(k, v);
  fd.append("file", new Blob([await file.arrayBuffer()], { type: mimeType }));
  const up = await fetch(reg.upload_url, { method: "POST", body: fd, redirect: "error", signal: AbortSignal.timeout(1_800_000) }).catch((e: Error) => {
    throw new PublishError(`The Pinterest video upload was interrupted: ${e.message}`, "temporary");
  });
  if (up.status >= 300) throw new PublishError(`Pinterest's storage refused the video (HTTP ${up.status}).`, up.status >= 500 ? "temporary" : "permanent");
  await poll(
    async () => {
      const s = await api<{ status: string }>("GET", `/media/${reg.media_id}`, token, "Checking the Pinterest video");
      if (s.status === "succeeded") return true;
      if (s.status === "failed") throw new PublishError("Pinterest couldn't process the video.", "permanent");
      return undefined;
    },
    { attempts: 60, intervalMs: 5_000, what: "The Pinterest video" },
  );
  return reg.media_id;
}

export const pinterestPublisher: Publisher = {
  async publish({ channel, accessToken: t, caption, media }: PublishInput): Promise<PublishResult> {
    const m = media[0];
    if (!m || media.length !== 1) throw new PublishError("Pinterest pins need one image or video.", "permanent");
    const boardId = String(channel.meta.boardId ?? channel.externalId);
    const { title, description } = pinText(caption);
    const link = firstLink(caption);
    const source =
      m.kind === "video"
        ? { source_type: "video_id", media_id: await uploadVideo(t, m.url, m.mimeType), cover_image_key_frame_time: 0 }
        : { source_type: "image_url", url: m.url };
    const pin = await api<{ id: string }>("POST", "/pins", t, "Creating the pin", {
      board_id: boardId,
      ...(title ? { title } : {}),
      description,
      ...(link ? { link } : {}),
      ...(m.altText ? { alt_text: m.altText.slice(0, 500) } : {}),
      media_source: source,
    });
    return { externalId: pin.id, url: `https://www.pinterest.com/pin/${pin.id}/`, warnings: [] };
  },
};
