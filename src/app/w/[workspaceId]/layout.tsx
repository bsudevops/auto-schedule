import Link from "next/link";
import { and, count, eq, isNull } from "drizzle-orm";
import { Icon } from "@/components/Icon";
import { MenuButton, Sidebar } from "@/components/shell/Sidebar";
import { db } from "@/db";
import { inboxThreads } from "@/db/schema";
import { BRAND } from "@/lib/brand";
import { can, ROLE_LABELS } from "@/lib/permissions";
import { listUserWorkspaces, requireWorkspace } from "@/lib/session";

export default async function WorkspaceLayout({ children, params }: { children: React.ReactNode; params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const { user, member, workspace, orgName } = await requireWorkspace(workspaceId);
  const [all, [unread]] = await Promise.all([
    listUserWorkspaces(user.id),
    db.select({ n: count() }).from(inboxThreads).where(and(eq(inboxThreads.workspaceId, workspaceId), eq(inboxThreads.unread, true), isNull(inboxThreads.doneAt))),
  ]);
  const current = { id: workspace.id, name: workspace.name, color: workspace.color, orgName };

  return (
    <div className="app">
      <Sidebar brand={BRAND.name} tagline={BRAND.tagline} current={current} workspaces={all} user={user} roleLabel={ROLE_LABELS[member.role]} unread={unread?.n ?? 0} />
      <div className="main">
        <header className="topbar">
          <MenuButton />
          <label className="search">
            <Icon name="search" size={16} />
            <input id="gsearch" placeholder="Search posts, media, conversations" aria-label="Search" />
          </label>
          <div className="top-actions">
            <button className="icon-btn" aria-label="Notifications"><Icon name="bell" /></button>
            {can(member, "create_posts") && (
              <Link className="btn primary" href={`/w/${workspaceId}/compose`}><Icon name="plus" /><span>Create post</span></Link>
            )}
          </div>
        </header>
        <div className="scroll"><div className="page">{children}</div></div>
      </div>
    </div>
  );
}
