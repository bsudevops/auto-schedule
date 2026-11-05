import { eq } from "drizzle-orm";
import { db } from "@/db";
import { notificationPrefs } from "@/db/schema";
import { emailConfigured } from "@/lib/email";
import { NOTIFICATION_TYPES, type NotificationType } from "@/lib/notify";
import { requireWorkspace } from "@/lib/session";
import { PrefsForm } from "./PrefsForm";

export const metadata = { title: "Notifications" };

export default async function Page({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const { user } = await requireWorkspace(workspaceId);
  const saved = await db.select().from(notificationPrefs).where(eq(notificationPrefs.userId, user.id));
  const rows = (Object.entries(NOTIFICATION_TYPES) as [NotificationType, (typeof NOTIFICATION_TYPES)[NotificationType]][]).map(([type, d]) => {
    const p = saved.find((s) => s.type === type);
    return { type, label: d.label, inApp: p?.inApp ?? d.inApp, email: p?.email ?? d.email };
  });
  return <PrefsForm rows={rows} email={user.email} workspaceId={workspaceId} emailOn={emailConfigured()} />;
}
