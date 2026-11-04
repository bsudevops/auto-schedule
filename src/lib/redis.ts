import IORedis from "ioredis";

const g = globalThis as unknown as { __redis?: IORedis };

/** One shared Redis connection per process. BullMQ needs maxRetriesPerRequest: null. */
export function redis(): IORedis {
  g.__redis ??= new IORedis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379", { maxRetriesPerRequest: null });
  return g.__redis;
}
