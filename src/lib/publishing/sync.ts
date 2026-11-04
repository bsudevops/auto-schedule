import { and, eq, gte, isNotNull, not, sql, like } from "drizzle-orm";
import { db } from "@/db";
import { channelMetricsDaily, channels, inboxMessages, inboxThreads, postMetrics, postTargets, posts } from "@/db/schema";
import { classifySentiment } from "../sentiment";
import { ENGAGE, type Ctx, type RemoteComment } from "./engage";
import { dryRun } from "./run";
import { accessTokenFor, flagChannel } from "./tokens";
import { PublishError } from "./types";

type Channel = typeof channels.$inferSelect;
const DAY = 86_400_000;

async function ctxFor(c: Channel): Promise<Ctx> {
  return { channel: { externalId: c.externalId, handle: c.handle, meta: c.meta }, accessToken: await accessTokenFor(c) };
}

/** Published targets on this channel with a real platform ID, newest first. */
async function recentTargets(channelId: string, days: number) {
  return db
    .select({ id: postTargets.id, externalPostId: postTargets.externalPostId, caption: posts.caption })
    .from(postTargets)
    .innerJoin(posts, eq(posts.id, postTargets.postId))
    .where(
      and(
        eq(postTargets.channelId, channelId),
        eq(postTargets.status, "published"),
        isNotNull(postTargets.externalPostId),
        not(like(postTargets.externalPostId, "dry-run-%")),
        gte(postTargets.publishedAt, new Date(Date.now() - days * DAY)),
      ),
    )
    .limit(100);
}

/** Pulls follower counts, daily figures for the last few days and per-post figures for the last 30 days. */
export async function syncInsights(c: Channel) {
  const src = ENGAGE[c.platform];
  if (!src) return;
  const ctx = await ctxFor(c);
  const today = new Date().toISOString().slice(0, 10);

  const followers = await src.followers(ctx);
  if (followers !== null) {
    await db.update(channels).set({ followers }).where(eq(channels.id, c.id));
    await db.insert(channelMetricsDaily).values({ channelId: c.id, day: today, followers })
      .onConflictDoUpdate({ target: [channelMetricsDaily.channelId, channelMetricsDaily.day], set: { followers } });
  }

  if (src.daily) {
    const until = new Date();
    const rows = await src.daily(ctx, new Date(until.getTime() - 4 * DAY), until);
    for (const r of rows) {
      const v = { impressions: r.impressions ?? null, reach: r.reach ?? null, engagements: r.engagements ?? null, videoViews: r.videoViews ?? null, linkClicks: r.linkClicks ?? null };
      await db.insert(channelMetricsDaily).values({ channelId: c.id, day: r.day, ...v }).onConflictDoUpdate({
        target: [channelMetricsDaily.channelId, channelMetricsDaily.day],
        // Keep the followers snapshot; only overwrite figures the platform actually returned.
        set: {
          impressions: sql`coalesce(excluded.impressions, ${channelMetricsDaily.impressions})`,
          reach: sql`coalesce(excluded.reach, ${channelMetricsDaily.reach})`,
          engagements: sql`coalesce(excluded.engagements, ${channelMetricsDaily.engagements})`,
          videoViews: sql`coalesce(excluded.video_views, ${channelMetricsDaily.videoViews})`,
          linkClicks: sql`coalesce(excluded.link_clicks, ${channelMetricsDaily.linkClicks})`,
        },
      });
    }
  }

  for (const t of await recentTargets(c.id, 30)) {
    try {
      const f = await src.post(ctx, t.externalPostId!);
      const v = { impressions: f.impressions ?? null, reach: f.reach ?? null, likes: f.likes ?? null, comments: f.comments ?? null, shares: f.shares ?? null, saves: f.saves ?? null, videoViews: f.videoViews ?? null, clicks: f.clicks ?? null, fetchedAt: new Date() };
      await db.insert(postMetrics).values({ targetId: t.id, ...v }).onConflictDoUpdate({ target: postMetrics.targetId, set: v });
    } catch (e) {
      if (e instanceof PublishError && (e.kind === "auth" || e.kind === "rate")) throw e;
      // A deleted post or one without figures shouldn't stop the rest.
    }
  }
}

/** Pulls comments on posts from the last 14 days into the inbox. Each top-level comment is one conversation. */
export async function syncInbox(c: Channel): Promise<number> {
  const src = ENGAGE[c.platform];
  if (!src?.comments) return 0;
  const ctx = await ctxFor(c);
  let added = 0;
  for (const t of await recentTargets(c.id, 14)) {
    let list: RemoteComment[];
    try {
      list = await src.comments(ctx, t.externalPostId!);
    } catch (e) {
      if (e instanceof PublishError && (e.kind === "auth" || e.kind === "rate")) throw e;
      continue;
    }
    for (const top of list) {
      if (top.fromUs) continue;
      added += await upsertConversation(c, t, top);
    }
  }
  return added;
}

async function upsertConversation(c: Channel, t: { id: string; externalPostId: string | null; caption: string }, top: RemoteComment) {
  const messages = [top, ...top.replies].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const lastIncoming = [...messages].reverse().find((m) => !m.fromUs);
  const [thread] = await db
    .insert(inboxThreads)
    .values({
      workspaceId: c.workspaceId,
      channelId: c.id,
      kind: "comment",
      externalId: top.id,
      subject: t.caption.split("\n")[0]!.slice(0, 80),
      authorName: top.author,
      sentiment: classifySentiment(lastIncoming?.text ?? top.text),
      postTargetId: t.id,
      meta: { postId: t.externalPostId },
      unread: false,
      lastMessageAt: messages.at(-1)!.createdAt,
    })
    .onConflictDoUpdate({ target: [inboxThreads.channelId, inboxThreads.externalId], set: { authorName: top.author } })
    .returning();
  let newIncoming = 0;
  for (const m of messages) {
    const [row] = await db
      .insert(inboxMessages)
      .values({ threadId: thread!.id, fromUs: m.fromUs, authorName: m.fromUs ? null : m.author, body: m.text, externalId: m.id, createdAt: m.createdAt })
      .onConflictDoNothing()
      .returning({ id: inboxMessages.id });
    if (row && !m.fromUs) newIncoming++;
  }
  if (newIncoming) {
    // A new message reopens the conversation and marks it unread.
    await db.update(inboxThreads).set({ unread: true, doneAt: null, lastMessageAt: messages.at(-1)!.createdAt, sentiment: classifySentiment(lastIncoming!.text) }).where(eq(inboxThreads.id, thread!.id));
  }
  return newIncoming;
}

/** Runs one kind of sync over every connected channel. One channel's failure never stops the others. */
export async function syncAll(kind: "insights" | "inbox") {
  if (dryRun()) return { skipped: "dry run" };
  const rows = await db.select().from(channels).where(eq(channels.status, "connected"));
  const expiring = await db.select().from(channels).where(eq(channels.status, "expiring"));
  let ok = 0;
  for (const c of [...rows, ...expiring]) {
    try {
      if (kind === "insights") await syncInsights(c);
      else await syncInbox(c);
      ok++;
    } catch (e) {
      if (e instanceof PublishError && e.kind === "auth") await flagChannel(c, "reconnect", e.message);
      else console.warn(`Sync ${kind} failed for channel ${c.id}: ${(e as Error).message}`);
    }
  }
  return { ok };
}
