"use server";
import { randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { invitations, orgMembers, organizations, user as userTable, workspaceMembers, workspaces, type WorkspaceRole } from "@/db/schema";
import { BRAND } from "@/lib/brand";
import { sha256 } from "@/lib/crypto";
import { sendEmail } from "@/lib/email";
import { canManageMember, ROLE_LABELS, ROLE_RANK } from "@/lib/permissions";
import { requireUser, requireWorkspace } from "@/lib/session";
import { inviteInput, onboardingInput, workspaceInput, workspaceSettingsInput, type FormState } from "@/lib/validation";

const first = (e: { issues: { message: string }[] }) => e.issues[0]?.message ?? "Check the form and try again.";

export async function createOrganization(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = onboardingInput.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: first(parsed.error) };
  const { orgName, name, timezone, color } = parsed.data;
  const wsId = await db.transaction(async (tx) => {
    const [org] = await tx.insert(organizations).values({ name: orgName }).returning({ id: organizations.id });
    await tx.insert(orgMembers).values({ orgId: org!.id, userId: user.id, role: "owner" });
    const [ws] = await tx.insert(workspaces).values({ orgId: org!.id, name, timezone, color }).returning({ id: workspaces.id });
    await tx.insert(workspaceMembers).values({ workspaceId: ws!.id, userId: user.id, role: "owner" });
    return ws!.id;
  });
  redirect(`/w/${wsId}`);
}

/** Adds another workspace to the same organization. Only organization owners and admins can do this. */
export async function createWorkspace(workspaceId: string, _: FormState, form: FormData): Promise<FormState> {
  const { user, workspace } = await requireWorkspace(workspaceId);
  const [om] = await db.select().from(orgMembers).where(and(eq(orgMembers.orgId, workspace.orgId), eq(orgMembers.userId, user.id)));
  if (!om || om.role === "member") return { error: "Only organization owners and admins can add workspaces." };
  const parsed = workspaceInput.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: first(parsed.error) };
  const id = await db.transaction(async (tx) => {
    const [ws] = await tx.insert(workspaces).values({ orgId: workspace.orgId, ...parsed.data }).returning({ id: workspaces.id });
    await tx.insert(workspaceMembers).values({ workspaceId: ws!.id, userId: user.id, role: "owner" });
    return ws!.id;
  });
  redirect(`/w/${id}`);
}

export async function updateWorkspace(workspaceId: string, _: FormState, form: FormData): Promise<FormState> {
  await requireWorkspace(workspaceId, "manage_workspace");
  const parsed = workspaceSettingsInput.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: first(parsed.error) };
  await db.update(workspaces).set(parsed.data).where(eq(workspaces.id, workspaceId));
  revalidatePath(`/w/${workspaceId}`, "layout");
  return { ok: "Saved." };
}

export async function inviteMember(workspaceId: string, _: FormState, form: FormData): Promise<FormState> {
  const { user, member, workspace } = await requireWorkspace(workspaceId, "manage_members");
  const parsed = inviteInput.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: first(parsed.error) };
  const { email, role } = parsed.data;
  if (ROLE_RANK[role] > ROLE_RANK[member.role]) return { error: "You can't invite someone with a higher role than yours." };

  const [existing] = await db
    .select({ id: userTable.id })
    .from(workspaceMembers)
    .innerJoin(userTable, eq(userTable.id, workspaceMembers.userId))
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(userTable.email, email)));
  if (existing) return { error: `${email} is already in this workspace.` };

  const token = randomBytes(24).toString("base64url");
  await db.insert(invitations).values({
    workspaceId,
    email,
    role,
    tokenHash: sha256(token),
    invitedBy: user.id,
    expiresAt: new Date(Date.now() + 7 * 86_400_000),
  });
  const link = `${process.env.APP_URL ?? ""}/invite/${token}`;
  await sendEmail({
    to: email,
    subject: `${user.name} invited you to ${workspace.name} on ${BRAND.name}`,
    text: `${user.name} invited you to join ${workspace.name} as ${ROLE_LABELS[role]}.\n\nAccept the invitation: ${link}\n\nThe link works for 7 days.`,
  });
  revalidatePath(`/w/${workspaceId}/settings/members`);
  // Show the link only when email isn't configured, so the inviter can share it another way.
  return { ok: `Invitation sent to ${email}.`, link: process.env.SMTP_HOST ? undefined : link };
}

export async function changeMemberRole(workspaceId: string, targetUserId: string, role: WorkspaceRole) {
  const { member } = await requireWorkspace(workspaceId, "manage_members");
  const [target] = await db.select().from(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, targetUserId)));
  if (!target || !canManageMember(member, { userId: target.userId, role: target.role, active: true }, role)) {
    return { error: "You can't change this person's role." };
  }
  await db.update(workspaceMembers).set({ role }).where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, targetUserId)));
  revalidatePath(`/w/${workspaceId}/settings/members`);
  return { ok: "Role updated." };
}

export async function removeMember(workspaceId: string, targetUserId: string) {
  const { member } = await requireWorkspace(workspaceId, "manage_members");
  const [target] = await db.select().from(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, targetUserId)));
  if (!target || !canManageMember(member, { userId: target.userId, role: target.role, active: true }, null)) {
    return { error: "You can't remove this person." };
  }
  await db.delete(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, targetUserId)));
  revalidatePath(`/w/${workspaceId}/settings/members`);
  return { ok: "Removed." };
}

export async function acceptInvitation(token: string) {
  const user = await requireUser();
  const [inv] = await db
    .select()
    .from(invitations)
    .where(and(eq(invitations.tokenHash, sha256(token)), isNull(invitations.acceptedAt), gt(invitations.expiresAt, new Date())));
  if (!inv) return { error: "This invitation has expired or was already used. Ask for a new one." };
  // The invitation is for one email address. Signing in with another account doesn't let you use it.
  if (inv.email.toLowerCase() !== user.email.toLowerCase()) {
    return { error: `This invitation is for ${inv.email}. Sign in with that email to accept it.` };
  }
  await db.transaction(async (tx) => {
    await tx.insert(workspaceMembers).values({ workspaceId: inv.workspaceId, userId: user.id, role: inv.role }).onConflictDoNothing();
    await tx.update(invitations).set({ acceptedAt: new Date() }).where(eq(invitations.id, inv.id));
    const [ws] = await tx.select({ orgId: workspaces.orgId }).from(workspaces).where(eq(workspaces.id, inv.workspaceId));
    if (ws) await tx.insert(orgMembers).values({ orgId: ws.orgId, userId: user.id, role: "member" }).onConflictDoNothing();
  });
  redirect(`/w/${inv.workspaceId}`);
}
