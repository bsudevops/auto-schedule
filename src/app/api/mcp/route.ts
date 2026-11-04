import { NextResponse } from "next/server";
import { apiError, authenticate } from "@/lib/api-auth";
import { handleMessage, type RpcResponse } from "@/lib/mcp-protocol";
import { mcpTools } from "@/lib/mcp-tools";

export const runtime = "nodejs";

const INFO = {
  name: "bsu-scheduler",
  version: "1.0.0",
  instructions:
    "BSU Scheduler manages social media posts for one workspace. Call list_channels first to get channel IDs. Times are in the workspace's time zone (see get_workspace). Save drafts or schedule posts; only use mode \"now\" when the person asks to publish immediately.",
};

const noStore = { "Cache-Control": "no-store" };

/**
 * MCP endpoint (Streamable HTTP). Connect with the same API key as the REST API:
 * Authorization: Bearer <key>. Each tool is available only if the key has the matching permission.
 */
export async function POST(req: Request) {
  const ctx = await authenticate(req, null);
  if (ctx instanceof NextResponse) return ctx;
  const body = (await req.json().catch(() => undefined)) as unknown;
  if (body === undefined) return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "That isn't valid JSON." } }, { status: 400, headers: noStore });

  if (Array.isArray(body)) {
    if (!body.length || body.length > 20) return apiError(400, "Send between 1 and 20 messages in a batch.");
    const out = (await Promise.all(body.map((m) => handleMessage(m, ctx, mcpTools, INFO)))).filter((r): r is RpcResponse => r !== null);
    return out.length ? NextResponse.json(out, { headers: noStore }) : new NextResponse(null, { status: 202 });
  }
  const res = await handleMessage(body, ctx, mcpTools, INFO);
  return res ? NextResponse.json(res, { headers: noStore }) : new NextResponse(null, { status: 202 });
}

/** This server never starts a stream of its own, so clients that try to open one are told to stop. */
const notAllowed = () => new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
export const GET = notAllowed;
export const DELETE = notAllowed;
