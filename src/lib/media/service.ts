import "server-only";
import { and, eq, sum } from "drizzle-orm";
import { db } from "@/db";
import { mediaAssets, mediaFolders, mediaVariants } from "@/db/schema";
import { cleanFilename, processUpload, storageKey, UploadError, WORKSPACE_QUOTA_BYTES } from "./pipeline";
import { storage } from "./storage";

/** The only way a file enters the media library. */
export async function createAsset(opts: { workspaceId: string; userId: string; data: Buffer; filename: string; folderId: string | null }) {
  const { workspaceId, userId, data, filename, folderId } = opts;
  if (folderId) {
    const [f] = await db.select({ id: mediaFolders.id }).from(mediaFolders).where(and(eq(mediaFolders.id, folderId), eq(mediaFolders.workspaceId, workspaceId)));
    if (!f) throw new UploadError("That folder doesn't exist.");
  }
  const [used] = await db.select({ total: sum(mediaAssets.sizeBytes) }).from(mediaAssets).where(eq(mediaAssets.workspaceId, workspaceId));
  if (Number(used?.total ?? 0) + data.length > WORKSPACE_QUOTA_BYTES) throw new UploadError("This workspace's 5 GB of media storage is full. Delete files you no longer need.");

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
