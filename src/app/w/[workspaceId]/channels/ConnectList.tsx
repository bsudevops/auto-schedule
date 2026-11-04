"use client";
import { useState, useTransition } from "react";
import { connectWithCredentialsAction } from "@/app/actions/channels";
import { Icon } from "@/components/Icon";
import { PlatformBadge } from "@/components/ui";
import type { Platform } from "@/db/schema";

type Field = { name: string; label: string; type: "text" | "password" | "url"; placeholder?: string; help?: string };
export type ConnectOption = {
  id: string;
  name: string;
  platforms: Platform[];
  configured: boolean;
  envVars: string[];
  kind: "oauth" | "credentials" | "context";
  fields: Field[];
  /** One line on how this platform connects, shown when it's ready to connect. */
  hint?: string;
};

/** The "Connect a channel" list: a sign-in link for most platforms, a short form for the ones that need details first. */
export function ConnectList({ workspaceId, options, manage, open: initiallyOpen, contextError }: { workspaceId: string; options: ConnectOption[]; manage: boolean; open?: string; contextError?: string }) {
  const [open, setOpen] = useState<string | null>(initiallyOpen ?? null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="stack" style={{ marginTop: 12, gap: 10 }}>
      {options.map((p) => {
        const isOpen = open === p.id && manage && p.configured;
        const href = `/api/w/${workspaceId}/channels/connect/${p.id}`;
        return (
          <div key={p.id} className="connect-row" data-provider={p.id}>
            <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
              <div className="row" style={{ gap: 8, minWidth: 0 }}>
                {p.platforms.map((pl) => <PlatformBadge key={pl} platform={pl} />)}
                <b style={{ fontSize: 14 }}>{p.name}</b>
                {!p.configured && <span className="muted" style={{ fontSize: 12.5 }}>Needs {p.envVars.join(" and ")} on the server</span>}
                {p.configured && p.hint && <span className="muted" style={{ fontSize: 12.5 }}>{p.hint}</span>}
              </div>
              {!manage || !p.configured ? (
                <button className="btn sm" disabled>{p.configured ? "Connect" : "Not set up"}</button>
              ) : p.kind === "oauth" ? (
                <a className="btn sm primary" href={href}><Icon name="plus" /> Connect</a>
              ) : (
                <button type="button" className="btn sm primary" aria-expanded={isOpen} onClick={() => { setError(null); setOpen(isOpen ? null : p.id); }}>
                  <Icon name="plus" /> Connect
                </button>
              )}
            </div>

            {isOpen && p.kind === "context" && (
              // A plain GET form: the connect route checks the server and then sends the person to its sign-in page.
              <form className="connect-form" method="get" action={href}>
                {p.fields.map((f) => (
                  <label key={f.name} className="field">
                    <span>{f.label}</span>
                    <input className="input" name={f.name} type={f.type === "password" ? "password" : "text"} placeholder={f.placeholder} required autoFocus autoComplete="off" spellCheck={false} />
                    {f.help && <small className="muted">{f.help}</small>}
                  </label>
                ))}
                {contextError && <p className="err" role="alert">{contextError}</p>}
                <div className="row" style={{ gap: 8 }}>
                  <button className="btn sm primary">Continue to sign in</button>
                  <button type="button" className="btn sm ghost" onClick={() => setOpen(null)}>Cancel</button>
                </div>
              </form>
            )}

            {isOpen && p.kind === "credentials" && (
              <form
                className="connect-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  const data = Object.fromEntries(new FormData(e.currentTarget).entries()) as Record<string, string>;
                  setError(null);
                  start(async () => {
                    const r = await connectWithCredentialsAction(workspaceId, p.id, data);
                    if (r && "error" in r) setError(r.error);
                  });
                }}
              >
                {p.fields.map((f, i) => (
                  <label key={f.name} className="field">
                    <span>{f.label}</span>
                    <input className="input" name={f.name} type={f.type === "password" ? "password" : "text"} placeholder={f.placeholder} required autoFocus={i === 0} autoComplete="off" spellCheck={false} />
                    {f.help && <small className="muted">{f.help}</small>}
                  </label>
                ))}
                {error && <p className="err" role="alert">{error}</p>}
                <div className="row" style={{ gap: 8 }}>
                  <button className="btn sm primary" disabled={pending}>{pending ? "Checking…" : "Connect"}</button>
                  <button type="button" className="btn sm ghost" onClick={() => setOpen(null)}>Cancel</button>
                </div>
              </form>
            )}
          </div>
        );
      })}
    </div>
  );
}
