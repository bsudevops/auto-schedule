"use server";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { orgMembers, organizations } from "@/db/schema";
import { requireWorkspace } from "@/lib/session";

async function requireOrgOwner(workspaceId: string) {
  const { user, workspace } = await requireWorkspace(workspaceId);
  const [om] = await db.select().from(orgMembers).where(and(eq(orgMembers.orgId, workspace.orgId), eq(orgMembers.userId, user.id)));
  if (om?.role !== "owner") return null;
  const [org] = await db.select().from(organizations).where(eq(organizations.id, workspace.orgId));
  return org ?? null;
}

/** Schedules the organization for deletion. Publishing and the API stop now; data is deleted after the grace period. */
export async function requestOrgDeletionAction(workspaceId: string, confirmName: string) {
  const org = await requireOrgOwner(workspaceId);
  if (!org) return { ok: false, error: "Only an organization owner can delete it." };
  if (confirmName.trim() !== org.name) return { ok: false, error: `Type “${org.name}” exactly to confirm.` };
  await db.update(organizations).set({ deletionRequestedAt: new Date() }).where(eq(organizations.id, org.id));
  revalidatePath("/w", "layout");
  return { ok: true };
}

export async function cancelOrgDeletionAction(workspaceId: string) {
  const org = await requireOrgOwner(workspaceId);
  if (!org) return { ok: false, error: "Only an organization owner can cancel the deletion." };
  await db.update(organizations).set({ deletionRequestedAt: null }).where(eq(organizations.id, org.id));
  revalidatePath("/w", "layout");
  return { ok: true };
}
