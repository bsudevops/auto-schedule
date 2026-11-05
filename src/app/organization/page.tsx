import Link from "next/link";
import { requireUser, listUserOrgs, listUserWorkspaces } from "@/lib/session";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { channels, posts, workspaces, type Platform } from "@/db/schema";
import { and, count, eq, gt, inArray, isNull, ne } from "drizzle-orm";
import { BrandLogo } from "@/components/BrandLogo";
import { Icon } from "@/components/Icon";
import { PlatformStack } from "@/components/ui";
import { BRAND } from "@/lib/brand";
import { signOut } from "@/app/actions/auth";
import { NewWorkspaceInOrgForm } from "./NewWorkspaceInOrgForm";

export const metadata = { title: "Your workspaces" };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export default async function Page() {
  const user = await requireUser();
  const orgs = await listUserOrgs(user.id);
  if (!orgs.length) redirect("/onboarding");
  const mine = await listUserWorkspaces(user.id);
  const ids = mine.map((w) => w.id);
  const [allInOrgs, chans, upcoming] = await Promise.all([
    db.select({ id: workspaces.id, orgId: workspaces.orgId, timezone: workspaces.timezone })
      .from(workspaces)
      .where(and(inArray(workspaces.orgId, orgs.map((o) => o.id)), isNull(workspaces.archivedAt))),
    ids.length ? db.select({ ws: channels.workspaceId, platform: channels.platform }).from(channels).where(and(inArray(channels.workspaceId, ids), ne(channels.status, "disconnected"))) : [],
    ids.length ? db.select({ ws: posts.workspaceId, n: count() }).from(posts).where(and(inArray(posts.workspaceId, ids), eq(posts.status, "scheduled"), gt(posts.scheduledAt, new Date()))).groupBy(posts.workspaceId) : [],
  ]);
  const info = new Map(allInOrgs.map((w) => [w.id, w]));
  const platformsOf = (id: string) => [...new Set(chans.filter((c) => c.ws === id).map((c) => c.platform))] as Platform[];
  const upcomingOf = (id: string) => upcoming.find((u) => u.ws === id)?.n ?? 0;
  const addable = orgs.filter((o) => o.role !== "member" && !o.deletionRequestedAt);
  const first = user.name.split(" ")[0];

  return (
    <div className="org">
      <header className="org-bar">
        <div className="org-brand"><BrandLogo /><b>{BRAND.name}</b></div>
        <div className="org-user">
          <span className="org-avatar" aria-hidden>{first?.[0]?.toUpperCase()}</span>
          <span className="org-who"><b>{user.name}</b><small>{user.email}</small></span>
          <form action={signOut}><button className="btn ghost sm" type="submit">Sign out</button></form>
        </div>
      </header>

      <main className="org-main">
        <div className="org-intro">
          <h1>Welcome, {first}</h1>
          <p>Pick a client workspace to open, or add a new one.</p>
        </div>

        <div className={`org-grid${addable.length ? "" : " solo"}`}>
          <div className="org-list">
            {orgs.map((org) => {
              const list = mine.filter((w) => info.get(w.id)?.orgId === org.id);
              const canAdd = org.role !== "member" && !org.deletionRequestedAt;
              return (
                <section key={org.id} className="org-sec" aria-label={org.name}>
                  <div className="org-sec-head">
                    <h2>{org.name}</h2>
                    <span className="org-role">{org.role}</span>
                    <span className="org-count">{plural(list.length, "workspace")}</span>
                  </div>
                  {org.deletionRequestedAt && <p className="err" role="status">This organization is scheduled for deletion.</p>}
                  {list.length ? (
                    <div className="ws-tiles">
                      {list.map((w) => {
                        const pf = platformsOf(w.id);
                        const n = upcomingOf(w.id);
                        return (
                          <Link key={w.id} href={`/w/${w.id}`} className="ws-tile">
                            <span className="ws-mono" style={{ background: w.color }} aria-hidden>{w.name.trim()[0]?.toUpperCase()}</span>
                            <span className="ws-body">
                              <b className="ws-name">{w.name}</b>
                              <span className="ws-sub">{w.role}{info.get(w.id)?.timezone ? `, ${info.get(w.id)!.timezone.replace(/_/g, " ")}` : ""}</span>
                            </span>
                            <span className="ws-foot">
                              {pf.length ? <PlatformStack platforms={pf} /> : <span className="ws-none">No channels yet</span>}
                              <span className="ws-next">{n ? `${plural(n, "post")} scheduled` : "Nothing scheduled"}</span>
                            </span>
                            <span className="ws-go" aria-hidden><Icon name="right" size={16} /></span>
                          </Link>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="org-empty">No workspaces yet.{canAdd ? " Create your first client workspace with the form." : " Ask an owner or admin to add you to one."}</p>
                  )}
                </section>
              );
            })}
          </div>

          {addable.length > 0 && (
            <aside className="org-new" aria-label="New workspace">
              {addable.map((org) => (
                <NewWorkspaceInOrgForm key={org.id} orgId={org.id} orgName={addable.length > 1 ? org.name : undefined} />
              ))}
            </aside>
          )}
        </div>
      </main>
    </div>
  );
}
