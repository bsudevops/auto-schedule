import { OAuthError, authenticateClient, exchangeCode, refreshGrant } from "@/lib/oauth";
import { oauthJson, preflight } from "@/lib/oauth-http";

export const runtime = "nodejs";

async function readParams(req: Request): Promise<URLSearchParams> {
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    const j = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return new URLSearchParams(Object.entries(j).filter(([, v]) => typeof v === "string") as [string, string][]);
  }
  return new URLSearchParams(await req.text());
}

/** Client credentials from HTTP Basic (client_secret_basic) or the form body (client_secret_post / none). */
function clientCreds(req: Request, p: URLSearchParams): { id: string | null; secret: string | null } {
  const basic = req.headers.get("authorization")?.match(/^Basic\s+(.+)$/i);
  if (basic) {
    const decoded = Buffer.from(basic[1]!, "base64").toString("utf8");
    const i = decoded.indexOf(":");
    if (i > 0) return { id: decodeURIComponent(decoded.slice(0, i)), secret: decodeURIComponent(decoded.slice(i + 1)) };
  }
  return { id: p.get("client_id"), secret: p.get("client_secret") };
}

export async function POST(req: Request) {
  const p = await readParams(req);
  try {
    const creds = clientCreds(req, p);
    const client = await authenticateClient(creds.id, creds.secret);
    const grant = p.get("grant_type");
    if (grant === "authorization_code") {
      return oauthJson(await exchangeCode(client, { code: p.get("code"), redirectUri: p.get("redirect_uri"), verifier: p.get("code_verifier"), resource: p.get("resource") }));
    }
    if (grant === "refresh_token") return oauthJson(await refreshGrant(client, p.get("refresh_token"), p.get("scope")));
    throw new OAuthError("unsupported_grant_type", "Use authorization_code or refresh_token.");
  } catch (e) {
    if (e instanceof OAuthError) return oauthJson({ error: e.code, error_description: e.message }, e.status);
    throw e;
  }
}

export const OPTIONS = preflight;
