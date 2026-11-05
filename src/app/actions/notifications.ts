"use server";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { notificationPrefs, notifications } from "@/db/schema";
import { NOTIFICATION_TYPES, type NotificationType } from "@/lib/notify";
import { BRAND } from "@/lib/brand";
import { appUrl, emailConfigured, sendEmail, verifyEmail } from "@/lib/email";
import { requireUser } from "@/lib/session";

/** Marks some (or, with no IDs, all) of the signed-in user's notifications as read. */
export async function markNotificationsReadAction(ids?: string[]) {
  const user = await requireUser();
  const safe = (ids ?? []).filter((id) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 100);
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, user.id), isNull(notifications.readAt), ids ? inArray(notifications.id, safe.length ? safe : ["00000000-0000-0000-0000-000000000000"]) : undefined));
  revalidatePath("/w", "layout");
  return { ok: true };
}

export async function saveNotificationPrefsAction(_: unknown, form: FormData) {
  const user = await requireUser();
  const rows = (Object.keys(NOTIFICATION_TYPES) as NotificationType[]).map((type) => ({
    userId: user.id,
    type,
    inApp: form.get(`${type}.inApp`) === "on",
    email: form.get(`${type}.email`) === "on",
  }));
  for (const r of rows) {
    await db.insert(notificationPrefs).values(r).onConflictDoUpdate({ target: [notificationPrefs.userId, notificationPrefs.type], set: { inApp: r.inApp, email: r.email } });
  }
  return { ok: "Saved." };
}

const lastTest = new Map<string, number>();

/** Sends a test email to the signed-in user, to check the SMTP settings. Limited to one every 30 seconds. */
export async function sendTestEmailAction(): Promise<{ ok?: string; error?: string }> {
  const user = await requireUser();
  const now = Date.now();
  if (now - (lastTest.get(user.id) ?? 0) < 30_000) return { error: "Wait a few seconds before sending another test email." };
  lastTest.set(user.id, now);
  if (!emailConfigured()) return { error: "Email isn't set up yet: SMTP_HOST is empty in .env, so emails are only printed to the server log." };
  const problem = await verifyEmail();
  if (problem) return { error: problem };
  try {
    await sendEmail({
      to: user.email,
      subject: `Test email from ${BRAND.name}`,
      text: `Email sending works. Invitations, sign-up confirmations, password resets and notifications will be delivered from this address.`,
      button: { label: `Open ${BRAND.name}`, url: appUrl() },
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Sending failed." };
  }
  return { ok: `Test email sent to ${user.email}. Check your inbox (and spam folder).` };
}
