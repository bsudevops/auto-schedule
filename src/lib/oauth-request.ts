import "server-only";
import { getClient, parseScopes, resourceOk, validRedirectUri } from "./oauth";

export type AuthorizeParams = Record<string, string | undefined>;

/** Fields carried from the authorize URL through the consent form. */
export const AUTH_FIELDS = ["client_id", "redirect_uri", "response_type", "state", "scope", "code_challenge", "code_challenge_method", "resource"] as const;

export function errorRedirect(redirectUri: string, error: string, description: string, state?: string) {
  const u = new URL(redirectUri);
  u.searchParams.set("error", error);
  u.searchParams.set("error_description", description);
  if (state) u.searchParams.set("state", state);
  return u.toString();
}

/**
 * Checks an authorization request. A bad client or redirect address is shown to the person, never redirected to,
 * so a forged link can't bounce them to an attacker's site. Other problems go back to the app as an OAuth error.
 */
export async function checkAuthorize(p: AuthorizeParams) {
  const client = await getClient(p.client_id);
  if (!client) return { kind: "fatal" as const, message: "This app isn't registered with BSU Scheduler. Remove it in your assistant and add it again." };
  if (!validRedirectUri(p.redirect_uri) || !client.redirectUris.includes(p.redirect_uri)) {
    return { kind: "fatal" as const, message: "The return address in this link doesn't match the app's registration." };
  }
  const back = (error: string, description: string) => ({ kind: "redirect" as const, to: errorRedirect(p.redirect_uri!, error, description, p.state) });
  if (p.response_type !== "code") return back("unsupported_response_type", "Only response_type=code is supported.");
  if (!p.code_challenge || p.code_challenge_method !== "S256") return back("invalid_request", "PKCE with code_challenge_method=S256 is required.");
  if (!resourceOk(p.resource)) return back("invalid_target", "Unknown resource.");
  const scopes = parseScopes(p.scope);
  if (!scopes.length) return back("invalid_scope", "None of the requested scopes exist.");
  return { kind: "ok" as const, client, scopes, redirectUri: p.redirect_uri };
}
