import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { channels, postMedia, postTargets, posts } from "@/db/schema";

/** The public shape of a post in the REST API. */
export async function serializePosts(ids: string[]) {
  if (!ids.length) return [];
  const [rows, targets, media] = await Promise.all([
    db.select().from(posts).where(inArray(posts.id, ids)),
    db
      .select({ postId: postTargets.postId, channelId: postTargets.channelId, platform: channels.platform, status: postTargets.status, url: postTargets.externalUrl, error: postTargets.error, captionOverride: postTargets.captionOverride, options: postTargets.options, publishedAt: postTargets.publishedAt })
      .from(postTargets)
      .innerJoin(channels, eq(channels.id, postTargets.channelId))
      .where(inArray(postTargets.postId, ids)),
    db.select().from(postMedia).where(inArray(postMedia.postId, ids)).orderBy(asc(postMedia.position)),
  ]);
  return ids
    .map((id) => rows.find((r) => r.id === id))
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
    .map((p) => ({
      id: p.id,
      status: p.status,
      caption: p.caption,
      firstComment: p.firstComment,
      tags: p.tags,
      scheduledAt: p.scheduledAt,
      publishedAt: p.publishedAt,
      mediaIds: media.filter((m) => m.postId === p.id).map((m) => m.assetId),
      channels: targets.filter((t) => t.postId === p.id).map((t) => ({ channelId: t.channelId, platform: t.platform, status: t.status, url: t.url, error: t.error, captionOverride: t.captionOverride, options: t.options, publishedAt: t.publishedAt })),
      createdAt: p.createdAt,
    }));
}

export async function postInWorkspace(postId: string, workspaceId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(postId)) return null;
  const [p] = await db.select({ id: posts.id }).from(posts).where(and(eq(posts.id, postId), eq(posts.workspaceId, workspaceId)));
  return p ?? null;
}
