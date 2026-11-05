import { oauthJson, preflight } from "@/lib/oauth-http";
import { protectedResourceMetadata } from "@/lib/oauth";

/** RFC 9728: tells MCP clients which server signs people in for /api/mcp. */
export const GET = () => oauthJson(protectedResourceMetadata());
export const OPTIONS = preflight;
