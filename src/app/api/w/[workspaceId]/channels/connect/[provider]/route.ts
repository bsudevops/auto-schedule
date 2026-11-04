import { NextResponse } from "next/server";
import { newConnectState } from "@/lib/channels";
import { can } from "@/lib/permissions";
import { PROVIDERS, callbackUrl, isProvider } from "@/lib/publishing";
import { workspaceAccess } from "@/lib/session";

export const runtime = "nodejs";

/** Starts connecting a channel: checks permission, sets the state cookie and sends the user to the platform's consent screen. */
export async function GET(req: Request, { params }: { params: Promise<{ workspaceId: string; provider: string }> }) {
  const { workspaceId, provider } = await params;
  const access = await workspaceAccess(workspaceId);
  if (!access) return new NextResponse("Not found", { status: 404 });
  const back = new URL(`/w/${workspaceId}/channels`, process.env.APP_URL ?? req.url);
  if (!can(access.member, "manage_channels")) return NextResponse.redirect(`${back}?error=forbidden`);
  if (!isProvider(provider)) return new NextResponse("Not found", { status: 404 });
  const adapter = PROVIDERS[provider];
  if (!adapter.configured()) return NextResponse.redirect(`${back}?error=not_configured`);

  const { state, cookie } = newConnectState(workspaceId, provider, access.user.id);
  const res = NextResponse.redirect(adapter.authorizeUrl(state, callbackUrl(provider)));
  res.cookies.set(cookie.name, cookie.value, cookie.options);
  return res;
}
