import { and, inArray, isNotNull, lt, eq } from "drizzle-orm";
import { db } from "@/db";
import { mediaAssets, mediaVariants, organizations, workspaces } from "@/db/schema";
import { storage } from "./media/storage";

export const DELETION_GRACE_DAYS = 14;

/** Daily: permanently deletes organizations whose grace period has ended, including their media files. */
export async function purgeDeletedOrganizations(now = Date.now()) {
  const due = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(and(isNotNull(organizations.deletionRequestedAt), lt(organizations.deletionRequestedAt, new Date(now - DELETION_GRACE_DAYS * 86_400_000))));
  for (const org of due) {
    const ws = await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.orgId, org.id));
    const wsIds = ws.map((w) => w.id);
    const assets = wsIds.length ? await db.select({ id: mediaAssets.id, key: mediaAssets.storageKey }).from(mediaAssets).where(inArray(mediaAssets.workspaceId, wsIds)) : [];
    const variants = assets.length ? await db.select({ key: mediaVariants.storageKey }).from(mediaVariants).where(inArray(mediaVariants.assetId, assets.map((a) => a.id))) : [];
    await db.delete(organizations).where(eq(organizations.id, org.id)); // cascades to workspaces and everything in them
    for (const key of [...assets.map((a) => a.key), ...variants.map((v) => v.key)]) {
      await storage().remove(key).catch((e) => console.warn(`Couldn't remove ${key}`, e));
    }
    console.log(`Deleted organization ${org.id} (${wsIds.length} workspaces, ${assets.length} media files)`);
  }
  return due.length;
}
