import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { apiKeys, user, webhookDeliveries, webhooks } from "@/db/schema";
import { API_SCOPES } from "@/lib/api-auth";
import { can } from "@/lib/permissions";
import { requireWorkspace } from "@/lib/session";
import { WEBHOOK_EVENTS } from "@/lib/webhooks";
import { ApiKeys, Webhooks } from "./DeveloperPanels";

export const metadata = { title: "API & webhooks" };

export default async function Page({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const { member } = await requireWorkspace(workspaceId);
  if (!can(member, "manage_api")) {
    return <div className="card card-b"><p className="muted">Only owners and managers can manage API keys and webhooks.</p></div>;
  }
  const [keys, hooks] = await Promise.all([
    db.select({ k: apiKeys, by: user.name }).from(apiKeys).leftJoin(user, eq(user.id, apiKeys.createdBy)).where(and(eq(apiKeys.workspaceId, workspaceId), isNull(apiKeys.revokedAt))).orderBy(desc(apiKeys.createdAt)),
    db.select().from(webhooks).where(eq(webhooks.workspaceId, workspaceId)).orderBy(desc(webhooks.createdAt)),
  ]);
  const deliveries = hooks.length
    ? await db.select().from(webhookDeliveries).where(inArray(webhookDeliveries.webhookId, hooks.map((h) => h.id))).orderBy(desc(webhookDeliveries.createdAt)).limit(20)
    : [];
  const iso = (d: Date | null) => d?.toISOString() ?? null;

  return (
    <div className="stack" style={{ gap: 16 }}>
      <ApiKeys
        workspaceId={workspaceId}
        scopes={API_SCOPES}
        keys={keys.map(({ k, by }) => ({ id: k.id, name: k.name, prefix: k.prefix, scopes: k.scopes, createdBy: by ?? "Former member", createdAt: k.createdAt.toISOString(), lastUsedAt: iso(k.lastUsedAt) }))}
      />
      <Webhooks
        workspaceId={workspaceId}
        events={WEBHOOK_EVENTS}
        hooks={hooks.map((h) => ({ id: h.id, url: h.url, events: h.events, active: h.active, lastStatus: h.lastStatus, lastDeliveryAt: iso(h.lastDeliveryAt), failures: h.consecutiveFailures }))}
        deliveries={deliveries.map((d) => ({ id: d.id, webhookId: d.webhookId, event: d.event, status: d.status, code: d.responseCode, error: d.error, attempts: d.attempts, at: d.createdAt.toISOString() }))}
      />
    </div>
  );
}
