import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { purgeDeletedOrganizations } from "@/lib/org-deletion";
import { runPublishing, runWebhooks } from "@/lib/publishing/inline";
import { purgeOldRecords } from "@/lib/publishing/run";
import { syncAll } from "@/lib/publishing/sync";
import { refreshExpiringTokens } from "@/lib/publishing/tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The background work, run by a scheduler instead of an always-on worker (see docs/VERCEL.md).
 * vercel.json calls these on a schedule. Each call must carry CRON_SECRET as a Bearer token,
 * which Vercel adds by itself when the CRON_SECRET environment variable is set.
 */
const JOBS: Record<string, () => Promise<unknown>> = {
  // Publish due posts, then send webhooks. The budget leaves room for a publish already in flight.
  tick: async () => ({ publishing: await runPublishing({ budgetMs: 200_000 }), webhooks: await runWebhooks({ budgetMs: 30_000 }) }),
  tokens: () => refreshExpiringTokens(),
  inbox: () => syncAll("inbox"),
  insights: () => syncAll("insights"),
  purge: async () => {
    await purgeOldRecords();
    return purgeDeletedOrganizations();
  },
};

function allowed(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return "unset" as const;
  const given = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "")?.[1] ?? "";
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b) ? ("ok" as const) : ("no" as const);
}

async function run(req: Request, { params }: { params: Promise<{ job: string }> }) {
  const ok = allowed(req);
  if (ok === "unset") return NextResponse.json({ error: "Set CRON_SECRET to turn the scheduled jobs on." }, { status: 503 });
  if (ok === "no") return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  const { job } = await params;
  const fn = Object.hasOwn(JOBS, job) ? JOBS[job] : undefined;
  if (!fn) return NextResponse.json({ error: "Unknown job." }, { status: 404 });
  const started = Date.now();
  try {
    const result = await fn();
    return NextResponse.json({ job, ms: Date.now() - started, result: result ?? null }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error(`Cron job ${job} failed`, e);
    return NextResponse.json({ job, error: "The job failed. See the function logs." }, { status: 500 });
  }
}

// Vercel Cron sends GET. POST lets any other scheduler (such as cron-job.org) call the same routes.
export const GET = run;
export const POST = run;
