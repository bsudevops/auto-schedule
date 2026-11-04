"use server";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { channels, pendingConnections } from "@/db/schema";
import { accountKey, loadPending, saveChannels } from "@/lib/channels";
import { requireWorkspace } from "@/lib/session";

/** Adds the accounts the user picked after OAuth. */
export async function finishConnectAction(workspaceId: string, pendingId: string, formData: FormData) {
  const { user } = await requireWorkspace(workspaceId, "manage_channels");
  const pending = await loadPending(pendingId, workspaceId, user.id);
  if (!pending) redirect(`/w/${workspaceId}/channels?error=connect_expired`);
  const picked = new Set(formData.getAll("account").map(String));
  const chosen = pending.accounts.filter((a) => picked.has(accountKey(a)));
  if (chosen.length) await saveChannels(workspaceId, user.id, chosen);
  await db.delete(pendingConnections).where(eq(pendingConnections.id, pending.id));
  revalidatePath(`/w/${workspaceId}`, "layout");
  redirect(`/w/${workspaceId}/channels?connected=${chosen.length}`);
}

export async function cancelConnectAction(workspaceId: string, pendingId: string) {
  const { user } = await requireWorkspace(workspaceId, "manage_channels");
  await db.delete(pendingConnections).where(and(eq(pendingConnections.id, pendingId), eq(pendingConnections.workspaceId, workspaceId), eq(pendingConnections.userId, user.id)));
  redirect(`/w/${workspaceId}/channels`);
}

/** Stops publishing to a channel and deletes its tokens. Its post history stays. */
export async function disconnectChannelAction(workspaceId: string, channelId: string) {
  await requireWorkspace(workspaceId, "manage_channels");
  await db
    .update(channels)
    .set({ status: "disconnected", accessTokenEnc: null, refreshTokenEnc: null, tokenExpiresAt: null, lastError: null })
    .where(and(eq(channels.id, channelId), eq(channels.workspaceId, workspaceId)));
  revalidatePath(`/w/${workspaceId}`, "layout");
  return { ok: true };
}

/** Removes a disconnected channel for good, including its post history on that channel. */
export async function removeChannelAction(workspaceId: string, channelId: string) {
  await requireWorkspace(workspaceId, "manage_channels");
  await db.delete(channels).where(and(eq(channels.id, channelId), eq(channels.workspaceId, workspaceId), eq(channels.status, "disconnected")));
  revalidatePath(`/w/${workspaceId}`, "layout");
  return { ok: true };
}
