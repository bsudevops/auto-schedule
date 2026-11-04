import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { CALLBACK_PATH, CONNECT_COOKIE, readConnectState, savePending } from "@/lib/channels";
import { can } from "@/lib/permissions";
import { PROVIDERS, PublishError, callbackUrl, isProvider } from "@/lib/publishing";
import { getSessionUser, workspaceAccess } from "@/lib/session";

export const runtime = "nodejs";

/** The platform sends the user back here after they approve (or cancel) the connection. */
export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const url = new URL(req.url);
  const appUrl = process.env.APP_URL ?? url.origin;
  const jar = await cookies();
  const raw = jar.get(CONNECT_COOKIE)?.value;
  jar.set(CONNECT_COOKIE, "", { path: CALLBACK_PATH, maxAge: 0 });

  const user = await getSessionUser();
  if (!user) return NextResponse.redirect(new URL("/sign-in", appUrl));
  if (!isProvider(provider)) return new NextResponse("Not found", { status: 404 });

  const state = readConnectState(raw, provider, url.searchParams.get("state"), user.id);
  if (!state) return NextResponse.redirect(new URL("/?error=connect_expired", appUrl));
  const back = (q: string) => NextResponse.redirect(new URL(`/w/${state.workspaceId}/channels?${q}`, appUrl));

  // Check membership and permission again: they may have changed while the user was on the platform's site.
  const access = await workspaceAccess(state.workspaceId);
  if (!access) return NextResponse.redirect(new URL("/", appUrl));
  if (!can(access.member, "manage_channels")) return back("error=forbidden");

  const code = url.searchParams.get("code");
  if (!code || url.searchParams.get("error")) return back("error=cancelled");

  try {
    const accounts = await PROVIDERS[provider].exchangeCode(code, callbackUrl(provider));
    if (!accounts.length) return back(`error=no_accounts&provider=${provider}`);
    const pendingId = await savePending(state.workspaceId, user.id, provider, accounts);
    return NextResponse.redirect(new URL(`/w/${state.workspaceId}/channels/connect?pending=${pendingId}`, appUrl));
  } catch (e) {
    console.error(`Connecting ${provider} failed`, e instanceof PublishError ? { message: e.message, detail: e.detail } : e);
    return back(`error=failed&provider=${provider}`);
  }
}
