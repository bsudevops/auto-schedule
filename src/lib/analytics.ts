import "server-only";
import { and, eq, gte, inArray, lte, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { channelMetricsDaily, channels, postMetrics, postTargets, posts } from "@/db/schema";
import { RANGES, shiftDay, summarize, type DayRow, type Range } from "./analytics-math";
import { zonedToUtc } from "./queue-slots";

export const todayIn = (timeZone: string, now = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

export const parseRange = (v: string | undefined): Range => (RANGES.find((r) => String(r) === v) ?? 30) as Range;

const startOfDay = (day: string, tz: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return zonedToUtc(y!, m!, d!, 0, 0, tz);
};

/** Everything the Analytics page and the CSV export need, for one workspace, range and (optionally) one channel. */
export async function loadAnalytics(workspace: { id: string; timezone: string }, range: Range, channelId: string | null) {
  const today = todayIn(workspace.timezone);
  const allChannels = await db
    .select({ id: channels.id, platform: channels.platform, displayName: channels.displayName, handle: channels.handle, followers: channels.followers })
    .from(channels)
    .where(and(eq(channels.workspaceId, workspace.id), ne(channels.status, "disconnected")));
  const selected = channelId ? allChannels.find((c) => c.id === channelId) ?? null : null;
  const ids = selected ? [selected.id] : allChannels.map((c) => c.id);
  const firstDay = shiftDay(today, -(2 * range) + 1);
  const from = startOfDay(shiftDay(today, -range + 1), workspace.timezone);
  const until = startOfDay(shiftDay(today, 1), workspace.timezone);

  const [rows, postCounts, top] = await Promise.all([
    ids.length
      ? db.select().from(channelMetricsDaily).where(and(inArray(channelMetricsDaily.channelId, ids), gte(channelMetricsDaily.day, firstDay), lte(channelMetricsDaily.day, today)))
      : Promise.resolve([]),
    ids.length
      ? db
          .select({ channelId: postTargets.channelId, n: sql<number>`count(*)::int` })
          .from(postTargets)
          .where(and(inArray(postTargets.channelId, ids), eq(postTargets.status, "published"), gte(postTargets.publishedAt, from), lte(postTargets.publishedAt, until)))
          .groupBy(postTargets.channelId)
      : Promise.resolve([]),
    ids.length
      ? db
          .select({
            postId: posts.id,
            caption: posts.caption,
            publishedAt: posts.publishedAt,
            platforms: sql<string[]>`array_agg(distinct ${channels.platform})`,
            reach: sql<number>`sum(coalesce(${postMetrics.reach}, ${postMetrics.impressions}, ${postMetrics.videoViews}, 0))::int`,
            engagements: sql<number>`sum(coalesce(${postMetrics.likes},0) + coalesce(${postMetrics.comments},0) + coalesce(${postMetrics.shares},0) + coalesce(${postMetrics.saves},0))::int`,
          })
          .from(postMetrics)
          .innerJoin(postTargets, eq(postTargets.id, postMetrics.targetId))
          .innerJoin(posts, eq(posts.id, postTargets.postId))
          .innerJoin(channels, eq(channels.id, postTargets.channelId))
          .where(and(inArray(postTargets.channelId, ids), gte(postTargets.publishedAt, from), lte(postTargets.publishedAt, until)))
          .groupBy(posts.id)
          .orderBy(sql`5 desc`)
          .limit(5)
      : Promise.resolve([]),
  ]);

  const dayRows: DayRow[] = rows.map((r) => ({ ...r, day: String(r.day) }));
  const summary = summarize(dayRows, {
    today,
    range,
    channelIds: allChannels.map((c) => c.id).filter((id) => ids.includes(id)),
    postsByChannel: Object.fromEntries(postCounts.map((p) => [p.channelId, p.n])),
  });
  // Fill in today's follower count from the channel itself when the platform hasn't reported a daily figure.
  const byChannel = summary.byChannel.map((s) => {
    const c = allChannels.find((x) => x.id === s.channelId)!;
    return { ...s, followers: s.followers ?? c.followers, name: c.displayName, platform: c.platform };
  });
  return { today, range, channels: allChannels, selected, summary: { ...summary, byChannel }, top, rows: dayRows.filter((r) => r.day > shiftDay(today, -range)) };
}
