import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { orgMembers, organizations, workspaceMembers, workspaces } from "@/db/schema";
import { workspaceInput } from "./validation";

type Result = { ok: true; id: string } | { ok: false; error: string };

/** Adds a workspace (one per client or brand) to an organization. Only its owners and admins can; the creator becomes the workspace owner. */
export async function addWorkspaceToOrg(userId: string, orgId: string, input: unknown): Promise<Result> {
  const [row] = await db
    .select({ role: orgMembers.role, deletionRequestedAt: organizations.deletionRequestedAt })
    .from(orgMembers)
    .innerJoin(organizations, eq(organizations.id, orgMembers.orgId))
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId)));
  if (!row || row.role === "member") return { ok: false, error: "Only organization owners and admins can add workspaces." };
  if (row.deletionRequestedAt) return { ok: false, error: "This organization is scheduled for deletion." };
  const parsed = workspaceInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the workspace details." };
  const id = await db.transaction(async (tx) => {
    const [ws] = await tx.insert(workspaces).values({ orgId, ...parsed.data }).returning({ id: workspaces.id });
    await tx.insert(workspaceMembers).values({ workspaceId: ws!.id, userId, role: "owner" });
    return ws!.id;
  });
  return { ok: true, id };
}
