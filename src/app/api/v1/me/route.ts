import { NextResponse } from "next/server";
import { authenticate } from "@/lib/api-auth";

export const runtime = "nodejs";

/** Which workspace a key belongs to, the role it acts with, and its scopes. Works with any scope. */
export async function GET(req: Request) {
  const ctx = await authenticate(req, null);
  if (ctx instanceof NextResponse) return ctx;
  return NextResponse.json({ workspace: { id: ctx.workspace.id, name: ctx.workspace.name, timezone: ctx.workspace.timezone }, role: ctx.member.role, scopes: ctx.scopes });
}
