import { redirect } from "next/navigation";
import { BrandLogo } from "@/components/BrandLogo";
import { API_SCOPES } from "@/lib/api-auth";
import { BRAND } from "@/lib/brand";
import { AUTH_FIELDS, checkAuthorize } from "@/lib/oauth-request";
import { can } from "@/lib/permissions";
import { getSessionUser, listUserWorkspaces } from "@/lib/session";
import { ConsentForm } from "./ConsentForm";

export const metadata = { title: "Connect an app" };
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const p = Object.fromEntries(AUTH_FIELDS.map((k) => [k, typeof raw[k] === "string" ? raw[k] : undefined])) as Record<string, string | undefined>;
  const checked = await checkAuthorize(p);
  if (checked.kind === "redirect") redirect(checked.to);

  const user = await getSessionUser();
  if (!user) {
    const qs = new URLSearchParams(Object.entries(p).filter((e): e is [string, string] => !!e[1]));
    redirect(`/sign-in?next=${encodeURIComponent(`/oauth/authorize?${qs}`)}`);
  }

  const shell = (body: React.ReactNode) => (
    <main className="portal-wrap" style={{ maxWidth: 520, paddingTop: 56 }}>
      <div className="row"><BrandLogo /><b style={{ fontFamily: "var(--f-display)", fontSize: 18 }}>{BRAND.name}</b></div>
      {body}
    </main>
  );
  if (checked.kind === "fatal") return shell(<div className="card card-b"><h1 style={{ fontSize: 20 }}>Can&apos;t connect this app</h1><p className="muted" style={{ marginTop: 6 }}>{checked.message}</p></div>);

  const workspaces = (await listUserWorkspaces(user.id)).filter((w) => can({ userId: user.id, role: w.role, active: true }, "manage_api"));
  const host = new URL(checked.redirectUri).host;
  return shell(
    <>
      <div>
        <h1 style={{ fontSize: 22 }}>Connect {checked.client.name}</h1>
        <p className="muted" style={{ marginTop: 4 }}>
          {checked.client.name} wants to use one of your workspaces as {user.email}. After you allow it, you&apos;ll go back to <b>{host}</b>.
        </p>
      </div>
      {workspaces.length ? (
        <ConsentForm
          fields={Object.fromEntries(Object.entries(p).filter((e): e is [string, string] => !!e[1]))}
          workspaces={workspaces.map((w) => ({ id: w.id, name: w.name, orgName: w.orgName }))}
          scopes={checked.scopes.map((s) => ({ id: s, label: API_SCOPES[s as keyof typeof API_SCOPES] }))}
        />
      ) : (
        <div className="card card-b"><p className="muted">You need the Owner or Manager role in a workspace to connect an app to it.</p></div>
      )}
      <p className="muted" style={{ fontSize: 13 }}>You can disconnect it at any time under Settings → API &amp; webhooks.</p>
    </>,
  );
}
