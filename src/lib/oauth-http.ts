import { NextResponse } from "next/server";

/** Discovery, registration and token endpoints may be called from browser-based MCP clients, so they allow any origin. They never use cookies. */
export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, MCP-Protocol-Version",
  "Access-Control-Max-Age": "86400",
};

export const oauthJson = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { ...CORS, "Cache-Control": "no-store", Pragma: "no-cache" } });

export const preflight = () => new NextResponse(null, { status: 204, headers: CORS });
