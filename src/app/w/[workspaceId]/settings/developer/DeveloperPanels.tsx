"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createApiKeyAction, createWebhookAction, deleteWebhookAction, revokeApiKeyAction, setWebhookActiveAction, testWebhookAction } from "@/app/actions/developer";
import { Icon } from "@/components/Icon";

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Never");

function Secret({ label, value, onDone }: { label: string; value: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="banner" role="status" style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
      <b>{label}</b>
      <span style={{ fontWeight: 400, fontSize: 13 }}>Copy it now. For your security it won&apos;t be shown again.</span>
      <div className="row" style={{ gap: 8 }}>
        <code className="input mono" style={{ flex: 1, overflowX: "auto", whiteSpace: "nowrap", background: "var(--panel)" }} data-secret>{value}</code>
        <button className="btn sm" onClick={() => navigator.clipboard?.writeText(value).then(() => setCopied(true))}><Icon name="copy" /> {copied ? "Copied" : "Copy"}</button>
        <button className="btn sm primary" onClick={onDone}>Done</button>
      </div>
    </div>
  );
}

type Key = { id: string; name: string; prefix: string; scopes: string[]; createdBy: string; createdAt: string; lastUsedAt: string | null };

export function ApiKeys({ workspaceId, scopes, keys }: { workspaceId: string; scopes: Record<string, string>; keys: Key[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<string[]>(["posts:read", "posts:write"]);
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);

  return (
    <section className="card">
      <div className="card-h"><h2>API keys</h2><a className="muted" style={{ fontSize: 12.5 }} href="https://github.com/bsudevops/auto-schedule/blob/main/docs/API.md" target="_blank" rel="noopener noreferrer">API reference</a></div>
      <div className="card-b stack">
        <p className="muted" style={{ fontSize: 13 }}>A key works only in this workspace and acts with the role of the person who created it. Only a fingerprint is stored.</p>
        {secret && <Secret label="Your new API key" value={secret} onDone={() => setSecret(null)} />}
        <form className="stack" onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            setError(null);
            const r = await createApiKeyAction(workspaceId, name, picked);
            if (!r.ok) return setError(r.error);
            setSecret(r.secret);
            setName("");
            router.refresh();
          });
        }}>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <input className="input" style={{ maxWidth: 280 }} placeholder="Key name, e.g. Zapier" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} aria-label="Key name" />
            <button className="btn primary" disabled={pending}><Icon name="key" /> Create key</button>
          </div>
          <div className="row" style={{ gap: 14, flexWrap: "wrap", fontSize: 13 }} role="group" aria-label="Permissions">
            {Object.entries(scopes).map(([k, label]) => (
              <label key={k} className="row" style={{ gap: 6 }}>
                <input type="checkbox" checked={picked.includes(k)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, k] : p.filter((x) => x !== k)))} /> {label}
              </label>
            ))}
          </div>
          {error && <p className="err" role="alert">{error}</p>}
        </form>
        {keys.length > 0 && (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Name</th><th>Key</th><th>Permissions</th><th>Last used</th><th /></tr></thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.id}>
                    <td><b style={{ fontSize: 13.5 }}>{k.name}</b><div className="muted" style={{ fontSize: 11.5 }}>By {k.createdBy}, {when(k.createdAt)}</div></td>
                    <td className="mono" style={{ fontSize: 12 }}>{k.prefix}…</td>
                    <td style={{ fontSize: 12.5 }}>{k.scopes.join(", ")}</td>
                    <td style={{ fontSize: 12.5 }}>{when(k.lastUsedAt)}</td>
                    <td style={{ textAlign: "right" }}>
                      <button className="btn sm ghost danger" disabled={pending} onClick={() => confirm(`Revoke “${k.name}”? Anything using it stops working straight away.`) && start(async () => { await revokeApiKeyAction(workspaceId, k.id); router.refresh(); })}>Revoke</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

type Hook = { id: string; url: string; events: string[]; active: boolean; lastStatus: string | null; lastDeliveryAt: string | null; failures: number };
type Delivery = { id: string; webhookId: string; event: string; status: string; code: number | null; error: string | null; attempts: number; at: string };

export function Webhooks({ workspaceId, events, hooks, deliveries }: { workspaceId: string; events: Record<string, string>; hooks: Hook[]; deliveries: Delivery[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [url, setUrl] = useState("");
  const [picked, setPicked] = useState<string[]>(Object.keys(events));
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) setError(r.error ?? "That didn't work.");
      router.refresh();
    });

  return (
    <section className="card">
      <div className="card-h"><h2>Webhooks</h2></div>
      <div className="card-b stack">
        <p className="muted" style={{ fontSize: 13 }}>We POST a JSON event to your URL, signed with HMAC-SHA256 in the <code>X-Webhook-Signature</code> header. Failed deliveries retry for about half an hour; a webhook that fails 20 times in a row is turned off.</p>
        {secret && <Secret label="Your webhook signing secret" value={secret} onDone={() => setSecret(null)} />}
        <form className="stack" onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            setError(null);
            const r = await createWebhookAction(workspaceId, url, picked);
            if (!r.ok) return setError(r.error);
            setSecret(r.secret);
            setUrl("");
            router.refresh();
          });
        }}>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <input className="input" style={{ maxWidth: 420 }} type="url" placeholder="https://example.com/webhooks/social" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Webhook URL" />
            <button className="btn primary" disabled={pending}><Icon name="plus" /> Add webhook</button>
          </div>
          <div className="row" style={{ gap: 14, flexWrap: "wrap", fontSize: 13 }} role="group" aria-label="Events">
            {Object.entries(events).map(([k, label]) => (
              <label key={k} className="row" style={{ gap: 6 }} title={label}>
                <input type="checkbox" checked={picked.includes(k)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, k] : p.filter((x) => x !== k)))} /> <span className="mono" style={{ fontSize: 12 }}>{k}</span>
              </label>
            ))}
          </div>
          {error && <p className="err" role="alert">{error}</p>}
        </form>
        {hooks.map((h) => (
          <div key={h.id} className="card card-b" style={{ boxShadow: "none" }}>
            <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <div style={{ minWidth: 0 }}>
                <b className="mono" style={{ fontSize: 13, wordBreak: "break-all" }}>{h.url}</b>
                <div className="muted" style={{ fontSize: 12 }}>{h.events.join(", ")} · Last delivery: {h.lastDeliveryAt ? `${when(h.lastDeliveryAt)} (${h.lastStatus})` : "none yet"}{h.failures ? ` · ${h.failures} failures in a row` : ""}</div>
              </div>
              <div className="row" style={{ gap: 6 }}>
                <span className={`pill ${h.active ? "s-published" : "s-draft"}`}>{h.active ? "On" : "Off"}</span>
                <button className="btn sm" disabled={pending || !h.active} onClick={() => run(() => testWebhookAction(workspaceId, h.id))}>Send test</button>
                <button className="btn sm" disabled={pending} onClick={() => run(() => setWebhookActiveAction(workspaceId, h.id, !h.active))}>{h.active ? "Turn off" : "Turn on"}</button>
                <button className="btn sm ghost danger" disabled={pending} onClick={() => confirm("Delete this webhook?") && run(() => deleteWebhookAction(workspaceId, h.id))}><Icon name="trash" /></button>
              </div>
            </div>
          </div>
        ))}
        {deliveries.length > 0 && (
          <div className="tbl-wrap">
            <h3 style={{ margin: "8px 0" }}>Recent deliveries</h3>
            <table className="tbl">
              <thead><tr><th>When</th><th>Event</th><th>Result</th><th>Attempts</th></tr></thead>
              <tbody>
                {deliveries.map((d) => (
                  <tr key={d.id}>
                    <td style={{ fontSize: 12.5 }}>{when(d.at)}</td>
                    <td className="mono" style={{ fontSize: 12 }}>{d.event}</td>
                    <td style={{ fontSize: 12.5 }}><span className={`pill ${d.status === "delivered" ? "s-published" : d.status === "failed" ? "s-failed" : "s-scheduled"}`}>{d.status === "delivered" ? `HTTP ${d.code}` : d.status === "failed" ? "Failed" : "Retrying"}</span> {d.error && <span className="muted">{d.error}</span>}</td>
                    <td className="num">{d.attempts}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
