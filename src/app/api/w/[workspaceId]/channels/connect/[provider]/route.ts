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
  if (adapter.connect === "credentials") return NextResponse.redirect(`${back}?connect=${provider}`);
  if (!adapter.configured()) return NextResponse.redirect(`${back}?error=not_configured`);

  // Providers that need input first (a Mastodon server) get it as query parameters from the form on the channels page.
  let ctx: Record<string, string> | undefined;
  if (adapter.contextFields?.length) {
    const url = new URL(req.url);
    const input = Object.fromEntries(adapter.contextFields.map((f) => [f.name, url.searchParams.get(f.name) ?? ""]));
    if (Object.values(input).every((v) => !v)) return NextResponse.redirect(`${back}?connect=${provider}`);
    const prepared = await adapter.prepareContext!(input, callbackUrl(provider));
    if (!prepared.ok) return NextResponse.redirect(`${back}?connect=${provider}&error=context&detail=${encodeURIComponent(prepared.error)}`);
    ctx = prepared.ctx;
  }

  const { state, cookie } = newConnectState(workspaceId, provider, access.user.id, ctx);
  const res = NextResponse.redirect(await adapter.authorizeUrl(state, callbackUrl(provider), ctx));
  res.cookies.set(cookie.name, cookie.value, cookie.options);
  return res;
}
