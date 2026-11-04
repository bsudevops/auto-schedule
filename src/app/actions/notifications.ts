"use server";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { notificationPrefs, notifications } from "@/db/schema";
import { NOTIFICATION_TYPES, type NotificationType } from "@/lib/notify";
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
