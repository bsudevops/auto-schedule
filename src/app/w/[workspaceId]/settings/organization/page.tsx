import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { orgMembers } from "@/db/schema";
import { listUserWorkspaces, requireWorkspace } from "@/lib/session";
import { NewWorkspaceForm } from "./NewWorkspaceForm";
import Link from "next/link";
import { DELETION_GRACE_DAYS } from "@/lib/org-deletion";
import { DeleteOrg } from "./DeleteOrg";
import { organizations } from "@/db/schema";

export const metadata = { title: "Organization" };

export default async function Page({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const { user, workspace, orgName } = await requireWorkspace(workspaceId);
  const [om] = await db.select().from(orgMembers).where(and(eq(orgMembers.orgId, workspace.orgId), eq(orgMembers.userId, user.id)));
  const all = (await listUserWorkspaces(user.id)).filter((w) => w.orgName === orgName);
  const [org] = await db.select({ deletionRequestedAt: organizations.deletionRequestedAt }).from(organizations).where(eq(organizations.id, workspace.orgId));
  return (
    <div className="stack" style={{ gap: 16 }}>
      <section className="card">
        <div className="card-h"><h2>Workspaces in {orgName}</h2></div>
        <div className="card-b tbl-wrap">
          <table className="tbl"><tbody>
            {all.map((w) => (
              <tr key={w.id}><td><div className="row"><span className="ws-ico" style={{ background: w.color }}>{w.name[0]}</span><b style={{ fontSize: 13.5 }}>{w.name}</b></div></td>
                <td style={{ textAlign: "right" }}><Link className="btn sm" href={`/w/${w.id}`}>Open</Link></td></tr>
            ))}
          </tbody></table>
        </div>
      </section>
      {om && om.role !== "member" ? (
        <section className="card card-b stack"><h3>New workspace</h3><p className="muted" style={{ fontSize: 13 }}>Add a workspace for another brand or client.</p><NewWorkspaceForm workspaceId={workspaceId} /></section>
      ) : (
        <p className="muted">Ask an organization owner or admin to add workspaces.</p>
      )}
      {om?.role === "owner" && !org?.deletionRequestedAt && <DeleteOrg workspaceId={workspaceId} orgName={orgName} days={DELETION_GRACE_DAYS} />}
    </div>
  );
}
