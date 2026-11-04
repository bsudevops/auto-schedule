"use server";
import { revalidatePath } from "next/cache";
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
