import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { notificationPrefs, notifications, user, workspaceMembers, workspaces } from "@/db/schema";
import { sendEmail } from "./email";

/** Every notification the product sends, with the defaults a user gets until they change their preferences. */
export const NOTIFICATION_TYPES = {
  post_failed: { label: "A post fails to publish", inApp: true, email: true },
  post_published: { label: "A post is published", inApp: true, email: false },
  post_removed: { label: "A published post is deleted or taken down on the platform", inApp: true, email: true },
  channel_attention: { label: "A channel needs reconnecting or is about to expire", inApp: true, email: true },
  inbox_assigned: { label: "An inbox conversation is assigned to you", inApp: true, email: true },
  member_joined: { label: "Someone joins a workspace", inApp: true, email: false },
} as const;
export type NotificationType = keyof typeof NOTIFICATION_TYPES;

export type NotificationPayload = { title: string; body?: string; href?: string };

/**
 * Sends a notification to users, respecting each user's preferences.
 * Failures to email are logged and never stop the caller.
 */
export async function notify(opts: { userIds: string[]; workspaceId: string | null; type: NotificationType; payload: NotificationPayload }) {
  const ids = [...new Set(opts.userIds)].filter(Boolean);
  if (!ids.length) return;
  const def = NOTIFICATION_TYPES[opts.type];
  const prefs = await db.select().from(notificationPrefs).where(and(inArray(notificationPrefs.userId, ids), eq(notificationPrefs.type, opts.type)));
  const pref = (id: string) => prefs.find((p) => p.userId === id) ?? { inApp: def.inApp, email: def.email };

  const inApp = ids.filter((id) => pref(id).inApp);
  if (inApp.length)
    await db.insert(notifications).values(inApp.map((userId) => ({ userId, workspaceId: opts.workspaceId, type: opts.type, payload: opts.payload })));

  const emailIds = ids.filter((id) => pref(id).email);
  if (emailIds.length) {
    const rows = await db.select({ email: user.email, deactivatedAt: user.deactivatedAt }).from(user).where(inArray(user.id, emailIds));
    const appUrl = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
    const text = [opts.payload.body ?? "", opts.payload.href ? `\nOpen it: ${appUrl}${opts.payload.href}` : "", "\n\nChange which emails you get in Settings, Notifications."].join("");
    await Promise.all(
      rows
        .filter((r) => !r.deactivatedAt)
        .map((r) => sendEmail({ to: r.email, subject: opts.payload.title, text }).catch((e) => console.error("Notification email failed", e))),
    );
  }
}

/** The user IDs of a workspace's owners and managers. */
export async function workspaceManagers(workspaceId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), inArray(workspaceMembers.role, ["owner", "manager"])));
  return rows.map((r) => r.userId);
}
