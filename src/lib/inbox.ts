import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { channels, inboxMessages, inboxThreads, workspaceMembers } from "@/db/schema";
import { notify } from "./notify";
import { can, type Member } from "./permissions";
import { PLATFORMS } from "./platforms";
import { ENGAGE } from "./publishing/engage";
import { dryRun } from "./publishing/run";
import { accessTokenFor, flagChannel } from "./publishing/tokens";
import { PublishError } from "./publishing/types";

type Ctx = { member: Member; workspace: { id: string; name: string } };
type Result = { ok: true } | { ok: false; error: string };

async function loadThread(ctx: Ctx, threadId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(threadId)) return null;
  const [row] = await db
    .select({ thread: inboxThreads, channel: channels })
    .from(inboxThreads)
    .innerJoin(channels, eq(channels.id, inboxThreads.channelId))
    .where(and(eq(inboxThreads.id, threadId), eq(inboxThreads.workspaceId, ctx.workspace.id)));
  return row ?? null;
}

/** Sends a reply on the platform, then records it. Nothing is recorded if the platform refuses. */
export async function sendReply(ctx: Ctx, threadId: string, raw: string): Promise<Result> {
  if (!can(ctx.member, "reply_inbox")) return { ok: false, error: "Your role can't reply in the inbox." };
  const text = raw.trim();
  if (!text) return { ok: false, error: "Write a reply first." };
  if (text.length > 2000) return { ok: false, error: "Replies can be up to 2,000 characters." };
  const row = await loadThread(ctx, threadId);
  if (!row) return { ok: false, error: "That conversation no longer exists." };
  const { thread, channel } = row;

  let externalId: string | null = null;
  if (!dryRun()) {
    const src = ENGAGE[channel.platform];
    if (!src?.reply) return { ok: false, error: `${PLATFORMS[channel.platform].name} doesn't allow replies through its API. Reply in the ${PLATFORMS[channel.platform].name} app.` };
    if (channel.status === "disconnected" || channel.status === "reconnect") return { ok: false, error: `Reconnect ${PLATFORMS[channel.platform].name} to reply.` };
    try {
      const accessToken = await accessTokenFor(channel);
      externalId = await src.reply({ channel: { externalId: channel.externalId, handle: channel.handle, meta: channel.meta }, accessToken }, { externalId: thread.externalId, meta: thread.meta }, text);
    } catch (e) {
      if (e instanceof PublishError) {
        if (e.kind === "auth") await flagChannel(channel, "reconnect", e.message);
        return { ok: false, error: e.message };
      }
      console.error("Inbox reply failed", e);
      return { ok: false, error: "The reply didn't send. Try again." };
    }
  }
  const now = new Date();
  await db.insert(inboxMessages).values({ threadId: thread.id, fromUs: true, sentBy: ctx.member.userId, body: text, externalId, createdAt: now });
  await db.update(inboxThreads).set({ unread: false, lastMessageAt: now }).where(eq(inboxThreads.id, thread.id));
  return { ok: true };
}

export async function assignThread(ctx: Ctx, threadId: string, userId: string | null): Promise<Result> {
  if (!can(ctx.member, "reply_inbox")) return { ok: false, error: "Your role can't assign conversations." };
  const row = await loadThread(ctx, threadId);
  if (!row) return { ok: false, error: "That conversation no longer exists." };
  if (userId) {
    const [m] = await db.select().from(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, ctx.workspace.id), eq(workspaceMembers.userId, userId)));
    if (!m || !can({ userId, role: m.role, active: true }, "reply_inbox")) return { ok: false, error: "That person can't reply in this workspace." };
  }
  await db.update(inboxThreads).set({ assignedTo: userId }).where(eq(inboxThreads.id, row.thread.id));
  if (userId && userId !== ctx.member.userId) {
    await notify({
      userIds: [userId],
      workspaceId: ctx.workspace.id,
      type: "inbox_assigned",
      payload: { title: `A conversation with ${row.thread.authorName} was assigned to you`, body: `${ctx.workspace.name}: ${row.thread.subject}`, href: `/w/${ctx.workspace.id}/inbox?thread=${row.thread.id}` },
    });
  }
  return { ok: true };
}

export async function setThreadState(ctx: Ctx, threadId: string, change: { done?: boolean; unread?: boolean }): Promise<Result> {
  if (!can(ctx.member, change.done === undefined ? "view" : "reply_inbox")) return { ok: false, error: "Your role can't change conversations." };
  const row = await loadThread(ctx, threadId);
  if (!row) return { ok: false, error: "That conversation no longer exists." };
  await db
    .update(inboxThreads)
    .set({
      ...(change.done !== undefined ? { doneAt: change.done ? new Date() : null, unread: false } : {}),
      ...(change.unread !== undefined ? { unread: change.unread } : {}),
    })
    .where(eq(inboxThreads.id, row.thread.id));
  return { ok: true };
}
