/**
 * Background worker. Publishing jobs arrive in milestone 3; for now it connects to Redis and waits.
 * Run with: npm run worker
 */
import { Worker } from "bullmq";
import IORedis from "ioredis";

const connection = new IORedis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379", { maxRetriesPerRequest: null });

const publish = new Worker(
  "publish",
  async (job) => {
    throw new Error(`Publishing isn't built yet (job ${job.id}).`);
  },
  { connection, concurrency: 5 },
);

publish.on("ready", () => console.log("Worker ready, listening on the publish queue"));

const stop = async () => {
  await publish.close();
  await connection.quit();
  process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
