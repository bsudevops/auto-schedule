import { NextResponse } from "next/server";
import { z } from "zod";
import { UploadError } from "@/lib/media/pipeline";
import { finishDirectUpload, startDirectUpload } from "@/lib/media/service";
import { can } from "@/lib/permissions";
import { workspaceAccess } from "@/lib/session";

export const runtime = "nodejs";
export const maxDuration = 120;

const start = z.object({ filename: z.string().max(300), size: z.number(), folderId: z.string().uuid().nullish() });
const finish = z.object({ key: z.string().max(200), filename: z.string().max(300), folderId: z.string().uuid().nullish() });

/**
 * Uploads that go straight from the browser to the storage bucket, so big files never pass through
 * the app (Vercel limits request bodies to 4.5 MB).
 *   POST .../media/direct/start   { filename, size, folderId? }  ->  { mode: "direct", key, url, headers } or { mode: "form" }
 *   POST .../media/direct/finish  { key, filename, folderId? }   ->  { id }
 */
export async function POST(req: Request, { params }: { params: Promise<{ workspaceId: string; step: string }> }) {
  const origin = req.headers.get("origin");
  if (!origin || origin !== new URL(process.env.APP_URL ?? req.url).origin) {
    return NextResponse.json({ error: "Cross-site request blocked." }, { status: 403 });
  }
  const { workspaceId, step } = await params;
  if (step !== "start" && step !== "finish") return NextResponse.json({ error: "Not found." }, { status: 404 });
  const access = await workspaceAccess(workspaceId);
  if (!access) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (!can(access.member, "upload_media")) return NextResponse.json({ error: "You don't have permission to upload media." }, { status: 403 });
  const body = await req.json().catch(() => null);

  try {
    if (step === "start") {
      const p = start.safeParse(body);
      if (!p.success) return NextResponse.json({ error: "Choose a file to upload." }, { status: 400 });
      const r = await startDirectUpload({ workspaceId, folderId: p.data.folderId ?? null, size: p.data.size, filename: p.data.filename });
      return NextResponse.json(r ? { mode: "direct", ...r } : { mode: "form" });
    }
    const p = finish.safeParse(body);
    if (!p.success) return NextResponse.json({ error: "That upload isn't valid." }, { status: 400 });
    const asset = await finishDirectUpload({ workspaceId, userId: access.user.id, key: p.data.key, filename: p.data.filename, folderId: p.data.folderId ?? null });
    return NextResponse.json({ id: asset.id });
  } catch (e) {
    if (e instanceof UploadError) return NextResponse.json({ error: e.message }, { status: 422 });
    console.error("Direct upload failed", e);
    return NextResponse.json({ error: "The upload failed. Try again." }, { status: 500 });
  }
}
