import "server-only";
import { and, eq, gte, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { channels, postMetrics, postTargets } from "@/db/schema";
import { bestTimes } from "./best-times";

/** Loads the last 90 days of published posts with figures for a workspace (or one channel) and ranks the hours. */
export async function loadBestTimes(workspace: { id: string; timezone: string }, channelId: string | null = null) {
  const since = new Date(Date.now() - 90 * 86_400_000);
  const rows = await db
    .select({ postId: postTargets.postId, at: postTargets.publishedAt, likes: postMetrics.likes, comments: postMetrics.comments, shares: postMetrics.shares, saves: postMetrics.saves, clicks: postMetrics.clicks })
    .from(postTargets)
    .innerJoin(channels, eq(channels.id, postTargets.channelId))
    .innerJoin(postMetrics, eq(postMetrics.targetId, postTargets.id))
    .where(and(eq(channels.workspaceId, workspace.id), channelId ? eq(channels.id, channelId) : undefined, eq(postTargets.status, "published"), isNotNull(postTargets.publishedAt), gte(postTargets.publishedAt, since)));
  // One result per post: a post sent to three channels counts once, with its engagement added up.
  const byPost = new Map<string, { at: Date; engagement: number }>();
  for (const r of rows) {
    const e = (r.likes ?? 0) + (r.comments ?? 0) + (r.shares ?? 0) + (r.saves ?? 0) + (r.clicks ?? 0);
    const cur = byPost.get(r.postId);
    if (cur) cur.engagement += e;
    else byPost.set(r.postId, { at: r.at!, engagement: e });
  }
  const results = [...byPost.values()];
  return { sample: results.length, times: bestTimes(results, workspace.timezone) };
}
