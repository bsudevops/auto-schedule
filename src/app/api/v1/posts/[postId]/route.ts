import { NextResponse } from "next/server";
import { authenticate, apiError } from "@/lib/api-auth";
import { postInWorkspace, serializePosts } from "@/lib/api-posts";
import { deletePost, savePost } from "@/lib/posts";

export const runtime = "nodejs";
type P = { params: Promise<{ postId: string }> };

export async function GET(req: Request, { params }: P) {
  const ctx = await authenticate(req, "posts:read");
  if (ctx instanceof NextResponse) return ctx;
  const { postId } = await params;
  if (!(await postInWorkspace(postId, ctx.workspace.id))) return apiError(404, "No post with that ID in this workspace.");
  const [post] = await serializePosts([postId]);
  return NextResponse.json({ data: post });
}

/** Replaces the post's content and timing. Same fields and rules as creating one. */
export async function PATCH(req: Request, { params }: P) {
  const ctx = await authenticate(req, "posts:write");
  if (ctx instanceof NextResponse) return ctx;
  const { postId } = await params;
  if (!(await postInWorkspace(postId, ctx.workspace.id))) return apiError(404, "No post with that ID in this workspace.");
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return apiError(400, "Send a JSON object describing the post.");
  const r = await savePost({ member: ctx.member, workspace: ctx.workspace }, { ...body, postId });
  if (!r.ok) return apiError(422, r.error);
  const [post] = await serializePosts([r.id]);
  return NextResponse.json({ data: post });
}

export async function DELETE(req: Request, { params }: P) {
  const ctx = await authenticate(req, "posts:write");
  if (ctx instanceof NextResponse) return ctx;
  const { postId } = await params;
  if (!(await postInWorkspace(postId, ctx.workspace.id))) return apiError(404, "No post with that ID in this workspace.");
  const r = await deletePost({ member: ctx.member, workspace: ctx.workspace }, postId);
  if (!r.ok) return apiError(403, r.error ?? "You can't delete this post.");
  return new NextResponse(null, { status: 204 });
}
