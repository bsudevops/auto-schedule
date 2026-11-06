"use server";
import { and, asc, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { channels, hashtagSets, mediaAssets, type Platform } from "@/db/schema";
import { AI_TASKS, AiError, aiConfigured, writeWithAI } from "@/lib/ai";
import { MAX_IMAGES, MediaAiError, writeFromMedia, type MediaSuggestions } from "@/lib/ai-media";
import { geminiConfigured } from "@/lib/gemini";
import { DriveError, driveConfig, downloadDriveFile, isAccessToken, isDriveFileId } from "@/lib/drive";
import { cleanTags } from "@/lib/hashtags";
import { overLimit } from "@/lib/limits";
import { UploadError } from "@/lib/media/pipeline";
import { createAsset, thumbKey } from "@/lib/media/service";
import { publicUrl } from "@/lib/media/storage";
import { PLATFORMS } from "@/lib/platforms";
import { requireWorkspace } from "@/lib/session";
import { downloadStock, searchStock, StockError, type StockPhoto } from "@/lib/stock";

/* ----------------------------- Writing help ---------------------------- */

const AiInput = z.object({
  task: z.enum(AI_TASKS),
  text: z.string().trim().min(1, "Write something first, or a few words about the topic.").max(5000, "That text is too long for writing help."),
  channelIds: z.array(z.string().uuid()).max(50),
});

export async function aiWriteAction(workspaceId: string, input: unknown): Promise<{ suggestions: string[] } | { error: string }> {
  const { user } = await requireWorkspace(workspaceId, "create_posts");
  if (!aiConfigured()) return { error: "Writing help isn't set up on this server." };
  const parsed = AiInput.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the text and try again." };
  if (await overLimit(`ai:${user.id}`, 30, 3600)) return { error: "You've used writing help a lot this hour. Try again later." };

  // Only this workspace's channels count towards the platforms and the character limit.
  const chans = parsed.data.channelIds.length
    ? await db.select({ id: channels.id, platform: channels.platform }).from(channels).where(eq(channels.workspaceId, workspaceId))
    : [];
  const platforms = [...new Set(chans.filter((c) => parsed.data.channelIds.includes(c.id)).map((c) => c.platform as Platform))];
  const limit = Math.min(3000, ...platforms.map((p) => PLATFORMS[p].captionLimit));
  try {
    return { suggestions: await writeWithAI({ task: parsed.data.task, text: parsed.data.text, platforms: platforms.map((p) => PLATFORMS[p].name), limit }) };
  } catch (e) {
    if (e instanceof AiError) return { error: e.message };
    console.error("Writing help failed", e);
    return { error: "Writing help didn't work. Try again." };
  }
}

const MediaAiInput = z.object({
  mediaIds: z.array(z.string().uuid()).min(1, "Add an image or a video to the post first.").max(MAX_IMAGES + 10),
  channelIds: z.array(z.string().uuid()).max(50),
  notes: z.string().max(2000, "Those notes are too long.").default(""),
});

/** Writes captions, YouTube titles and hashtags from the post's media, with Gemini. */
export async function aiFromMediaAction(workspaceId: string, input: unknown): Promise<MediaSuggestions | { error: string }> {
  const { user } = await requireWorkspace(workspaceId, "create_posts");
  if (!geminiConfigured()) return { error: "Writing from media isn't set up on this server. Add GEMINI_API_KEY to .env." };
  const parsed = MediaAiInput.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the post and try again." };
  if (await overLimit(`ai-media:${user.id}`, 20, 3600)) return { error: "You've used writing from media a lot this hour. Try again later." };

  const { mediaIds, channelIds, notes } = parsed.data;
  const rows = await db.select().from(mediaAssets).where(and(eq(mediaAssets.workspaceId, workspaceId), inArray(mediaAssets.id, mediaIds)));
  const media = mediaIds.map((id) => rows.find((r) => r.id === id)).filter((r) => r != null);
  if (!media.length) return { error: "Add an image or a video to the post first." };
  const chans = channelIds.length
    ? await db.select({ id: channels.id, platform: channels.platform }).from(channels).where(and(eq(channels.workspaceId, workspaceId), inArray(channels.id, channelIds)))
    : [];
  const platforms = [...new Set(chans.map((c) => c.platform as Platform))];
  const limit = Math.min(3000, ...platforms.map((p) => PLATFORMS[p].captionLimit));
  try {
    return await writeFromMedia({
      media: media.map((m) => ({ id: m.id, kind: m.kind, mimeType: m.mimeType, storageKey: m.storageKey, filename: m.filename, altText: m.altText, sizeBytes: m.sizeBytes })),
      platforms: platforms.map((p) => PLATFORMS[p].name),
      limit,
      notes,
      wantTitle: platforms.includes("youtube"),
    });
  } catch (e) {
    if (e instanceof MediaAiError) return { error: e.message };
    console.error("Writing from media failed", e);
    return { error: "Writing from media didn't work. Try again." };
  }
}

/* ----------------------------- Hashtag sets ---------------------------- */

export async function listHashtagSets(workspaceId: string) {
  await requireWorkspace(workspaceId);
  return db.select({ id: hashtagSets.id, name: hashtagSets.name, tags: hashtagSets.tags }).from(hashtagSets).where(eq(hashtagSets.workspaceId, workspaceId)).orderBy(asc(hashtagSets.name));
}

export async function saveHashtagSetAction(workspaceId: string, input: { name: string; tags: string }) {
  const { user } = await requireWorkspace(workspaceId, "create_posts");
  const name = z.string().trim().min(1).max(40).safeParse(input.name);
  if (!name.success) return { error: "Give the set a name up to 40 characters." };
  const tags = cleanTags(String(input.tags ?? ""));
  if (!tags.length) return { error: "Add at least one hashtag." };
  const count = await db.$count(hashtagSets, eq(hashtagSets.workspaceId, workspaceId));
  const [existing] = await db.select({ id: hashtagSets.id }).from(hashtagSets).where(and(eq(hashtagSets.workspaceId, workspaceId), eq(hashtagSets.name, name.data)));
  if (existing) await db.update(hashtagSets).set({ tags }).where(eq(hashtagSets.id, existing.id));
  else {
    if (count >= 100) return { error: "This workspace already has 100 hashtag sets. Delete one first." };
    await db.insert(hashtagSets).values({ workspaceId, name: name.data, tags, createdBy: user.id });
  }
  revalidatePath(`/w/${workspaceId}/compose`);
  return { ok: existing ? "Hashtag set updated." : "Hashtag set saved.", sets: await listHashtagSets(workspaceId) };
}

export async function deleteHashtagSetAction(workspaceId: string, setId: string) {
  await requireWorkspace(workspaceId, "create_posts");
  await db.delete(hashtagSets).where(and(eq(hashtagSets.id, setId), eq(hashtagSets.workspaceId, workspaceId)));
  revalidatePath(`/w/${workspaceId}/compose`);
  return { ok: "Hashtag set deleted.", sets: await listHashtagSets(workspaceId) };
}

/* ----------------------------- Stock photos ---------------------------- */

export async function searchStockAction(workspaceId: string, query: string, page = 1): Promise<{ photos: StockPhoto[]; hasMore: boolean } | { error: string }> {
  const { user } = await requireWorkspace(workspaceId, "upload_media");
  if (await overLimit(`stock:${user.id}`, 120, 3600)) return { error: "Too many searches this hour. Try again later." };
  try {
    return await searchStock(String(query ?? ""), Number(page) || 1);
  } catch (e) {
    if (e instanceof StockError) return { error: e.message };
    console.error("Stock search failed", e);
    return { error: "Stock photo search didn't work. Try again." };
  }
}

/** Adds a stock photo to the media library and returns it ready for the composer. */
export async function importStockAction(workspaceId: string, photoId: string) {
  const { user } = await requireWorkspace(workspaceId, "upload_media");
  if (await overLimit(`stock-import:${user.id}`, 60, 3600)) return { error: "Too many imports this hour. Try again later." };
  try {
    const photo = await downloadStock(String(photoId ?? ""));
    const asset = await createAsset({ workspaceId, userId: user.id, data: photo.data, filename: photo.filename, folderId: null });
    await db.update(mediaAssets).set({ altText: photo.alt.slice(0, 1000) }).where(eq(mediaAssets.id, asset.id));
    revalidatePath(`/w/${workspaceId}/media`);
    return {
      ok: photo.credit,
      media: { id: asset.id, kind: asset.kind, filename: asset.filename, thumb: publicUrl(thumbKey(asset.storageKey, asset.kind)), url: publicUrl(asset.storageKey) },
    };
  } catch (e) {
    if (e instanceof StockError || e instanceof UploadError) return { error: e.message };
    console.error("Stock import failed", e);
    return { error: "Couldn't add that photo. Try again." };
  }
}

/* ----------------------------- Google Drive ---------------------------- */

/**
 * Copies files picked in Google Drive into app storage and returns them ready for the composer.
 * Platforms fetch media from a public address, so a Drive file can't be posted straight from Drive.
 */
export async function importDriveAction(workspaceId: string, fileIds: unknown, token: unknown) {
  const { user } = await requireWorkspace(workspaceId, "upload_media");
  if (!driveConfig()) return { error: "Google Drive isn't set up on this server.", media: [], errors: [] };
  const ids = Array.isArray(fileIds) ? [...new Set(fileIds.filter(isDriveFileId))].slice(0, 10) : [];
  if (!ids.length) return { error: "Pick at least one photo or video.", media: [], errors: [] };
  if (!isAccessToken(token)) return { error: "Your Google sign-in expired. Choose the files again.", media: [], errors: [] };
  if (await overLimit(`drive-import:${user.id}`, 100, 3600)) return { error: "Too many files from Drive this hour. Try again later.", media: [], errors: [] };

  const media: Array<{ id: string; kind: "image" | "video"; filename: string; thumb: string; url: string }> = [];
  const errors: string[] = [];
  // One at a time, so a few large videos don't all sit in memory together.
  for (const id of ids) {
    try {
      const file = await downloadDriveFile(id, token);
      const asset = await createAsset({ workspaceId, userId: user.id, data: file.data, filename: file.filename, folderId: null });
      media.push({ id: asset.id, kind: asset.kind, filename: asset.filename, thumb: publicUrl(thumbKey(asset.storageKey, asset.kind)), url: publicUrl(asset.storageKey) });
    } catch (e) {
      if (e instanceof DriveError || e instanceof UploadError) errors.push(e.message);
      else {
        console.error("Drive import failed", e);
        errors.push("A file couldn't be copied from Google Drive. Try again.");
      }
    }
  }
  if (media.length) revalidatePath(`/w/${workspaceId}/media`);
  return { media, errors };
}
