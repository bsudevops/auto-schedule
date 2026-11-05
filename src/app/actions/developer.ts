"use server";
import { and, count, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { apiKeys, oauthGrants, webhooks } from "@/db/schema";
import { revokeGrant } from "@/lib/oauth";
import { API_SCOPES } from "@/lib/api-auth";
import { encryptSecret, newApiKey } from "@/lib/crypto";
import { checkWebhookUrl } from "@/lib/safe-http";
import { requireWorkspace } from "@/lib/session";
import { WEBHOOK_EVENTS, emitEvent, newWebhookSecret } from "@/lib/webhooks";

type Created = { ok: true; secret: string } | { ok: false; error: string };
const refresh = (id: string) => revalidatePath(`/w/${id}/settings/developer`);

const keyInput = z.object({
  name: z.string().trim().min(1, "Give the key a name, such as the tool that will use it.").max(60),
  scopes: z.array(z.enum(Object.keys(API_SCOPES) as [string, ...string[]])).min(1, "Pick at least one permission."),
});

export async function createApiKeyAction(workspaceId: string, name: string, scopes: string[]): Promise<Created> {
  const { user } = await requireWorkspace(workspaceId, "manage_api");
  const parsed = keyInput.safeParse({ name, scopes });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]!.message };
  const [{ n }] = (await db.select({ n: count() }).from(apiKeys).where(and(eq(apiKeys.workspaceId, workspaceId), isNull(apiKeys.revokedAt), isNull(apiKeys.oauthClientId)))) as [{ n: number }];
  if (n >= 20) return { ok: false, error: "This workspace has 20 active keys. Revoke one you no longer use first." };
  const k = newApiKey();
  await db.insert(apiKeys).values({ workspaceId, name: parsed.data.name, prefix: k.prefix, keyHash: k.hash, scopes: parsed.data.scopes, createdBy: user.id });
  refresh(workspaceId);
  return { ok: true, secret: k.key };
}

export async function revokeApiKeyAction(workspaceId: string, keyId: string) {
  await requireWorkspace(workspaceId, "manage_api");
  await db.update(apiKeys).set({ revokedAt: new Date() }).where(and(eq(apiKeys.id, keyId), eq(apiKeys.workspaceId, workspaceId), isNull(apiKeys.revokedAt), isNull(apiKeys.oauthClientId)));
  refresh(workspaceId);
  return { ok: true };
}

const hookInput = z.object({
  url: z.string().trim().min(1, "Enter the URL to send events to."),
  events: z.array(z.enum(Object.keys(WEBHOOK_EVENTS) as [string, ...string[]])).min(1, "Pick at least one event."),
});

export async function createWebhookAction(workspaceId: string, url: string, events: string[]): Promise<Created> {
  const { user } = await requireWorkspace(workspaceId, "manage_api");
  const parsed = hookInput.safeParse({ url, events });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]!.message };
  const checked = checkWebhookUrl(parsed.data.url);
  if (!checked.ok) return { ok: false, error: checked.error };
  const [{ n }] = (await db.select({ n: count() }).from(webhooks).where(eq(webhooks.workspaceId, workspaceId))) as [{ n: number }];
  if (n >= 10) return { ok: false, error: "A workspace can have up to 10 webhooks." };
  const secret = newWebhookSecret();
  await db.insert(webhooks).values({ workspaceId, url: checked.url.href, secretEnc: encryptSecret(secret), events: parsed.data.events, createdBy: user.id });
  refresh(workspaceId);
  return { ok: true, secret };
}

export async function setWebhookActiveAction(workspaceId: string, id: string, active: boolean) {
  await requireWorkspace(workspaceId, "manage_api");
  await db.update(webhooks).set({ active, ...(active ? { consecutiveFailures: 0 } : {}) }).where(and(eq(webhooks.id, id), eq(webhooks.workspaceId, workspaceId)));
  refresh(workspaceId);
  return { ok: true };
}

export async function deleteWebhookAction(workspaceId: string, id: string) {
  await requireWorkspace(workspaceId, "manage_api");
  await db.delete(webhooks).where(and(eq(webhooks.id, id), eq(webhooks.workspaceId, workspaceId)));
  refresh(workspaceId);
  return { ok: true };
}

export async function testWebhookAction(workspaceId: string, id: string) {
  const { workspace } = await requireWorkspace(workspaceId, "manage_api");
  const [h] = await db.select().from(webhooks).where(and(eq(webhooks.id, id), eq(webhooks.workspaceId, workspaceId)));
  if (!h) return { ok: false, error: "That webhook no longer exists." };
  if (!h.active) return { ok: false, error: "Turn the webhook on first." };
  await emitEvent(workspaceId, "ping", { message: `Test event from ${workspace.name}` }, id);
  refresh(workspaceId);
  return { ok: true };
}

/** Disconnects an app such as Claude from this workspace. Its tokens stop working at once. */
export async function disconnectAppAction(workspaceId: string, grantId: string) {
  await requireWorkspace(workspaceId, "manage_api");
  const [g] = await db.select({ id: oauthGrants.id }).from(oauthGrants).where(and(eq(oauthGrants.id, grantId), eq(oauthGrants.workspaceId, workspaceId)));
  if (g) await revokeGrant(g.id);
  refresh(workspaceId);
  return { ok: true };
}
