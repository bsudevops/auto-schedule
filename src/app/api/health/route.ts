import { sql } from "drizzle-orm";
import { db } from "@/db";
import { redis } from "@/lib/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** For load balancers and uptime checks. Says only whether each dependency answers. */
export async function GET() {
  const check = async (fn: () => Promise<unknown>) => {
    try {
      await Promise.race([fn(), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 3000))]);
      return true;
    } catch {
      return false;
    }
  };
  const [database, queue] = await Promise.all([check(() => db.execute(sql`select 1`)), check(() => redis().ping())]);
  const ok = database && queue;
  return Response.json({ ok, database, redis: queue }, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
