import "server-only";
import { sql } from "drizzle-orm";
import { after } from "next/server";
import { db } from "@/db";
import { PUBLISH_ATTEMPTS, inlineJobs } from "../jobs";
import { deliver } from "../webhooks";
import { claimDuePosts, publishTarget } from "./run";

/**
 * The cron-mode replacement for the worker's queues (used on Vercel). Everything the queue
 * remembered lives in the database instead: how many attempts a target has had, and when it may
 * be tried next (retry_at, next_attempt_at). A claim sets that time ahead, so two overlapping
 * runs never take the same item.
 */
const CLAIM_MINUTES = 10;
const BATCH = 5;
const PUBLISH_BACKOFF_MS = 60_000;
const WEBHOOK_ATTEMPTS = 6;
const WEBHOOK_BACKOFF_MS = 30_000;

type Budget = { budgetMs: number };
const enough = (deadline: number) => Date.now() >= deadline;

/** Takes the next pending targets that are due (or stuck mid-publish for 45 minutes) and returns them with their earlier attempts. */
async function claimTargets(limit: number): Promise<{ id: string; attempts: number }[]> {
  const rows = await db.execute<{ id: string; attempts: number }>(sql`
    update post_targets set status = 'pending', retry_at = now() + make_interval(mins => ${CLAIM_MINUTES})
    where id in (
      select t.id from post_targets t join posts p on p.id = t.post_id
      where p.status = 'publishing'
        and ((t.status = 'pending' and (t.retry_at is null or t.retry_at <= now()))
          or (t.status = 'publishing' and t.updated_at < now() - interval '45 minutes'))
      order by t.updated_at limit ${limit} for update of t skip locked
    )
    returning id, attempts`);
  return [...rows];
}

/** Claims due posts, then publishes their targets until the time budget runs out. */
export async function runPublishing({ budgetMs }: Budget) {
  const deadline = Date.now() + budgetMs;
  const claimed = await claimDuePosts();
  const done = { claimed: claimed.length, published: 0, retrying: 0, failed: 0, skipped: 0 };
  while (!enough(deadline)) {
    const batch = await claimTargets(BATCH);
    if (!batch.length) break;
    await Promise.all(
      batch.map(async ({ id, attempts }) => {
        const r = await publishTarget(id, attempts, PUBLISH_ATTEMPTS);
        if (r.outcome === "retry") {
          const wait = PUBLISH_BACKOFF_MS * 2 ** attempts;
          await db.execute(sql`update post_targets set status = 'pending', retry_at = now() + make_interval(secs => ${wait / 1000}) where id = ${id}`);
          done.retrying++;
        } else if (r.outcome === "delay") {
          // Waiting for a platform's posting limit doesn't count as an attempt.
          await db.execute(sql`update post_targets set status = 'pending', attempts = greatest(attempts - 1, 0), retry_at = now() + make_interval(secs => ${r.ms / 1000}) where id = ${id}`);
          done.retrying++;
        } else {
          await db.execute(sql`update post_targets set retry_at = null where id = ${id}`);
          if (r.outcome === "published") done.published++;
          else if (r.outcome === "failed") done.failed++;
          else done.skipped++;
        }
      }),
    );
  }
  return done;
}

/** Sends pending webhook deliveries that are due, with the same retry schedule as the queue (6 tries, 30 s doubling). */
export async function runWebhooks({ budgetMs }: Budget) {
  const deadline = Date.now() + budgetMs;
  const done = { delivered: 0, retrying: 0, failed: 0 };
  while (!enough(deadline)) {
    const rows = await db.execute<{ id: string; attempts: number }>(sql`
      update webhook_deliveries set next_attempt_at = now() + make_interval(mins => ${CLAIM_MINUTES})
      where id in (
        select id from webhook_deliveries
        where status = 'pending' and (next_attempt_at is null or next_attempt_at <= now())
        order by created_at limit 10 for update skip locked
      )
      returning id, attempts`);
    const batch = [...rows];
    if (!batch.length) break;
    await Promise.all(
      batch.map(async ({ id, attempts }) => {
        try {
          const r = await deliver(id, attempts, WEBHOOK_ATTEMPTS);
          if (r === "delivered") done.delivered++;
          else if (r === "failed") done.failed++;
          else await db.execute(sql`update webhook_deliveries set status = 'failed', error = 'The endpoint is turned off.' where id = ${id} and status = 'pending'`);
        } catch {
          await db.execute(sql`update webhook_deliveries set next_attempt_at = now() + make_interval(secs => ${(WEBHOOK_BACKOFF_MS * 2 ** attempts) / 1000}) where id = ${id}`);
          done.retrying++;
        }
      }),
    );
  }
  return done;
}

/**
 * Starts publishing right after a request finishes, so "Publish now" doesn't wait for the next
 * cron minute. Does nothing outside cron mode, or outside a request. The cron run is the safety net.
 */
export function kickPublishing() {
  if (!inlineJobs()) return;
  try {
    after(async () => {
      await runPublishing({ budgetMs: 50_000 }).catch((e) => console.error("Publishing after save failed", e));
      await runWebhooks({ budgetMs: 10_000 }).catch(() => undefined);
    });
  } catch {
    // Not inside a request: the next cron run handles it.
  }
}
