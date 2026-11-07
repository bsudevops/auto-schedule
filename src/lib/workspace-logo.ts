import "server-only";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { publicUrl, storage } from "@/lib/media/storage";

/** Logos are small square PNGs. The browser shrinks the file first, so this is a generous ceiling. */
export const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const SIZE = 256;

/** The public address of a workspace's logo, or null when it has none. */
export const workspaceLogoUrl = (key: string | null | undefined) => (key ? publicUrl(key) : null);

/**
 * Re-encodes an uploaded image as a 256×256 PNG (fitted inside, transparent padding) and stores it.
 * Re-encoding drops anything that isn't pixels, so SVG scripts or odd metadata never reach the bucket.
 */
export async function storeWorkspaceLogo(workspaceId: string, data: Buffer): Promise<string> {
  if (!data.length) throw new LogoError("Choose an image file.");
  if (data.length > MAX_LOGO_BYTES) throw new LogoError("That image is too large. Use one under 2 MB.");
  let png: Buffer;
  try {
    const img = sharp(data, { failOn: "error", limitInputPixels: 40_000_000 });
    const meta = await img.metadata();
    if (!meta.format || !["png", "jpeg", "webp", "gif", "avif"].includes(meta.format)) throw new LogoError("Use a PNG, JPG or WebP image.");
    png = await img.rotate().resize(SIZE, SIZE, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  } catch (e) {
    if (e instanceof LogoError) throw e;
    throw new LogoError("That file isn't an image we can read. Use a PNG, JPG or WebP image.");
  }
  const key = `logos/${workspaceId}/${randomUUID()}.png`;
  await storage().put(key, png, "image/png");
  return key;
}

export async function removeWorkspaceLogoFile(key: string | null | undefined) {
  if (!key) return;
  await storage().remove(key).catch(() => undefined);
}

export class LogoError extends Error {}
