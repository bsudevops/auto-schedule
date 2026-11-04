import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { ideas, user as userTable } from "@/db/schema";
import { can } from "@/lib/permissions";
import { requireWorkspace } from "@/lib/session";
import { IdeaBoard } from "./IdeaBoard";

export const metadata = { title: "Ideas" };

export default async function Page({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const { member } = await requireWorkspace(workspaceId);
  const rows = await db.select({ id: ideas.id, title: ideas.title, column: ideas.column, tags: ideas.tags, createdBy: ideas.createdBy, author: userTable.name })
    .from(ideas).leftJoin(userTable, eq(userTable.id, ideas.createdBy)).where(eq(ideas.workspaceId, workspaceId)).orderBy(asc(ideas.position));
  return (
    <>
      <div className="page-head"><div><h1>Ideas</h1><p>Collect ideas, move them along, and turn the ready ones into posts.</p></div></div>
      <IdeaBoard workspaceId={workspaceId} ideas={rows.map((r) => ({ ...r, author: r.author ?? "Former member", mine: r.createdBy === member.userId }))}
        canCreate={can(member, "create_posts")} canEditAll={can(member, "edit_others_posts")} />
    </>
  );
}
