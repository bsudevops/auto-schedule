import { Queue } from "bullmq";
import { redis } from "./redis";

export const PUBLISH_QUEUE = "publish";
export const MAINTENANCE_QUEUE = "maintenance";
export const WEBHOOK_QUEUE = "webhooks";
export const PUBLISH_ATTEMPTS = 4;

export type PublishJob = { targetId: string };

/**
 * On Vercel there is no always-on worker: cron routes (src/app/api/cron) do the work instead, so
 * nothing is put on a queue. Set JOBS_MODE=queue to force the worker, or JOBS_MODE=inline to force cron mode.
 */
export const inlineJobs = () => process.env.JOBS_MODE === "inline" || (process.env.JOBS_MODE !== "queue" && Boolean(process.env.VERCEL));

const g = globalThis as unknown as { __publishQueue?: Queue<PublishJob>; __webhookQueue?: Queue<{ deliveryId: string }> };

export function webhookQueue(): Queue<{ deliveryId: string }> {
  g.__webhookQueue ??= new Queue<{ deliveryId: string }>(WEBHOOK_QUEUE, { connection: redis() });
  return g.__webhookQueue;
}

export function publishQueue(): Queue<PublishJob> {
  g.__publishQueue ??= new Queue<PublishJob>(PUBLISH_QUEUE, { connection: redis() });
  return g.__publishQueue;
}

/**
 * Queues one post target. The job ID is the target ID, so queueing the same target twice while a job
 * is waiting or running does nothing. Finished jobs are removed; their outcome lives in the database.
 */
export async function enqueueTarget(targetId: string) {
  if (inlineJobs()) return; // the next cron run (or the kick after saving) picks it up
  await publishQueue().add(
    "publish",
    { targetId },
    { jobId: targetId, attempts: PUBLISH_ATTEMPTS, backoff: { type: "exponential", delay: 60_000 }, removeOnComplete: true, removeOnFail: true },
  );
}
