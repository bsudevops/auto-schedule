import { OAuthError, registerClient } from "@/lib/oauth";
import { oauthJson, preflight } from "@/lib/oauth-http";
import { redis } from "@/lib/redis";

export const runtime = "nodejs";

const PER_HOUR = 30;

/** RFC 7591 dynamic client registration, used by Claude and other MCP clients to register themselves. */
export async function POST(req: Request) {
  try {
    const ip = req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const bucket = `rl:oauth-register:${ip}:${Math.floor(Date.now() / 3_600_000)}`;
    const n = await redis().incr(bucket);
    if (n === 1) await redis().expire(bucket, 3700);
    if (n > PER_HOUR) return oauthJson({ error: "too_many_requests", error_description: "Too many registrations. Try again later." }, 429);
  } catch {
    // If Redis is down, allow the registration rather than fail it.
  }
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return oauthJson({ error: "invalid_client_metadata", error_description: "Send the client metadata as JSON." }, 400);
  try {
    return oauthJson(await registerClient(body), 201);
  } catch (e) {
    if (e instanceof OAuthError) return oauthJson({ error: e.code, error_description: e.message }, e.status);
    throw e;
  }
}

export const OPTIONS = preflight;
