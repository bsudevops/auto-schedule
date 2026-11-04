import { randomUUID } from "node:crypto";
import { fileTypeFromBuffer } from "file-type";
import sharp, { type Metadata, type Sharp } from "sharp";

/** File types we accept, detected from the file's bytes. The name and the browser's claimed type are ignored. */
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/avif"]);
const VIDEO_TYPES: Record<string, string> = { "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm" };

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 300 * 1024 * 1024;
export const WORKSPACE_QUOTA_BYTES = 5 * 1024 * 1024 * 1024;

/** Sizes made for each image so every channel gets a version that fits. */
export const VARIANTS = [
  { preset: "square", width: 1080, height: 1080 },
  { preset: "portrait", width: 1080, height: 1350 },
  { preset: "landscape", width: 1200, height: 628 },
  { preset: "thumb", width: 400, height: 400 },
] as const;

export class UploadError extends Error {}

export type ProcessedFile = {
  kind: "image" | "video";
  mimeType: string;
  ext: string;
  body: Buffer;
  width: number | null;
  height: number | null;
  variants: Array<{ preset: string; body: Buffer; width: number; height: number }>;
};

/** What a file is, from its first bytes. Used to check a direct upload without downloading all of it. */
export async function detectKind(head: Buffer): Promise<{ kind: "image" | "video"; mime: string; videoExt?: string }> {
  const detected = await fileTypeFromBuffer(head);
  if (detected && IMAGE_TYPES.has(detected.mime)) return { kind: "image", mime: detected.mime };
  const videoExt = detected ? VIDEO_TYPES[detected.mime] : undefined;
  if (detected && videoExt) return { kind: "video", mime: detected.mime, videoExt };
  throw new UploadError("This file type isn't supported. Upload a JPEG, PNG, WebP, GIF, MP4, MOV or WebM file.");
}

/** Where a direct upload waits until it has been checked. Only the server hands out these keys. */
// Under one prefix so the bucket can delete leftovers automatically (a lifecycle rule on "incoming/").
export const incomingKey = (workspaceId: string) => `incoming/${workspaceId}/${randomUUID()}`;
export const isIncomingKey = (workspaceId: string, key: string) => new RegExp(`^incoming/${workspaceId}/[0-9a-f-]{36}$`, "i").test(key);

/**
 * Checks and normalises one upload. Images are decoded and re-encoded, which drops metadata
 * and anything hidden after the image data. Output names always use our own extension.
 */
export async function processUpload(input: Buffer): Promise<ProcessedFile> {
  const detected = await fileTypeFromBuffer(input);
  if (!detected) throw new UploadError("This file type isn't supported. Upload a JPEG, PNG, WebP, GIF, MP4, MOV or WebM file.");

  if (IMAGE_TYPES.has(detected.mime)) {
    if (input.length > MAX_IMAGE_BYTES) throw new UploadError("Images can be up to 20 MB.");
    let img: Sharp;
    let meta: Metadata;
    try {
      img = sharp(input, { failOn: "error", limitInputPixels: 80_000_000 }).rotate();
      meta = await img.metadata();
    } catch {
      throw new UploadError("This image couldn't be read. It may be damaged.");
    }
    const keepAlpha = Boolean(meta.hasAlpha) && detected.mime === "image/png";
    const resized = img.resize({ width: 4096, height: 4096, fit: "inside", withoutEnlargement: true });
    const { data, info } = keepAlpha
      ? await resized.png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true })
      : await resized.flatten({ background: "#ffffff" }).jpeg({ quality: 88, mozjpeg: true }).toBuffer({ resolveWithObject: true });

    const variants = await Promise.all(
      VARIANTS.map(async (v) => ({
        preset: v.preset,
        width: v.width,
        height: v.height,
        body: await sharp(data).resize(v.width, v.height, { fit: "cover", position: "attention" }).flatten({ background: "#ffffff" }).jpeg({ quality: 85 }).toBuffer(),
      })),
    );
    return { kind: "image", mimeType: keepAlpha ? "image/png" : "image/jpeg", ext: keepAlpha ? "png" : "jpg", body: data, width: info.width, height: info.height, variants };
  }

  const videoExt = VIDEO_TYPES[detected.mime];
  if (videoExt) {
    if (input.length > MAX_VIDEO_BYTES) throw new UploadError("Videos can be up to 300 MB.");
    return { kind: "video", mimeType: detected.mime, ext: videoExt, body: input, width: null, height: null, variants: [] };
  }

  throw new UploadError("This file type isn't supported. Upload a JPEG, PNG, WebP, GIF, MP4, MOV or WebM file.");
}

/** A server-chosen storage key. The uploader's filename is never part of it. */
export function storageKey(workspaceId: string, ext: string, now = new Date()) {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `ws/${workspaceId}/${y}/${m}/${randomUUID()}.${ext}`;
}

/** Keeps a display name readable and harmless. */
export function cleanFilename(name: string) {
  const base = name.split(/[\\/]/).pop() ?? "file";
  return base.replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 120) || "file";
}
