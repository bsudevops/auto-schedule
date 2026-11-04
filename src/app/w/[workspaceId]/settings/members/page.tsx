import { and, asc, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db";
import { invitations, user as userTable, workspaceMembers } from "@/db/schema";
import { can, canManageMember, PERMISSIONS, ROLE_LABELS, type Permission } from "@/lib/permissions";
import { requireWorkspace } from "@/lib/session";
import { InviteForm, MemberRow } from "./MemberControls";

export const metadata = { title: "Members" };

const ROLES = ["owner", "manager", "editor", "contributor", "viewer"] as const;
const PERM_LABELS: Record<Permission, string> = {
  view: "View posts, calendar and analytics",
  create_posts: "Create posts and ideas",
  edit_others_posts: "Edit other people's posts",
  publish: "Schedule and publish",
  reply_inbox: "Reply in the inbox",
  upload_media: "Upload media",
  delete_media: "Delete media",
  manage_channels: "Connect channels",
  manage_members: "Manage members",
  manage_workspace: "Workspace settings",
  manage_api: "API keys and webhooks",
};

export default async function Page({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const { member } = await requireWorkspace(workspaceId);
  const [members, pending] = await Promise.all([
    db.select({ userId: userTable.id, name: userTable.name, email: userTable.email, role: workspaceMembers.role })
      .from(workspaceMembers).innerJoin(userTable, eq(userTable.id, workspaceMembers.userId))
      .where(eq(workspaceMembers.workspaceId, workspaceId)).orderBy(asc(userTable.name)),
    db.select({ id: invitations.id, email: invitations.email, role: invitations.role, expiresAt: invitations.expiresAt })
      .from(invitations).where(and(eq(invitations.workspaceId, workspaceId), isNull(invitations.acceptedAt), gt(invitations.expiresAt, new Date()))),
  ]);
  const manage = can(member, "manage_members");

  return (
    <div className="stack" style={{ gap: 16 }}>
      <section className="card">
        <div className="card-h"><h2>Members <span className="muted" style={{ fontWeight: 500 }}>{members.length}</span></h2></div>
        {manage && <div className="card-b" style={{ paddingBottom: 0 }}><InviteForm workspaceId={workspaceId} actorRole={member.role} /></div>}
        <div className="card-b tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Name</th><th>Role</th><th /></tr></thead>
            <tbody>
              {members.map((m) => (
                <MemberRow key={m.userId} workspaceId={workspaceId} m={m} actorRole={member.role}
                  editable={canManageMember(member, { userId: m.userId, role: m.role, active: true }, null)} isYou={m.userId === member.userId} />
              ))}
              {pending.map((i) => (
                <tr key={i.id}><td><b style={{ fontSize: 13.5 }}>{i.email}</b><div className="muted" style={{ fontSize: 12 }}>Invitation pending</div></td><td>{ROLE_LABELS[i.role]}</td><td /></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="card">
        <div className="card-h"><h2>What each role can do</h2></div>
        <div className="card-b tbl-wrap">
          <table className="tbl perm-grid">
            <thead><tr><th>Permission</th>{ROLES.map((r) => <th key={r}>{ROLE_LABELS[r]}</th>)}</tr></thead>
            <tbody>
              {PERMISSIONS.map((p) => (
                <tr key={p}><td style={{ fontSize: 13.5 }}>{PERM_LABELS[p]}</td>
                  {ROLES.map((r) => { const y = can({ userId: "", role: r, active: true }, p); return <td key={r}><span className={`ck ${y ? "y" : "n"}`}>{y ? "✓" : "–"}</span></td>; })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
