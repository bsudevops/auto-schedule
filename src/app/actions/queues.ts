"use server";
import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { channels, queueChannels, queueSlots, queues } from "@/db/schema";
import { requireWorkspace } from "@/lib/session";

const done = (ws: string) => revalidatePath(`/w/${ws}`, "layout");

export async function createQueue(workspaceId: string, name: string, channelIds: string[]) {
  await requireWorkspace(workspaceId, "publish");
  const n = z.string().trim().min(1).max(60).safeParse(name);
  if (!n.success) return { error: "Enter a queue name up to 60 characters." };
  const owned = channelIds.length ? await db.select({ id: channels.id }).from(channels).where(and(eq(channels.workspaceId, workspaceId), inArray(channels.id, channelIds))) : [];
  const [q] = await db.insert(queues).values({ workspaceId, name: n.data }).returning();
  if (owned.length) await db.insert(queueChannels).values(owned.map((c) => ({ queueId: q!.id, channelId: c.id })));
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
  await requireWorkspace(workspaceId, "publish");
  await db.delete(queues).where(and(eq(queues.id, queueId), eq(queues.workspaceId, workspaceId)));
  done(workspaceId);
  return { ok: "Queue deleted. Its posts keep their times." };
}
