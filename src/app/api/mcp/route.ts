import { NextResponse } from "next/server";
import { apiError, authenticate, authenticateAccount, type AccountContext, type ApiContext } from "@/lib/api-auth";
import { accountTools } from "@/lib/mcp-account";
import { handleMessage, type RpcResponse, type Tool } from "@/lib/mcp-protocol";
import { mcpTools } from "@/lib/mcp-tools";
import { resourceMetadataUrl } from "@/lib/oauth";

export const runtime = "nodejs";

const INFO = {
  name: "bsu-scheduler",
  version: "1.0.0",
  instructions:
    "BSU Scheduler manages social media posts for one workspace. Call list_channels first to get channel IDs. Times are in the workspace's time zone (see get_workspace). Save drafts or schedule posts; only use mode \"now\" when the person asks to publish immediately.",
};

const ACCOUNT_INFO = {
  ...INFO,
  instructions:
    "BSU Scheduler manages social media posts for several workspaces, usually one per client or brand. Call list_workspaces first and pass the workspace name or ID to every other tool; ask the person which client they mean when it isn't clear. Call list_channels for that workspace to get channel IDs. Times are in the workspace's time zone. Save drafts or schedule posts; only use mode \"now\" when the person asks to publish immediately.",
};

const noStore = { "Cache-Control": "no-store" };

/**
 * MCP endpoint (Streamable HTTP). Connect by signing in with OAuth, or with the same API key as the REST API:
 * Authorization: Bearer <key>. Each tool is available only if the key has the matching permission.
 */
export async function POST(req: Request) {
  // A connection that covers all of the person's workspaces, or else a single-workspace key or connection.
  const account = await authenticateAccount(req);
  if (account instanceof NextResponse) return account;
  if (account) return serve(req, account, accountTools, ACCOUNT_INFO);
  const ctx = await authenticate(req, null);
  if (ctx instanceof NextResponse) {
    // Point MCP clients at the sign-in metadata so they can start OAuth (RFC 9728).
    if (ctx.status === 401) ctx.headers.set("WWW-Authenticate", `Bearer resource_metadata="${resourceMetadataUrl()}"`);
    return ctx;
  }
  return serve(req, ctx, mcpTools, INFO);
}

async function serve<C extends AccountContext | ApiContext>(req: Request, ctx: C, tools: Tool<C>[], info: typeof INFO) {
  const body = (await req.json().catch(() => undefined)) as unknown;
  if (body === undefined) return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "That isn't valid JSON." } }, { status: 400, headers: noStore });

  if (Array.isArray(body)) {
    if (!body.length || body.length > 20) return apiError(400, "Send between 1 and 20 messages in a batch.");
    const out = (await Promise.all(body.map((m) => handleMessage(m, ctx, tools, info)))).filter((r): r is RpcResponse => r !== null);
    return out.length ? NextResponse.json(out, { headers: noStore }) : new NextResponse(null, { status: 202 });
  }
  const res = await handleMessage(body, ctx, tools, info);
  return res ? NextResponse.json(res, { headers: noStore }) : new NextResponse(null, { status: 202 });
}

/** This server never starts a stream of its own, so clients that try to open one are told to stop. */
const notAllowed = () => new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
export const GET = notAllowed;
export const DELETE = notAllowed;
