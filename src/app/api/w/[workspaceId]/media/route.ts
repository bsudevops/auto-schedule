import { NextResponse } from "next/server";
import { UploadError } from "@/lib/media/pipeline";
import { createAsset } from "@/lib/media/service";
import { can } from "@/lib/permissions";
import { workspaceAccess } from "@/lib/session";

export const runtime = "nodejs";

/** Upload one file into the workspace's media library. */
export async function POST(req: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  // Same-origin only. Session cookies are SameSite=Lax as well; this is a second check.
  const origin = req.headers.get("origin");
  if (!origin || origin !== new URL(process.env.APP_URL ?? req.url).origin) {
    return NextResponse.json({ error: "Cross-site request blocked." }, { status: 403 });
  }
  const { workspaceId } = await params;
  const access = await workspaceAccess(workspaceId);
  if (!access) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (!can(access.member, "upload_media")) return NextResponse.json({ error: "You don't have permission to upload media." }, { status: 403 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose a file to upload." }, { status: 400 });
  const folderId = form?.get("folderId");

  try {
    const asset = await createAsset({
      workspaceId,
      userId: access.user.id,
      data: Buffer.from(await file.arrayBuffer()),
      filename: file.name,
      folderId: typeof folderId === "string" && folderId ? folderId : null,
    });
    return NextResponse.json({ id: asset.id });
  } catch (e) {
    if (e instanceof UploadError) return NextResponse.json({ error: e.message }, { status: 422 });
    console.error("Upload failed", e);
    return NextResponse.json({ error: "The upload failed. Try again." }, { status: 500 });
  }
}
