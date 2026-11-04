import { and, asc, eq, ne } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { channels } from "@/db/schema";
import { authenticate } from "@/lib/api-auth";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const ctx = await authenticate(req, "channels:read");
  if (ctx instanceof NextResponse) return ctx;
  const rows = await db
    .select({ id: channels.id, platform: channels.platform, handle: channels.handle, displayName: channels.displayName, status: channels.status, followers: channels.followers })
    .from(channels)
    .where(and(eq(channels.workspaceId, ctx.workspace.id), ne(channels.status, "disconnected")))
    .orderBy(asc(channels.platform));
  return NextResponse.json({ data: rows });
}
