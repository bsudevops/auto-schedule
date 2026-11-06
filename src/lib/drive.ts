import { MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, UploadError } from "./media/pipeline";

/**
 * Google Drive as a media source. The browser signs in with Google and picks files in Google's own
 * Picker, using the narrow `drive.file` scope (only files the person picks, nothing else in their Drive).
 * It sends back the file IDs and the short-lived access token; the server then downloads each file from
 * googleapis.com and copies it into app storage, because the platforms need a public copy to publish.
 * The token is used for those downloads only and is never stored.
 */
const API = "https://www.googleapis.com/drive/v3/files";

const env = (name: string) => process.env[name]?.trim() || "";

/**
 * The OAuth client used in the browser. Falls back to the Google sign-in client, then to the YouTube publishing
 * client; either works when Drive is enabled in its project and APP_URL is one of its JavaScript origins.
 */
const clientId = () => env("GOOGLE_DRIVE_CLIENT_ID") || env("GOOGLE_CLIENT_ID") || env("GOOGLE_PUBLISH_CLIENT_ID");

/** Google's "app ID" is the Cloud project number, which is also the start of every client ID from that project. */
export function appIdFrom(id: string, override = "") {
  if (override) return override;
  return /^(\d+)-/.exec(id)?.[1] ?? "";
}

export type DriveConfig = { clientId: string; apiKey: string; appId: string };

/** What the browser needs to open the Picker, or null when Drive isn't set up. All three values are public by design. */
export function driveConfig(): DriveConfig | null {
  const id = clientId();
  const apiKey = env("GOOGLE_DRIVE_API_KEY");
  const appId = appIdFrom(id, env("GOOGLE_DRIVE_APP_ID"));
  return id && apiKey && appId ? { clientId: id, apiKey, appId } : null;
}

export class DriveError extends Error {}

/** Drive file IDs are letters, digits, "-" and "_". Anything else never reaches Google. */
export const isDriveFileId = (id: unknown): id is string => typeof id === "string" && /^[A-Za-z0-9_-]{10,200}$/.test(id);
export const isAccessToken = (t: unknown): t is string => typeof t === "string" && /^[A-Za-z0-9._~+/=-]{20,4096}$/.test(t);

type DriveFile = { id: string; name: string; mimeType: string; size?: string; trashed?: boolean };

/** Checks a file's details before downloading: only images and videos, within the upload limits. */
export function checkDriveFile(f: DriveFile): { kind: "image" | "video"; size: number } {
  if (f.mimeType.startsWith("application/vnd.google-apps")) throw new DriveError(`${f.name} is a Google ${f.mimeType.includes("folder") ? "folder" : "Docs file"}, not a photo or video.`);
  const kind = f.mimeType.startsWith("image/") ? "image" : f.mimeType.startsWith("video/") ? "video" : null;
  if (!kind) throw new DriveError(`${f.name} isn't a photo or video.`);
  const size = Number(f.size ?? 0);
  const max = kind === "image" ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
  if (size > max) throw new DriveError(`${f.name} is too big. ${kind === "image" ? "Images can be up to 20 MB" : "Videos can be up to 300 MB"}.`);
  return { kind, size };
}

async function drive(url: string, token: string, timeoutMs: number) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, redirect: "error", signal: AbortSignal.timeout(timeoutMs) }).catch(() => null);
  if (!res) throw new DriveError("Couldn't reach Google Drive. Try again.");
  if (res.status === 401) throw new DriveError("Your Google sign-in expired. Choose the files again.");
  if (res.status === 403 || res.status === 404) throw new DriveError("That file can't be opened. Pick it again from Google Drive, or check it's shared with you.");
  if (res.status === 429) throw new DriveError("Google Drive is busy. Try again in a minute.");
  if (!res.ok) throw new DriveError("Google Drive didn't respond. Try again.");
  return res;
}

/** Reads a response body, stopping as soon as it passes `max` bytes. */
async function readCapped(res: Response, max: number, name: string) {
  const reader = res.body?.getReader();
  if (!reader) throw new DriveError(`${name} came back empty.`);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      throw new UploadError(`${name} is too big.`);
    }
    chunks.push(value);
  }
  if (!total) throw new DriveError(`${name} is empty.`);
  return Buffer.concat(chunks, total);
}

/** Downloads one picked file. */
export async function downloadDriveFile(fileId: string, token: string): Promise<{ data: Buffer; filename: string }> {
  if (!isDriveFileId(fileId)) throw new DriveError("Unknown file.");
  if (!isAccessToken(token)) throw new DriveError("Your Google sign-in expired. Choose the files again.");
  const base = `${API}/${encodeURIComponent(fileId)}`;
  const meta = (await (await drive(`${base}?${new URLSearchParams({ fields: "id,name,mimeType,size,trashed", supportsAllDrives: "true" })}`, token, 15_000)).json()) as DriveFile;
  const { kind } = checkDriveFile(meta);
  const res = await drive(`${base}?${new URLSearchParams({ alt: "media", supportsAllDrives: "true" })}`, token, 5 * 60_000);
  const data = await readCapped(res, kind === "image" ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES, meta.name);
  return { data, filename: meta.name };
}
