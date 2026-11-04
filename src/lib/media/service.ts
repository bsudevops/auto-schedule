import "server-only";
import { and, eq, sum } from "drizzle-orm";
import { db } from "@/db";
import { mediaAssets, mediaFolders, mediaVariants } from "@/db/schema";
import { cleanFilename, detectKind, incomingKey, isIncomingKey, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, processUpload, storageKey, UploadError, WORKSPACE_QUOTA_BYTES } from "./pipeline";
import { directStorage, storage } from "./storage";

async function checkRoom(workspaceId: string, folderId: string | null, adding: number) {
  if (folderId) {
    const [f] = await db.select({ id: mediaFolders.id }).from(mediaFolders).where(and(eq(mediaFolders.id, folderId), eq(mediaFolders.workspaceId, workspaceId)));
    if (!f) throw new UploadError("That folder doesn't exist.");
  }
  const [used] = await db.select({ total: sum(mediaAssets.sizeBytes) }).from(mediaAssets).where(eq(mediaAssets.workspaceId, workspaceId));
  if (Number(used?.total ?? 0) + adding > WORKSPACE_QUOTA_BYTES) throw new UploadError("This workspace's 5 GB of media storage is full. Delete files you no longer need.");
}

/** The only way a file enters the media library. */
export async function createAsset(opts: { workspaceId: string; userId: string; data: Buffer; filename: string; folderId: string | null }) {
  const { workspaceId, userId, data, filename, folderId } = opts;
  await checkRoom(workspaceId, folderId, data.length);

  const file = await processUpload(data);
  const key = storageKey(workspaceId, file.ext);
  const s = storage();
  await s.put(key, file.body, file.mimeType);
  const variantRows = await Promise.all(
    file.variants.map(async (v) => {
      const vkey = key.replace(/\.[a-z0-9]+$/, `.${v.preset}.jpg`);
      await s.put(vkey, v.body, "image/jpeg");
      return { preset: v.preset, storageKey: vkey, width: v.width, height: v.height };
    }),
  );
  const [asset] = await db
    .insert(mediaAssets)
    .values({ workspaceId, folderId, storageKey: key, filename: cleanFilename(filename), mimeType: file.mimeType, kind: file.kind, sizeBytes: file.body.length, width: file.width, height: file.height, uploadedBy: userId })
    .returning();
  if (variantRows.length) await db.insert(mediaVariants).values(variantRows.map((v) => ({ ...v, assetId: asset!.id })));
  return asset!;
}

export async function deleteAsset(workspaceId: string, assetId: string) {
  const [asset] = await db.select().from(mediaAssets).where(and(eq(mediaAssets.id, assetId), eq(mediaAssets.workspaceId, workspaceId)));
  if (!asset) return false;
  const variants = await db.select({ key: mediaVariants.storageKey }).from(mediaVariants).where(eq(mediaVariants.assetId, assetId));
  await db.delete(mediaAssets).where(eq(mediaAssets.id, assetId));
  const s = storage();
  await Promise.allSettled([s.remove(asset.storageKey), ...variants.map((v) => s.remove(v.key))]);
  return true;
}

export const thumbKey = (key: string, kind: string) => (kind === "image" ? key.replace(/\.[a-z0-9]+$/, ".thumb.jpg") : key);

/* ------------------------- Direct uploads (S3) ------------------------- */

/** Step 1: checks the file the browser wants to send and returns a one-time link to upload it to. */
export async function startDirectUpload(opts: { workspaceId: string; folderId: string | null; size: number; filename: string }) {
  const direct = directStorage();
  if (!direct) return null;
  const { workspaceId, folderId, size } = opts;
  if (!Number.isInteger(size) || size <= 0) throw new UploadError("That file is empty.");
  if (size > MAX_VIDEO_BYTES) throw new UploadError("Videos can be up to 300 MB, and images up to 20 MB.");
  await checkRoom(workspaceId, folderId, size);
  const key = incomingKey(workspaceId);
  // The type is checked from the file's bytes afterwards, so the browser's claim only labels the upload.
  const url = await direct.presignPut(key, size, "application/octet-stream");
  return { key, url, headers: { "Content-Type": "application/octet-stream" } };
}

/**
 * Step 2: after the browser has uploaded, checks the file's real type and size, then adds it to the library.
 * Images are re-encoded like any other upload. Videos are moved inside the bucket, not downloaded.
 */
export async function finishDirectUpload(opts: { workspaceId: string; userId: string; key: string; filename: string; folderId: string | null }) {
  const direct = directStorage();
  if (!direct) throw new UploadError("Direct uploads aren't turned on.");
  const { workspaceId, userId, key, filename, folderId } = opts;
  if (!isIncomingKey(workspaceId, key)) throw new UploadError("That upload isn't valid.");
  const s = storage();
  const discard = () => s.remove(key).catch(() => undefined);
  try {
    const size = await direct.size(key);
    if (size === null) throw new UploadError("The file didn't arrive. Try uploading it again.");
    if (size > MAX_VIDEO_BYTES) throw new UploadError("Videos can be up to 300 MB, and images up to 20 MB.");
    const head = await detectKind(await direct.read(key, 4100));

    if (head.kind === "image") {
      if (size > MAX_IMAGE_BYTES) throw new UploadError("Images can be up to 20 MB.");
      return await createAsset({ workspaceId, userId, data: await direct.read(key), filename, folderId });
    }

    await checkRoom(workspaceId, folderId, size);
    const finalKey = storageKey(workspaceId, head.videoExt!);
    await direct.copy(key, finalKey, head.mime);
    const [asset] = await db
      .insert(mediaAssets)
      .values({ workspaceId, folderId, storageKey: finalKey, filename: cleanFilename(filename), mimeType: head.mime, kind: "video", sizeBytes: size, width: null, height: null, uploadedBy: userId })
      .returning();
    return asset!;
  } finally {
    await discard();
  }
}
