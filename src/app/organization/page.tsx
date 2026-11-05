import Link from "next/link";
import { requireUser, listUserOrgs, listUserWorkspaces } from "@/lib/session";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { workspaces } from "@/db/schema";
import { and, isNull, inArray } from "drizzle-orm";
import { BrandLogo } from "@/components/BrandLogo";
import { BRAND } from "@/lib/brand";
import { signOut } from "@/app/actions/auth";
import { NewWorkspaceInOrgForm } from "./NewWorkspaceInOrgForm";

export const metadata = { title: "Your workspaces" };

export default async function Page() {
  const user = await requireUser();
  const orgs = await listUserOrgs(user.id);
  if (!orgs.length) redirect("/onboarding");
  const mine = await listUserWorkspaces(user.id);
  const allInOrgs = await db
    .select({ id: workspaces.id, orgId: workspaces.orgId })
    .from(workspaces)
    .where(and(inArray(workspaces.orgId, orgs.map((o) => o.id)), isNull(workspaces.archivedAt)));
  const orgOf = new Map(allInOrgs.map((w) => [w.id, w.orgId]));
  return (
    <main className="portal-wrap" style={{ maxWidth: 880, paddingTop: 48 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div className="row"><BrandLogo /><b style={{ fontFamily: "var(--f-display)", fontSize: 18 }}>{BRAND.name}</b></div>
        <form action={signOut}><button className="btn ghost" type="submit">Sign out</button></form>
      </div>
      <div><h1>Welcome, {user.name.split(" ")[0]}</h1><p className="muted" style={{ marginTop: 4 }}>Pick a client workspace to open, or add a new one.</p></div>
      {orgs.map((org) => {
        const list = mine.filter((w) => orgOf.get(w.id) === org.id);
        const canAdd = org.role !== "member" && !org.deletionRequestedAt;
        return (
          <section key={org.id} className="stack" aria-label={org.name}>
            <div className="row" style={{ gap: 10 }}>
              <h2 style={{ fontSize: 18 }}>{org.name}</h2>
              <span className="muted" style={{ fontSize: 12, textTransform: "capitalize" }}>{org.role}</span>
            </div>
            {org.deletionRequestedAt && <p className="err" role="status">This organization is scheduled for deletion.</p>}
            {list.length ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 12 }}>
                {list.map((w) => (
                  <Link key={w.id} href={`/w/${w.id}`} className="card card-b" style={{ textDecoration: "none", color: "inherit", display: "flex", gap: 12, alignItems: "center" }}>
                    <span style={{ width: 36, height: 36, borderRadius: 10, background: w.color, flex: "none" }} aria-hidden />
                    <span><b>{w.name}</b><br /><span className="muted" style={{ fontSize: 12, textTransform: "capitalize" }}>{w.role}</span></span>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="muted">No workspaces yet.{canAdd ? " Create your first client workspace below." : " Ask an owner or admin to add you to one."}</p>
            )}
            {canAdd && <NewWorkspaceInOrgForm orgId={org.id} />}
          </section>
        );
      })}
    </main>
  );
}
