import "server-only";
import { workspaceLogoUrl } from "@/lib/workspace-logo";
import { and, asc, eq, isNull } from "drizzle-orm";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { db } from "@/db";
import { orgMembers, organizations, workspaceMembers, workspaces } from "@/db/schema";
import { auth } from "./auth";
import { assertCan, type Member, type Permission } from "./permissions";

export type SessionUser = { id: string; name: string; email: string; image: string | null };

export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const s = await auth.api.getSession({ headers: await headers() });
  if (!s) return null;
  const u = s.user as typeof s.user & { deactivatedAt?: Date | null };
  if (u.deactivatedAt) return null;
  return { id: u.id, name: u.name, email: u.email, image: u.image ?? null };
});

export async function requireUser(): Promise<SessionUser> {
  const u = await getSessionUser();
  if (!u) redirect("/sign-in");
  return u;
}

export const listUserWorkspaces = cache(async (userId: string) =>
  db
    .select({ id: workspaces.id, name: workspaces.name, color: workspaces.color, iconKey: workspaces.iconKey, orgName: organizations.name, role: workspaceMembers.role })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .innerJoin(organizations, eq(organizations.id, workspaces.orgId))
    .where(and(eq(workspaceMembers.userId, userId), isNull(workspaces.archivedAt)))
    .orderBy(asc(workspaces.name))
    .then((rows) => rows.map(({ iconKey, ...w }) => ({ ...w, logoUrl: workspaceLogoUrl(iconKey) }))),
);

/** Organizations the person belongs to, with their role in each. */
export const listUserOrgs = cache(async (userId: string) =>
  db
    .select({ id: organizations.id, name: organizations.name, role: orgMembers.role, deletionRequestedAt: organizations.deletionRequestedAt })
    .from(orgMembers)
    .innerJoin(organizations, eq(organizations.id, orgMembers.orgId))
    .where(eq(orgMembers.userId, userId))
    .orderBy(asc(organizations.name)),
);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Loads a workspace the signed-in user belongs to and checks a permission.
 * Every workspace page and server action starts here. Non-members get a 404, not a hint that the workspace exists.
 */
export async function workspaceAccess(workspaceId: string) {
  const user = await getSessionUser();
  if (!user || !UUID.test(workspaceId)) return null;
  const [row] = await db
    .select({ workspace: workspaces, role: workspaceMembers.role })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, user.id), isNull(workspaces.archivedAt)));
  if (!row) return null;
  return { user, member: { userId: user.id, role: row.role, active: true } as Member, workspace: row.workspace };
}

export async function requireWorkspace(workspaceId: string, permission: Permission = "view") {
  const user = await requireUser();
  if (!UUID.test(workspaceId)) notFound();
  const [row] = await db
    .select({ workspace: workspaces, role: workspaceMembers.role, orgName: organizations.name })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .innerJoin(organizations, eq(organizations.id, workspaces.orgId))
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, user.id), isNull(workspaces.archivedAt)));
  if (!row) notFound();
  const member: Member = { userId: user.id, role: row.role, active: true };
  assertCan(member, permission);
  return { user, member, workspace: row.workspace, orgName: row.orgName };
}
