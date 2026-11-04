"use server";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { channels, pendingConnections } from "@/db/schema";
import { accountKey, loadPending, saveChannels, savePending } from "@/lib/channels";
import { PROVIDERS, PublishError, isProvider } from "@/lib/publishing";
import { redis } from "@/lib/redis";
import { requireWorkspace } from "@/lib/session";

/**
 * Connects a channel from a form (Bluesky app password, DEV API key): checks the credentials with the
 * platform, then sends the person to the same account picker as OAuth. Limited to 10 tries per 10 minutes.
 */
export async function connectWithCredentialsAction(workspaceId: string, provider: string, input: Record<string, string>): Promise<{ error: string } | never> {
  const { user } = await requireWorkspace(workspaceId, "manage_channels");
  if (!isProvider(provider)) return { error: "Unknown platform." };
  const adapter = PROVIDERS[provider];
  if (adapter.connect !== "credentials" || !adapter.connectWithCredentials) return { error: "This platform connects through its own sign-in page." };
  const allowed = new Set((adapter.fields ?? []).map((f) => f.name));
  const clean = Object.fromEntries(Object.entries(input).filter(([k, v]) => allowed.has(k) && typeof v === "string").map(([k, v]) => [k, v.slice(0, 500)]));

  try {
    const bucket = `connect-tries:${user.id}`;
    const n = await redis().incr(bucket);
    if (n === 1) await redis().expire(bucket, 600);
    if (n > 10) return { error: "Too many tries. Wait a few minutes and try again." };
  } catch {
    // Redis down: carry on rather than block connecting
  }

  let pendingId: string;
  try {
    const accounts = await adapter.connectWithCredentials(clean);
    if (!accounts.length) return { error: "No account was found for those details." };
    pendingId = await savePending(workspaceId, user.id, provider, accounts);
  } catch (e) {
    if (e instanceof PublishError) return { error: e.message };
    console.error(`Connecting ${provider} failed`, e);
    return { error: "That didn't work. Check the details and try again." };
  }
  redirect(`/w/${workspaceId}/channels/connect?pending=${pendingId}`);
}

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
