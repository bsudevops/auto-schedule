import Link from "next/link";
import { and, count, desc, eq, isNull, or } from "drizzle-orm";
import { Icon } from "@/components/Icon";
import { MenuButton, Sidebar } from "@/components/shell/Sidebar";
import { db } from "@/db";
import { inboxThreads, notifications, organizations } from "@/db/schema";
import { NotificationBell } from "@/components/shell/NotificationBell";
import { OrgDeletionBanner } from "@/components/shell/OrgDeletionBanner";
import type { NotificationPayload } from "@/lib/notify";
import { BRAND } from "@/lib/brand";
import { DELETION_GRACE_DAYS } from "@/lib/org-deletion";
import { can, ROLE_LABELS } from "@/lib/permissions";
import { listUserWorkspaces, requireWorkspace } from "@/lib/session";
import { workspaceLogoUrl } from "@/lib/workspace-logo";

export default async function WorkspaceLayout({ children, params }: { children: React.ReactNode; params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const { user, member, workspace, orgName } = await requireWorkspace(workspaceId);
  const mine = and(eq(notifications.userId, user.id), or(isNull(notifications.workspaceId), eq(notifications.workspaceId, workspaceId)));
  const [all, [unread], notes, [unreadNotes], [org]] = await Promise.all([
    listUserWorkspaces(user.id),
    db.select({ n: count() }).from(inboxThreads).where(and(eq(inboxThreads.workspaceId, workspaceId), eq(inboxThreads.unread, true), isNull(inboxThreads.doneAt))),
    db.select().from(notifications).where(mine).orderBy(desc(notifications.createdAt)).limit(15),
    db.select({ n: count() }).from(notifications).where(and(mine, isNull(notifications.readAt))),
    db.select({ deletionRequestedAt: organizations.deletionRequestedAt }).from(organizations).where(eq(organizations.id, workspace.orgId)),
  ]);
  const current = { id: workspace.id, name: workspace.name, color: workspace.color, orgName, logoUrl: workspaceLogoUrl(workspace.iconKey) };

  return (
    <div className="app">
      <Sidebar brand={BRAND.name} tagline={BRAND.tagline} current={current} workspaces={all} user={user} roleLabel={ROLE_LABELS[member.role]} unread={unread?.n ?? 0} />
      <div className="main">
        <header className="topbar">
          <MenuButton />
          <form className="search" action={`/w/${workspaceId}/search`} role="search">
            <Icon name="search" size={16} />
            <input id="gsearch" name="q" placeholder="Search posts, media, conversations" aria-label="Search" maxLength={100} />
          </form>
          <div className="top-actions">
            <NotificationBell
              unread={unreadNotes?.n ?? 0}
              settingsHref={`/w/${workspaceId}/settings/notifications`}
              items={notes.map((n) => {
                const p = n.payload as NotificationPayload;
                // Only follow links inside the app.
                const href = typeof p.href === "string" && p.href.startsWith("/") && !p.href.startsWith("//") ? p.href : null;
                return { id: n.id, title: String(p.title ?? ""), body: p.body ?? null, href, at: n.createdAt.toISOString(), read: n.readAt !== null };
              })}
            />
            {can(member, "create_posts") && (
              <Link className="btn primary" href={`/w/${workspaceId}/compose`}><Icon name="plus" /><span>Create post</span></Link>
            )}
          </div>
        </header>
        <div className="scroll"><div className="page">
          {org?.deletionRequestedAt && <OrgDeletionBanner workspaceId={workspaceId} orgName={orgName} deleteOn={new Date(org.deletionRequestedAt.getTime() + DELETION_GRACE_DAYS * 86_400_000).toISOString()} />}
          {children}
        </div></div>
      </div>
    </div>
  );
}
