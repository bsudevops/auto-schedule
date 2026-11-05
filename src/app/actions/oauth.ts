"use server";
import { redirect } from "next/navigation";
import { ACCOUNT_ONLY_SCOPES, OAUTH_SCOPES, canConnect, createCode, issuer } from "@/lib/oauth";
import { AUTH_FIELDS, checkAuthorize, errorRedirect } from "@/lib/oauth-request";
import { requireUser } from "@/lib/session";

type State = { error?: string } | undefined;

const params = (form: FormData) => Object.fromEntries(AUTH_FIELDS.map((k) => [k, (form.get(k) as string | null) ?? undefined]));

/** The person approved or denied the app on the consent screen. Everything is checked again here. */
export async function decideOAuth(_: State, form: FormData): Promise<State> {
  const user = await requireUser();
  const p = params(form);
  const checked = await checkAuthorize(p);
  if (checked.kind === "fatal") return { error: checked.message };
  if (checked.kind === "redirect") redirect(checked.to);

  if (form.get("decision") !== "approve") redirect(errorRedirect(checked.redirectUri, "access_denied", "The person declined.", p.state));

  // "all" connects every workspace the person owns or manages, including ones added later.
  const picked = String(form.get("workspaceId") ?? "");
  const workspaceId = picked === "all" ? null : picked;
  if (!picked || !(await canConnect(user.id, workspaceId))) return { error: "Pick a workspace you manage." };
  const scopes = form
    .getAll("scopes")
    .map(String)
    .filter((s) => s in OAUTH_SCOPES && checked.scopes.includes(s) && (workspaceId === null || !ACCOUNT_ONLY_SCOPES.includes(s)));
  if (!scopes.length) return { error: "Allow at least one permission." };

  const code = await createCode({ clientId: checked.client.id, userId: user.id, workspaceId, scopes, redirectUri: checked.redirectUri, codeChallenge: p.code_challenge!, resource: p.resource ?? null });
  const u = new URL(checked.redirectUri);
  u.searchParams.set("code", code);
  if (p.state) u.searchParams.set("state", p.state);
  u.searchParams.set("iss", issuer());
  redirect(u.toString());
}
