import { and, desc, eq, gte, lte, type SQL } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { posts, postStatus } from "@/db/schema";
import { authenticate, apiError } from "@/lib/api-auth";
import { serializePosts } from "@/lib/api-posts";
import { savePost } from "@/lib/posts";

export const runtime = "nodejs";

/** GET /api/v1/posts?status=scheduled&from=2026-11-01T00:00:00Z&to=...&limit=50 */
export async function GET(req: Request) {
  const ctx = await authenticate(req, "posts:read");
  if (ctx instanceof NextResponse) return ctx;
  const q = new URL(req.url).searchParams;
  const conds: SQL[] = [eq(posts.workspaceId, ctx.workspace.id)];
  const status = q.get("status");
  if (status) {
    if (!(postStatus.enumValues as readonly string[]).includes(status)) return apiError(400, `status must be one of ${postStatus.enumValues.join(", ")}.`);
    conds.push(eq(posts.status, status as (typeof postStatus.enumValues)[number]));
  }
  for (const [k, op] of [["from", gte], ["to", lte]] as const) {
    const v = q.get(k);
    if (!v) continue;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return apiError(400, `${k} must be an ISO 8601 date.`);
    conds.push(op(posts.scheduledAt, d));
  }
  const limit = Math.min(Math.max(Number(q.get("limit") ?? 50) || 50, 1), 200);
  const rows = await db.select({ id: posts.id }).from(posts).where(and(...conds)).orderBy(desc(posts.scheduledAt), desc(posts.createdAt)).limit(limit);
  return NextResponse.json({ data: await serializePosts(rows.map((r) => r.id)) });
}

/**
 * POST /api/v1/posts with the same fields as the composer:
 * { channelIds, caption, overrides?, mediaIds?, firstComment?, tags?, mode: "draft"|"now"|"schedule"|"queue", date?, time?, queueId? }
 * date and time are in the workspace's time zone.
 */
export async function POST(req: Request) {
  const ctx = await authenticate(req, "posts:write");
  if (ctx instanceof NextResponse) return ctx;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || "postId" in body) return apiError(400, "Send a JSON object describing the post. To change a post, use PATCH /api/v1/posts/{id}.");
  const r = await savePost({ member: ctx.member, workspace: ctx.workspace }, body);
  if (!r.ok) return apiError(422, r.error);
  const [post] = await serializePosts([r.id]);
  return NextResponse.json({ data: post }, { status: 201 });
}
