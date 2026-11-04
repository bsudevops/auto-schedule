import "server-only";
import { and, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { channels, mediaAssets, postMedia, postTargets, posts, queueSlots, queues } from "@/db/schema";
import { can, canEditPost, type Member } from "./permissions";
import { checkPost } from "./post-rules";
import { nextOpenSlot, zonedToUtc } from "./queue-slots";

export const postInput = z.object({
  postId: z.string().uuid().optional(),
  channelIds: z.array(z.string().uuid()).max(20),
  caption: z.string().max(100_000),
  overrides: z.record(z.string().uuid(), z.string().max(100_000)).default({}),
  mediaIds: z.array(z.string().uuid()).max(10).default([]),
  firstComment: z.string().max(2200).default(""),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  mode: z.enum(["draft", "now", "schedule", "queue"]),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  queueId: z.string().uuid().optional(),
});
export type PostInput = z.infer<typeof postInput>;

type Ctx = { member: Member; workspace: { id: string; timezone: string } };
type Result = { ok: true; id: string; scheduledAt: Date | null; status: string } | { ok: false; error: string };

/** Creates or updates a post. Used by the composer and, later, by the API, so the rules are the same everywhere. */
export async function savePost(ctx: Ctx, raw: unknown): Promise<Result> {
  const parsed = postInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Some of the post details are invalid. Reload the page and try again." };
  const input = parsed.data;
  const wsId = ctx.workspace.id;
  if (!can(ctx.member, "create_posts")) return { ok: false, error: "You don't have permission to create posts." };
  if (input.mode !== "draft" && !can(ctx.member, "publish")) return { ok: false, error: "Your role can save drafts but not schedule them. Ask an editor or manager to schedule it." };

  let existing: typeof posts.$inferSelect | undefined;
  if (input.postId) {
    [existing] = await db.select().from(posts).where(and(eq(posts.id, input.postId), eq(posts.workspaceId, wsId)));
    if (!existing) return { ok: false, error: "That post no longer exists." };
    if (!canEditPost(ctx.member, existing)) return { ok: false, error: "You can't edit this post." };
    if (existing.status === "published") return { ok: false, error: "Published posts can't be edited here. Duplicate it to post again." };
  }

  const chans = input.channelIds.length
    ? await db.select({ id: channels.id, platform: channels.platform, handle: channels.handle, status: channels.status })
        .from(channels).where(and(eq(channels.workspaceId, wsId), inArray(channels.id, input.channelIds), ne(channels.status, "disconnected")))
    : [];
  if (chans.length !== input.channelIds.length) return { ok: false, error: "One of the channels was disconnected. Reload the page." };
  const media = input.mediaIds.length
    ? await db.select({ id: mediaAssets.id, kind: mediaAssets.kind }).from(mediaAssets).where(and(eq(mediaAssets.workspaceId, wsId), inArray(mediaAssets.id, input.mediaIds)))
    : [];
  if (media.length !== new Set(input.mediaIds).size) return { ok: false, error: "One of the media files was deleted. Remove it and try again." };
  const orderedMedia = input.mediaIds.map((id) => media.find((m) => m.id === id)!);
  const overrides = Object.fromEntries(Object.entries(input.overrides).filter(([id]) => input.channelIds.includes(id)));

  let scheduledAt: Date | null = null;
  let queueId: string | null = null;
  if (input.mode !== "draft") {
    const problems = checkPost(chans, input.caption, overrides, orderedMedia);
    if (problems.length) return { ok: false, error: problems.join(" ") };
    const now = new Date();
    if (input.mode === "now") scheduledAt = now;
    if (input.mode === "schedule") {
      if (!input.date || !input.time) return { ok: false, error: "Pick a date and time." };
      const [y, mo, d] = input.date.split("-").map(Number);
      const [h, mi] = input.time.split(":").map(Number);
      scheduledAt = zonedToUtc(y!, mo!, d!, h!, mi!, ctx.workspace.timezone);
      if (scheduledAt.getTime() < now.getTime() + 60_000) return { ok: false, error: "Pick a time at least a minute from now, or choose Publish now." };
    }
    if (input.mode === "queue") {
      if (!input.queueId) return { ok: false, error: "Pick a queue." };
      const [q] = await db.select().from(queues).where(and(eq(queues.id, input.queueId), eq(queues.workspaceId, wsId)));
      if (!q) return { ok: false, error: "That queue no longer exists." };
      const [slots, taken] = await Promise.all([
        db.select().from(queueSlots).where(eq(queueSlots.queueId, q.id)),
        db.select({ at: posts.scheduledAt }).from(posts).where(and(eq(posts.queueId, q.id), eq(posts.status, "scheduled"), input.postId ? ne(posts.id, input.postId) : undefined)),
      ]);
      scheduledAt = nextOpenSlot(slots, now, ctx.workspace.timezone, taken.map((t) => t.at!).filter(Boolean));
      if (!scheduledAt) return { ok: false, error: `“${q.name}” has no open time slots. Add slots to the queue first.` };
      queueId = q.id;
    }
  }

  const status = input.mode === "draft" ? "draft" : "scheduled";
  const values = { caption: input.caption, firstComment: input.firstComment, tags: input.tags, status, scheduledAt, queueId } as const;
  const id = await db.transaction(async (tx) => {
    let postId = existing?.id;
    if (postId) await tx.update(posts).set(values).where(eq(posts.id, postId));
    else [{ id: postId }] = (await tx.insert(posts).values({ ...values, workspaceId: wsId, authorId: ctx.member.userId }).returning({ id: posts.id })) as [{ id: string }];
    await tx.delete(postTargets).where(eq(postTargets.postId, postId!));
    if (chans.length) await tx.insert(postTargets).values(chans.map((c) => ({ postId: postId!, channelId: c.id, captionOverride: overrides[c.id] ?? null })));
    await tx.delete(postMedia).where(eq(postMedia.postId, postId!));
    if (orderedMedia.length) await tx.insert(postMedia).values(orderedMedia.map((m, i) => ({ postId: postId!, assetId: m.id, position: i })));
    return postId!;
  });
  return { ok: true, id, scheduledAt, status };
}

/** Moves a post to a new time. Same permission rule as editing. */
export async function reschedulePost(ctx: Ctx, postId: string, at: Date): Promise<{ ok: boolean; error?: string }> {
  const [p] = await db.select().from(posts).where(and(eq(posts.id, postId), eq(posts.workspaceId, ctx.workspace.id)));
  if (!p) return { ok: false, error: "That post no longer exists." };
  if (!canEditPost(ctx.member, p)) return { ok: false, error: "You can't move this post." };
  if (p.status === "published") return { ok: false, error: "Published posts can't be moved." };
  if (p.status === "scheduled" && !can(ctx.member, "publish")) return { ok: false, error: "Your role can't reschedule posts." };
  if (at.getTime() < Date.now() + 60_000) return { ok: false, error: "Pick a time in the future." };
  // A draft dropped on the calendar keeps its draft status and just gets a planned date.
  await db.update(posts).set({ scheduledAt: at, queueId: null }).where(eq(posts.id, p.id));
  return { ok: true };
}

export async function deletePost(ctx: Ctx, postId: string): Promise<{ ok: boolean; error?: string }> {
  const [p] = await db.select().from(posts).where(and(eq(posts.id, postId), eq(posts.workspaceId, ctx.workspace.id)));
  if (!p) return { ok: false, error: "That post no longer exists." };
  if (!canEditPost(ctx.member, p) && !(p.status === "published" && can(ctx.member, "edit_others_posts"))) return { ok: false, error: "You can't delete this post." };
  await db.delete(posts).where(eq(posts.id, p.id));
  return { ok: true };
}
