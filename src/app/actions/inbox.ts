"use server";
import { revalidatePath } from "next/cache";
import { assignThread, sendReply, setThreadState } from "@/lib/inbox";
import { requireWorkspace } from "@/lib/session";

const refresh = (id: string) => revalidatePath(`/w/${id}`, "layout");

export async function replyAction(workspaceId: string, threadId: string, text: string) {
  const { member, workspace } = await requireWorkspace(workspaceId);
  const r = await sendReply({ member, workspace }, threadId, String(text ?? ""));
  if (r.ok) refresh(workspaceId);
  return r;
}

export async function assignAction(workspaceId: string, threadId: string, userId: string) {
  const { member, workspace } = await requireWorkspace(workspaceId);
  const r = await assignThread({ member, workspace }, threadId, userId || null);
  if (r.ok) refresh(workspaceId);
  return r;
}

export async function doneAction(workspaceId: string, threadId: string, done: boolean) {
  const { member, workspace } = await requireWorkspace(workspaceId);
  const r = await setThreadState({ member, workspace }, threadId, { done });
  if (r.ok) refresh(workspaceId);
  return r;
}

export async function markReadAction(workspaceId: string, threadId: string, unread = false) {
  const { member, workspace } = await requireWorkspace(workspaceId);
  const r = await setThreadState({ member, workspace }, threadId, { unread });
  if (r.ok) refresh(workspaceId);
  return r;
}
