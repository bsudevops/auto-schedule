"use server";
import { and, eq, isNotNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { postTargets, posts } from "@/db/schema";
import { checkPostRemovals } from "@/lib/publishing/sync";
import { deletePost, reschedulePost, retryFailed, savePost } from "@/lib/posts";
import { zonedToUtc } from "@/lib/queue-slots";
import { requireWorkspace } from "@/lib/session";

export async function savePostAction(workspaceId: string, input: unknown) {
  const { member, workspace } = await requireWorkspace(workspaceId);
  const r = await savePost({ member, workspace }, input);
  if (r.ok) revalidatePath(`/w/${workspaceId}`, "layout");
  return r.ok ? { ok: true as const, id: r.id, status: r.status, scheduledAt: r.scheduledAt?.toISOString() ?? null } : r;
}

/** Moves a post to a local date and time in the workspace's time zone (used by calendar drag and drop). */
export async function reschedulePostAction(workspaceId: string, postId: string, date: string, time: string) {
  const { member, workspace } = await requireWorkspace(workspaceId);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return { ok: false, error: "Invalid date." };
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const at = zonedToUtc(y!, mo!, d!, h!, mi!, workspace.timezone);
  const r = await reschedulePost({ member, workspace }, postId, at);
  if (r.ok) revalidatePath(`/w/${workspaceId}`, "layout");
  return r;
}

export async function deletePostAction(workspaceId: string, postId: string) {
  const { member, workspace } = await requireWorkspace(workspaceId);
  const r = await deletePost({ member, workspace }, postId);
  if (r.ok) revalidatePath(`/w/${workspaceId}`, "layout");
  return r;
}

export async function retryFailedAction(workspaceId: string, postId: string) {
  const { member, workspace } = await requireWorkspace(workspaceId);
  const r = await retryFailed({ member, workspace }, postId);
  if (r.ok) revalidatePath(`/w/${workspaceId}`, "layout");
  return r;
}

/** Asks the platforms whether this post's published copies still exist, and updates its marks. */
export async function checkPostOnPlatformsAction(workspaceId: string, postId: string) {
  const { workspace } = await requireWorkspace(workspaceId);
  if (!/^[0-9a-f-]{36}$/i.test(postId)) return { ok: false as const, error: "That post no longer exists." };
  const [p] = await db.select({ id: posts.id }).from(posts).where(and(eq(posts.id, postId), eq(posts.workspaceId, workspace.id)));
  if (!p) return { ok: false as const, error: "That post no longer exists." };
  try {
    const r = await checkPostRemovals(p.id);
    revalidatePath(`/w/${workspaceId}`, "layout");
    return { ok: true as const, removed: r.removed };
  } catch (e) {
    return { ok: false as const, error: `Couldn't check right now: ${(e as Error).message}` };
  }
}

/** Hides the Overview alert for a post deleted on a platform. The post stays marked on the calendar and its page. */
export async function dismissRemovedAlertAction(workspaceId: string, postId: string) {
  const { workspace } = await requireWorkspace(workspaceId);
  if (!/^[0-9a-f-]{36}$/i.test(postId)) return { ok: false as const };
  const [p] = await db.select({ id: posts.id }).from(posts).where(and(eq(posts.id, postId), eq(posts.workspaceId, workspace.id)));
  if (!p) return { ok: false as const };
  await db.update(postTargets).set({ removedDismissedAt: new Date() }).where(and(eq(postTargets.postId, p.id), isNotNull(postTargets.removedAt)));
  revalidatePath(`/w/${workspaceId}`, "layout");
  return { ok: true as const };
}
