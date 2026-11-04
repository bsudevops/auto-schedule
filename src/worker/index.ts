/**
 * Background worker: publishes posts, refreshes tokens and cleans up old records.
 * Run with: npm run worker. Several workers can run at once; jobs and post claims never overlap.
 */
import { DelayedError, Queue, UnrecoverableError, Worker } from "bullmq";
import { MAINTENANCE_QUEUE, PUBLISH_ATTEMPTS, PUBLISH_QUEUE, WEBHOOK_QUEUE, enqueueTarget, publishQueue, webhookQueue, type PublishJob } from "@/lib/jobs";
import { purgeDeletedOrganizations } from "@/lib/org-deletion";
import { deliver } from "@/lib/webhooks";
import { claimDuePosts, dryRun, publishTarget, purgeOldRecords, resetStuckTarget, targetsToQueue } from "@/lib/publishing/run";
import { syncAll } from "@/lib/publishing/sync";
import { refreshExpiringTokens } from "@/lib/publishing/tokens";
import { redis } from "@/lib/redis";

const connection = redis();

const publish = new Worker<PublishJob>(
  PUBLISH_QUEUE,
  async (job, token) => {
    const r = await publishTarget(job.data.targetId, job.attemptsMade, job.opts.attempts ?? PUBLISH_ATTEMPTS);
    if (r.outcome === "delay") {
      await job.moveToDelayed(Date.now() + r.ms, token);
      throw new DelayedError();
    }
    if (r.outcome === "retry") throw r.error; // BullMQ retries with exponential backoff
    return r.outcome;
  },
  { connection, concurrency: Number(process.env.WORKER_CONCURRENCY ?? 5) },
);

const hooks = new Worker<{ deliveryId: string }>(
  WEBHOOK_QUEUE,
  async (job) => deliver(job.data.deliveryId, job.attemptsMade, job.opts.attempts ?? 6),
  { connection, concurrency: 10 },
);

/** Finds due posts and makes sure every target that should be publishing has a job. */
async function tick() {
  const claimed = await claimDuePosts();
  const targets = await targetsToQueue();
  for (const t of targets) {
    if (t.stuck) {
      const job = await publishQueue().getJob(t.id);
      if (job) continue;
      await resetStuckTarget(t.id);
    }
    await enqueueTarget(t.id);
  }
  if (claimed.length) console.log(`Claimed ${claimed.length} due post(s)`);
}

const maintenanceQueue = new Queue(MAINTENANCE_QUEUE, { connection });
const maintenance = new Worker(
  MAINTENANCE_QUEUE,
  async (job) => {
    if (job.name === "tick") return tick();
    if (job.name === "refresh-tokens") return refreshExpiringTokens();
    if (job.name === "purge") {
      await purgeOldRecords();
      return purgeDeletedOrganizations();
    }
    if (job.name === "sync-inbox") return syncAll("inbox");
    if (job.name === "sync-insights") return syncAll("insights");
    throw new UnrecoverableError(`Unknown maintenance job ${job.name}`);
  },
  { connection, concurrency: 1 },
);

async function start() {
  // Job schedulers run once across all workers, however many are running.
  await maintenanceQueue.upsertJobScheduler("tick", { every: Number(process.env.SCHEDULER_INTERVAL_MS ?? 15_000) }, { name: "tick", opts: { removeOnComplete: true, removeOnFail: 50 } });
  await maintenanceQueue.upsertJobScheduler("refresh-tokens", { every: 3_600_000 }, { name: "refresh-tokens", opts: { removeOnComplete: true, removeOnFail: 50 } });
  await maintenanceQueue.upsertJobScheduler("sync-inbox", { every: 10 * 60_000 }, { name: "sync-inbox", opts: { removeOnComplete: true, removeOnFail: 50 } });
  await maintenanceQueue.upsertJobScheduler("sync-insights", { every: 6 * 3_600_000 }, { name: "sync-insights", opts: { removeOnComplete: true, removeOnFail: 50 } });
  await maintenanceQueue.upsertJobScheduler("purge", { pattern: "17 3 * * *" }, { name: "purge", opts: { removeOnComplete: true, removeOnFail: 50 } });
  console.log(`Worker ready${dryRun() ? " (DRY RUN: nothing is sent to platforms)" : ""}`);
}

publish.on("failed", (job, err) => {
  if (err instanceof DelayedError || err.name === "DelayedError") return;
  console.warn(`Publish job ${job?.id} attempt ${job?.attemptsMade} failed: ${err.message}`);
});
maintenance.on("failed", (job, err) => console.error(`Maintenance job ${job?.name} failed:`, err));

void start();

const stop = async () => {
  await Promise.all([publish.close(), hooks.close(), maintenance.close(), maintenanceQueue.close()]);
  await Promise.all([publishQueue().close(), webhookQueue().close()]);
  await connection.quit();
  process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
