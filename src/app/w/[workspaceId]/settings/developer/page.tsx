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
  const mcpUrl = `${(process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "")}/api/mcp`;

  return (
    <div className="stack" style={{ gap: 16 }}>
      <ApiKeys
        workspaceId={workspaceId}
        scopes={API_SCOPES}
        keys={keys.map(({ k, by }) => ({ id: k.id, name: k.name, prefix: k.prefix, scopes: k.scopes, createdBy: by ?? "Former member", createdAt: k.createdAt.toISOString(), lastUsedAt: iso(k.lastUsedAt) }))}
      />
      <section className="card">
        <div className="card-h"><h2>Connect an AI assistant</h2><a className="muted" style={{ fontSize: 12.5 }} href="https://github.com/bsudevops/auto-schedule/blob/main/docs/MCP.md" target="_blank" rel="noopener noreferrer">Setup guide</a></div>
        <div className="card-b stack">
          <p className="muted" style={{ fontSize: 13 }}>Assistants that support MCP, like Claude, can list your channels, draft and schedule posts, and read analytics. Create an API key above, then add this address to the assistant with the header <code>Authorization: Bearer your-key</code>. The assistant can only do what the key&apos;s permissions allow.</p>
          <code data-mcp-url style={{ display: "block", overflowWrap: "anywhere" }}>{mcpUrl}</code>
        </div>
      </section>
      <Webhooks
        workspaceId={workspaceId}
        events={WEBHOOK_EVENTS}
        hooks={hooks.map((h) => ({ id: h.id, url: h.url, events: h.events, active: h.active, lastStatus: h.lastStatus, lastDeliveryAt: iso(h.lastDeliveryAt), failures: h.consecutiveFailures }))}
        deliveries={deliveries.map((d) => ({ id: d.id, webhookId: d.webhookId, event: d.event, status: d.status, code: d.responseCode, error: d.error, attempts: d.attempts, at: d.createdAt.toISOString() }))}
      />
    </div>
  );
}
