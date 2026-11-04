"use server";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { mediaAssets, mediaFolders } from "@/db/schema";
import { deleteAsset } from "@/lib/media/service";
import { requireWorkspace } from "@/lib/session";

export async function updateAltText(workspaceId: string, assetId: string, altText: string) {
  await requireWorkspace(workspaceId, "upload_media");
  const alt = z.string().trim().max(1000).parse(altText);
  await db.update(mediaAssets).set({ altText: alt }).where(and(eq(mediaAssets.id, assetId), eq(mediaAssets.workspaceId, workspaceId)));
  revalidatePath(`/w/${workspaceId}/media`);
  return { ok: "Alt text saved." };
}

export async function deleteMedia(workspaceId: string, assetId: string) {
  await requireWorkspace(workspaceId, "delete_media");
  const ok = await deleteAsset(workspaceId, assetId);
  revalidatePath(`/w/${workspaceId}/media`);
  return ok ? { ok: "File deleted." } : { error: "That file no longer exists." };
}

export async function createFolder(workspaceId: string, name: string) {
  await requireWorkspace(workspaceId, "upload_media");
  const parsed = z.string().trim().min(1).max(60).safeParse(name);
  if (!parsed.success) return { error: "Enter a folder name up to 60 characters." };
  await db.insert(mediaFolders).values({ workspaceId, name: parsed.data });
  revalidatePath(`/w/${workspaceId}/media`);
  return { ok: "Folder created." };
}
