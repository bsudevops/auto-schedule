"use server";
import { and, eq, gt, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { channels, posts, queueChannels, queueSlots, queues } from "@/db/schema";
import { logActivity } from "@/lib/activity";
import { shuffleTimes } from "@/lib/queue-slots";
import { requireWorkspace } from "@/lib/session";

const done = (ws: string) => revalidatePath(`/w/${ws}`, "layout");

export async function createQueue(workspaceId: string, name: string, channelIds: string[]) {
  const { user } = await requireWorkspace(workspaceId, "publish");
  const n = z.string().trim().min(1).max(60).safeParse(name);
  if (!n.success) return { error: "Enter a queue name up to 60 characters." };
  const owned = channelIds.length ? await db.select({ id: channels.id }).from(channels).where(and(eq(channels.workspaceId, workspaceId), inArray(channels.id, channelIds))) : [];
  const [q] = await db.insert(queues).values({ workspaceId, name: n.data }).returning();
  if (owned.length) await db.insert(queueChannels).values(owned.map((c) => ({ queueId: q!.id, channelId: c.id })));
  await logActivity({ workspaceId, actorId: user.id, verb: "queue.created", summary: `created the queue “${n.data}”`, href: `/w/${workspaceId}/calendar?view=queues` });
  done(workspaceId);
  return { ok: "Queue created." };
}

async function ownQueue(workspaceId: string, queueId: string) {
  const [q] = await db.select().from(queues).where(and(eq(queues.id, queueId), eq(queues.workspaceId, workspaceId)));
  return q;
}

export async function addSlot(workspaceId: string, queueId: string, weekday: number, time: string) {
  await requireWorkspace(workspaceId, "publish");
  if (!(await ownQueue(workspaceId, queueId))) return { error: "That queue no longer exists." };
  const t = /^(\d{2}):(\d{2})$/.exec(time);
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6 || !t) return { error: "Pick a day and time." };
  await db.insert(queueSlots).values({ queueId, weekday, minuteOfDay: Number(t[1]) * 60 + Number(t[2]) });
  done(workspaceId);
  return { ok: "Slot added." };
}

export async function removeSlot(workspaceId: string, queueId: string, slotId: string) {
  await requireWorkspace(workspaceId, "publish");
  if (!(await ownQueue(workspaceId, queueId))) return { error: "That queue no longer exists." };
  await db.delete(queueSlots).where(and(eq(queueSlots.id, slotId), eq(queueSlots.queueId, queueId)));
  done(workspaceId);
  return { ok: "Slot removed." };
}

export async function deleteQueue(workspaceId: string, queueId: string) {
  const { user } = await requireWorkspace(workspaceId, "publish");
  const [q] = await db.delete(queues).where(and(eq(queues.id, queueId), eq(queues.workspaceId, workspaceId))).returning({ name: queues.name });
  if (q) await logActivity({ workspaceId, actorId: user.id, verb: "queue.deleted", summary: `deleted the queue “${q.name}”` });
  done(workspaceId);
  return { ok: "Queue deleted. Its posts keep their times." };
}

/**
 * Deals the queue's upcoming times out to its posts in a new random order. Posts due within the
 * next two minutes are left alone so the worker never races a change.
 */
export async function shuffleQueue(workspaceId: string, queueId: string) {
  const { user } = await requireWorkspace(workspaceId, "publish");
  const q = await ownQueue(workspaceId, queueId);
  if (!q) return { error: "That queue no longer exists." };
  const moved = await db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: posts.id, at: posts.scheduledAt })
      .from(posts)
      .where(and(eq(posts.queueId, queueId), eq(posts.workspaceId, workspaceId), eq(posts.status, "scheduled"), gt(posts.scheduledAt, new Date(Date.now() + 120_000))))
      .orderBy(posts.scheduledAt)
      .for("update");
    if (rows.length < 2) return 0;
    for (const r of shuffleTimes(rows.map((x) => ({ id: x.id, at: x.at! })))) {
      await tx.update(posts).set({ scheduledAt: r.at }).where(and(eq(posts.id, r.id), eq(posts.status, "scheduled")));
    }
    return rows.length;
  });
  if (!moved) return { error: "Shuffling needs at least two upcoming posts in this queue." };
  await logActivity({ workspaceId, actorId: user.id, verb: "queue.shuffled", summary: `shuffled ${moved} posts in “${q.name}”`, href: `/w/${workspaceId}/calendar?view=list` });
  done(workspaceId);
  return { ok: `Shuffled ${moved} posts. They keep the same times in a new order.` };
}
