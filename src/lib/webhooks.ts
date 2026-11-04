import { createHmac, randomBytes } from "node:crypto";
import { and, arrayContains, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { webhookDeliveries, webhooks } from "@/db/schema";
import { decryptSecret } from "./crypto";
import { inlineJobs, webhookQueue } from "./jobs";
import { safePost } from "./safe-http";

export const WEBHOOK_EVENTS = {
  "post.published": "A post published on every channel",
  "post.failed": "A post failed on one or more channels",
  "inbox.message_received": "A new comment or message arrived in the inbox",
  "channel.needs_attention": "A channel needs reconnecting or is about to expire",
} as const;
export type WebhookEvent = keyof typeof WEBHOOK_EVENTS | "ping";

export const newWebhookSecret = () => `whsec_${randomBytes(24).toString("base64url")}`;

/** Signature header: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">. Receivers should reject old timestamps. */
export function sign(secret: string, body: string, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
}

/** Records a delivery for each active webhook in the workspace that wants this event, and queues it. Never throws. */
export async function emitEvent(workspaceId: string, event: WebhookEvent, data: Record<string, unknown>, onlyWebhookId?: string) {
  try {
    const hooks = await db
      .select({ id: webhooks.id })
      .from(webhooks)
      .where(and(eq(webhooks.workspaceId, workspaceId), eq(webhooks.active, true), onlyWebhookId ? eq(webhooks.id, onlyWebhookId) : arrayContains(webhooks.events, [event])));
    for (const h of hooks) {
      const [d] = await db
        .insert(webhookDeliveries)
        .values({ webhookId: h.id, event, payload: { event, workspaceId, createdAt: new Date().toISOString(), data } })
        .returning({ id: webhookDeliveries.id });
      if (inlineJobs()) continue; // sent by the next cron run
      await webhookQueue().add("deliver", { deliveryId: d!.id }, { jobId: d!.id, attempts: 6, backoff: { type: "exponential", delay: 30_000 }, removeOnComplete: true, removeOnFail: true });
    }
  } catch (e) {
    console.error(`Couldn't queue webhook event ${event}`, e);
  }
}

const DISABLE_AFTER = 20;

/** Sends one delivery. Throws to let the queue retry; the last attempt records the failure. */
export async function deliver(deliveryId: string, attempt: number, maxAttempts: number) {
  const [row] = await db
    .select({ d: webhookDeliveries, h: webhooks })
    .from(webhookDeliveries)
    .innerJoin(webhooks, eq(webhooks.id, webhookDeliveries.webhookId))
    .where(eq(webhookDeliveries.id, deliveryId));
  if (!row || row.d.status === "delivered" || !row.h.active) return "skipped";
  const body = JSON.stringify({ id: row.d.id, ...(row.d.payload as object) });
  let status = 0;
  let error: string | null = null;
  try {
    const res = await safePost(row.h.url, body, {
      "X-Webhook-Id": row.d.id,
      "X-Webhook-Event": row.d.event,
      "X-Webhook-Signature": sign(decryptSecret(row.h.secretEnc), body),
    });
    status = res.status;
    if (status < 200 || status >= 300) error = `Your endpoint answered HTTP ${status}.`;
  } catch (e) {
    error = (e as Error).message;
  }
  const now = new Date();
  if (!error) {
    await db.update(webhookDeliveries).set({ status: "delivered", responseCode: status, error: null, attempts: attempt + 1, deliveredAt: now }).where(eq(webhookDeliveries.id, deliveryId));
    await db.update(webhooks).set({ consecutiveFailures: 0, lastDeliveryAt: now, lastStatus: `HTTP ${status}` }).where(eq(webhooks.id, row.h.id));
    return "delivered";
  }
  const last = attempt + 1 >= maxAttempts;
  await db.update(webhookDeliveries).set({ status: last ? "failed" : "pending", responseCode: status || null, error, attempts: attempt + 1 }).where(eq(webhookDeliveries.id, deliveryId));
  if (last) {
    await db
      .update(webhooks)
      .set({ consecutiveFailures: sql`${webhooks.consecutiveFailures} + 1`, lastDeliveryAt: now, lastStatus: error.slice(0, 200), active: sql`${webhooks.consecutiveFailures} + 1 < ${DISABLE_AFTER}` })
      .where(eq(webhooks.id, row.h.id));
    return "failed";
  }
  throw new Error(error);
}
