import type { WorkspaceRole } from "@/db/schema";

/**
 * The single source of truth for what each role may do.
 * Every page, server action, API route and background job checks permissions through this file.
 */
export const PERMISSIONS = [
  "view",
  "create_posts",
  "edit_others_posts",
  "publish",
  "reply_inbox",
  "upload_media",
  "delete_media",
  "manage_channels",
  "manage_members",
  "manage_workspace",
  "manage_api",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<WorkspaceRole, ReadonlySet<Permission>> = {
  owner: new Set(PERMISSIONS),
  manager: new Set(PERMISSIONS),
  editor: new Set<Permission>(["view", "create_posts", "edit_others_posts", "publish", "reply_inbox", "upload_media", "delete_media"]),
  contributor: new Set<Permission>(["view", "create_posts", "reply_inbox", "upload_media"]),
  viewer: new Set<Permission>(["view"]),
};

/** Higher number = more authority. Used to stop people acting on members above them. */
export const ROLE_RANK: Record<WorkspaceRole, number> = { owner: 5, manager: 4, editor: 3, contributor: 2, viewer: 1 };

export const ROLE_LABELS: Record<WorkspaceRole, string> = {
  owner: "Owner",
  manager: "Manager",
  editor: "Editor",
  contributor: "Contributor",
  viewer: "Viewer",
};

export type Member = { userId: string; role: WorkspaceRole; active: boolean };

export function can(member: Member | null | undefined, permission: Permission): boolean {
  if (!member || !member.active) return false;
  return ROLE_PERMISSIONS[member.role].has(permission);
}

export class ForbiddenError extends Error {
  constructor(message = "You don't have permission to do that.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export function assertCan(member: Member | null | undefined, permission: Permission): asserts member is Member {
  if (!can(member, permission)) throw new ForbiddenError();
}

/**
 * Whether a member may edit, delete, reschedule or change the status of a post.
 * Authors with create rights can change their own unpublished posts; changing anyone else's needs edit_others_posts.
 */
export function canEditPost(member: Member | null | undefined, post: { authorId: string | null; status: string }): boolean {
  if (!member || !can(member, "create_posts")) return false;
  if (post.status === "publishing") return false;
  if (post.authorId === member.userId && post.status !== "published") return true;
  return can(member, "edit_others_posts");
}

/** Whether `actor` may change `target`'s role to `newRole` (or remove them when newRole is null). */
export function canManageMember(actor: Member, target: Member, newRole: WorkspaceRole | null): boolean {
  if (!can(actor, "manage_members")) return false;
  if (actor.userId === target.userId) return false;
  if (ROLE_RANK[target.role] > ROLE_RANK[actor.role]) return false;
  if (newRole && ROLE_RANK[newRole] > ROLE_RANK[actor.role]) return false;
  return true;
}
