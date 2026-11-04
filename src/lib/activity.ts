import { and, desc, eq, lt } from "drizzle-orm";
import { db } from "@/db";
import { activityLog, user } from "@/db/schema";

/**
 * The team activity feed. Entries are written after the change they describe has succeeded, and a
 * failure to write one never breaks the change itself.
 */
export type Verb =
  | "post.created" | "post.scheduled" | "post.updated" | "post.rescheduled" | "post.deleted" | "post.retried"
  | "post.published" | "post.failed"
  | "queue.created" | "queue.deleted" | "queue.shuffled"
  | "channel.connected" | "channel.disconnected" | "channel.removed"
  | "member.invited" | "member.role" | "member.removed";

export async function logActivity(e: { workspaceId: string; actorId: string | null; verb: Verb; summary: string; href?: string | null }) {
  try {
    await db.insert(activityLog).values({ workspaceId: e.workspaceId, actorId: e.actorId, verb: e.verb, summary: e.summary.slice(0, 300), href: e.href ?? null });
  } catch (err) {
    console.error("Couldn't record activity", err);
  }
}

/** A post's first line, for activity summaries. */
export const postTitle = (caption: string) => {
  const t = caption.split("\n").find((l) => l.trim())?.trim() ?? "";
  return t ? `“${t.length > 60 ? `${t.slice(0, 59)}…` : t}”` : "an untitled post";
};

export async function recentActivity(workspaceId: string, opts: { limit?: number; before?: Date } = {}) {
  return db
    .select({ id: activityLog.id, verb: activityLog.verb, summary: activityLog.summary, href: activityLog.href, at: activityLog.createdAt, actor: user.name, actorImage: user.image })
    .from(activityLog)
    .leftJoin(user, eq(user.id, activityLog.actorId))
    .where(and(eq(activityLog.workspaceId, workspaceId), opts.before ? lt(activityLog.createdAt, opts.before) : undefined))
    .orderBy(desc(activityLog.createdAt))
    .limit(opts.limit ?? 20);
}
