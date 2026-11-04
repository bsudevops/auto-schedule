import "server-only";
import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/db";
import { channels, hashtagSets, ideas, mediaAssets, postMedia, postTargets, posts, queueSlots, queues } from "@/db/schema";
import { aiConfigured } from "@/lib/ai";
import { stockConfigured } from "@/lib/stock";
import { publicUrl } from "@/lib/media/storage";
import { thumbKey } from "@/lib/media/service";
import { canEditPost, can, type Member } from "@/lib/permissions";
import { nextOpenSlot } from "@/lib/queue-slots";
import type { ComposerProps } from "./Composer";

function localDateTime(d: Date, timeZone: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

export async function loadComposer(opts: { member: Member; workspace: { id: string; timezone: string; defaultHashtags: string; defaultFirstComment: string }; postId?: string; mediaId?: string; ideaId?: string; date?: string }): Promise<ComposerProps | null> {
  const { member, workspace } = opts;
  const wsId = workspace.id;
  const [chans, assets, qs, sets] = await Promise.all([
    db.select({ id: channels.id, platform: channels.platform, handle: channels.handle, displayName: channels.displayName, status: channels.status })
      .from(channels).where(and(eq(channels.workspaceId, wsId), ne(channels.status, "disconnected"))).orderBy(asc(channels.platform)),
    db.select().from(mediaAssets).where(eq(mediaAssets.workspaceId, wsId)).orderBy(desc(mediaAssets.createdAt)).limit(60),
    db.select().from(queues).where(eq(queues.workspaceId, wsId)).orderBy(asc(queues.name)),
    db.select({ id: hashtagSets.id, name: hashtagSets.name, tags: hashtagSets.tags }).from(hashtagSets).where(eq(hashtagSets.workspaceId, wsId)).orderBy(asc(hashtagSets.name)),
  ]);
  const slots = qs.length ? await db.select().from(queueSlots).where(inArray(queueSlots.queueId, qs.map((q) => q.id))) : [];
  const now = new Date();
  const queueOptions = await Promise.all(qs.map(async (q) => {
    const taken = await db.select({ at: posts.scheduledAt }).from(posts).where(and(eq(posts.queueId, q.id), eq(posts.status, "scheduled")));
    const next = nextOpenSlot(slots.filter((s) => s.queueId === q.id), now, workspace.timezone, taken.map((t) => t.at!).filter(Boolean));
    return { id: q.id, name: q.name, next: next ? new Intl.DateTimeFormat("en-US", { timeZone: workspace.timezone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(next) : null };
  }));

  const inTwoHours = localDateTime(new Date(now.getTime() + 2 * 3600_000), workspace.timezone);
  let initial: ComposerProps["initial"] = {
    channelIds: chans.filter((c) => c.status !== "reconnect").slice(0, 2).map((c) => c.id),
    caption: workspace.defaultHashtags ? `\n\n${workspace.defaultHashtags}` : "",
    overrides: {}, mediaIds: [], firstComment: workspace.defaultFirstComment, tags: [],
    mode: "schedule", date: opts.date && /^\d{4}-\d{2}-\d{2}$/.test(opts.date) ? opts.date : inTwoHours.date, time: inTwoHours.time, queueId: qs[0]?.id,
  };
  let postStatus: string | null = null;

  if (opts.postId) {
    const [p] = await db.select().from(posts).where(and(eq(posts.id, opts.postId), eq(posts.workspaceId, wsId)));
    if (!p) return null;
    const [targets, pm] = await Promise.all([
      db.select().from(postTargets).where(eq(postTargets.postId, p.id)),
      db.select().from(postMedia).where(eq(postMedia.postId, p.id)).orderBy(asc(postMedia.position)),
    ]);
    const when = p.scheduledAt ? localDateTime(p.scheduledAt, workspace.timezone) : inTwoHours;
    initial = {
      postId: p.id, channelIds: targets.map((t) => t.channelId), caption: p.caption,
      overrides: Object.fromEntries(targets.filter((t) => t.captionOverride != null).map((t) => [t.channelId, t.captionOverride!])),
      mediaIds: pm.map((m) => m.assetId), firstComment: p.firstComment, tags: p.tags,
      mode: p.status === "draft" ? "draft" : p.queueId ? "queue" : "schedule", date: when.date, time: when.time, queueId: p.queueId ?? qs[0]?.id,
    };
    postStatus = p.status;
    if (!canEditPost(member, p)) postStatus = "readonly";
  } else {
    if (opts.mediaId) initial.mediaIds = assets.some((a) => a.id === opts.mediaId) ? [opts.mediaId] : [];
    if (opts.ideaId) {
      const [idea] = await db.select().from(ideas).where(and(eq(ideas.id, opts.ideaId), eq(ideas.workspaceId, wsId)));
      if (idea) initial.caption = `${idea.title}${idea.notes ? `\n\n${idea.notes}` : ""}${initial.caption}`;
    }
  }

  return {
    workspaceId: wsId,
    timezone: workspace.timezone,
    canPublish: can(member, "publish"),
    postStatus,
    channels: chans,
    media: assets.map((a) => ({ id: a.id, kind: a.kind, filename: a.filename, thumb: publicUrl(thumbKey(a.storageKey, a.kind)), url: publicUrl(a.storageKey) })),
    queues: queueOptions,
    hashtagSets: sets,
    aiEnabled: aiConfigured(),
    stockEnabled: stockConfigured() && can(member, "upload_media"),
    initial,
  };
}
