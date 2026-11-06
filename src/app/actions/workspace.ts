"use server";
import { randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { invitations, orgMembers, organizations, user as userTable, workspaceMembers, workspaces, type WorkspaceRole } from "@/db/schema";
import { BRAND } from "@/lib/brand";
import { sha256 } from "@/lib/crypto";
import { logActivity } from "@/lib/activity";
import { addWorkspaceToOrg } from "@/lib/org-workspaces";
import { appUrl, emailConfigured, sendEmail } from "@/lib/email";
import { canManageMember, ROLE_LABELS, ROLE_RANK } from "@/lib/permissions";
import { requireUser, requireWorkspace } from "@/lib/session";
import { inviteInput, onboardingInput, workspaceInput, workspaceSettingsInput, type FormState } from "@/lib/validation";

const first = (e: { issues: { message: string }[] }) => e.issues[0]?.message ?? "Check the form and try again.";

export async function createOrganization(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = onboardingInput.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: first(parsed.error) };
  await db.transaction(async (tx) => {
    const [org] = await tx.insert(organizations).values({ name: parsed.data.orgName }).returning({ id: organizations.id });
    await tx.insert(orgMembers).values({ orgId: org!.id, userId: user.id, role: "owner" });
  });
  // Workspaces (one per brand or client) are created from the organization page.
  redirect("/organization");
}

/** Adds a workspace to an organization from the organization page. Only the organization's owners and admins can. */
export async function createWorkspaceInOrg(orgId: string, _: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const r = await addWorkspaceToOrg(user.id, orgId, Object.fromEntries(form));
  if (!r.ok) return { error: r.error };
  redirect(`/w/${r.id}`);
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

  // A new invitation replaces any earlier pending one for the same address.
  await db.delete(invitations).where(and(eq(invitations.workspaceId, workspaceId), eq(invitations.email, email), isNull(invitations.acceptedAt)));
  const sent = await createAndSendInvite({ workspaceId, workspaceName: workspace.name, email, role, inviter: user });
  await logActivity({ workspaceId, actorId: user.id, verb: "member.invited", summary: `invited ${email} as ${ROLE_LABELS[role]}`, href: `/w/${workspaceId}/settings/members` });
  revalidatePath(`/w/${workspaceId}/settings/members`);
  return sent;
}

/** Creates an invitation, emails it, and says what happened. The link is returned whenever the email didn't go out, so it can be shared another way. */
async function createAndSendInvite(opts: { workspaceId: string; workspaceName: string; email: string; role: WorkspaceRole; inviter: { id: string; name: string } }): Promise<FormState> {
  const token = randomBytes(24).toString("base64url");
  await db.insert(invitations).values({
    workspaceId: opts.workspaceId,
    email: opts.email,
    role: opts.role,
    tokenHash: sha256(token),
    invitedBy: opts.inviter.id,
    expiresAt: new Date(Date.now() + 7 * 86_400_000),
  });
  const link = `${appUrl()}/invite/${token}`;
  try {
    await sendEmail({
      to: opts.email,
      subject: `${opts.inviter.name} invited you to ${opts.workspaceName} on ${BRAND.name}`,
      text: `${opts.inviter.name} invited you to join the ${opts.workspaceName} workspace on ${BRAND.name} as ${ROLE_LABELS[opts.role]}.\n\nAccept with this email address (${opts.email}). If you don't have an account yet, you can create one from the link. The invitation works for 7 days.`,
      button: { label: "Accept invitation", url: link },
    });
  } catch (e) {
    return { error: `The invitation was created, but the email to ${opts.email} failed. ${e instanceof Error ? e.message : ""} You can share this link instead:`, link };
  }
  if (!emailConfigured()) return { ok: `Invitation created for ${opts.email}. Email isn't set up yet, so share this link with them:`, link };
  return { ok: `Invitation sent to ${opts.email}.` };
}

/** Sends a pending invitation again with a fresh link (the old link stops working) and another 7 days. */
export async function resendInvitation(workspaceId: string, invitationId: string): Promise<FormState> {
  const { user, member, workspace } = await requireWorkspace(workspaceId, "manage_members");
  const [inv] = await db.select().from(invitations).where(and(eq(invitations.id, invitationId), eq(invitations.workspaceId, workspaceId), isNull(invitations.acceptedAt)));
  if (!inv) return { error: "This invitation was already accepted or cancelled." };
  if (ROLE_RANK[inv.role] > ROLE_RANK[member.role]) return { error: "You can't resend an invitation for a higher role than yours." };
  await db.delete(invitations).where(eq(invitations.id, inv.id));
  const sent = await createAndSendInvite({ workspaceId, workspaceName: workspace.name, email: inv.email, role: inv.role, inviter: user });
  revalidatePath(`/w/${workspaceId}/settings/members`);
  return sent;
}

/** Cancels a pending invitation so its link stops working. */
export async function cancelInvitation(workspaceId: string, invitationId: string): Promise<FormState> {
  const { user, member } = await requireWorkspace(workspaceId, "manage_members");
  const [inv] = await db.select().from(invitations).where(and(eq(invitations.id, invitationId), eq(invitations.workspaceId, workspaceId), isNull(invitations.acceptedAt)));
  if (!inv) return { error: "This invitation was already accepted or cancelled." };
  if (ROLE_RANK[inv.role] > ROLE_RANK[member.role]) return { error: "You can't cancel an invitation for a higher role than yours." };
  await db.delete(invitations).where(eq(invitations.id, inv.id));
  await logActivity({ workspaceId, actorId: user.id, verb: "member.invite_cancelled", summary: `cancelled the invitation for ${inv.email}`, href: `/w/${workspaceId}/settings/members` });
  revalidatePath(`/w/${workspaceId}/settings/members`);
  return { ok: "Invitation cancelled." };
}

async function nameOf(userId: string) {
  const [u] = await db.select({ name: userTable.name }).from(userTable).where(eq(userTable.id, userId));
  return u?.name ?? "a former member";
}

export async function changeMemberRole(workspaceId: string, targetUserId: string, role: WorkspaceRole) {
  const { member } = await requireWorkspace(workspaceId, "manage_members");
  const [target] = await db.select().from(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, targetUserId)));
  if (!target || !canManageMember(member, { userId: target.userId, role: target.role, active: true }, role)) {
    return { error: "You can't change this person's role." };
  }
  await db.update(workspaceMembers).set({ role }).where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, targetUserId)));
  await logActivity({ workspaceId, actorId: member.userId, verb: "member.role", summary: `made ${await nameOf(targetUserId)} ${ROLE_LABELS[role]}`, href: `/w/${workspaceId}/settings/members` });
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
  await logActivity({ workspaceId, actorId: member.userId, verb: "member.removed", summary: `removed ${await nameOf(targetUserId)} from the workspace` });
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
