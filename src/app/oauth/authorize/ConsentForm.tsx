"use client";
import { useActionState } from "react";
import { decideOAuth } from "@/app/actions/oauth";

type Props = {
  fields: Record<string, string>;
  workspaces: { id: string; name: string; orgName: string }[];
  scopes: { id: string; label: string }[];
};

export function ConsentForm({ fields, workspaces, scopes }: Props) {
  const [state, action, pending] = useActionState(decideOAuth, undefined);
  return (
    <form action={action} className="card card-b stack">
      {Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <label className="field"><span>Workspace</span>
        <select className="input" name="workspaceId" id="workspaceId" required defaultValue="all">
          <option value="all">All workspaces you own or manage</option>
          {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name} · {w.orgName}</option>)}
        </select>
      </label>
      <p className="muted" style={{ fontSize: 12.5, marginTop: -6 }}>With all workspaces, it also gets client workspaces you add later. You tell it which client to work on.</p>
      <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
        <span>It may</span>
        {scopes.map((s) => (
          <label key={s.id} className="row" style={{ gap: 8, fontSize: 14 }}>
            <input type="checkbox" name="scopes" value={s.id} defaultChecked style={{ accentColor: "var(--sky)" }} /> {s.label}{s.id === "workspaces:create" ? " (all workspaces only)" : ""}
          </label>
        ))}
      </fieldset>
      {state?.error && <p className="err" role="alert">{state.error}</p>}
      <div className="row" style={{ gap: 10 }}>
        <button className="btn primary" type="submit" name="decision" value="approve" disabled={pending}>{pending ? "Connecting…" : "Allow"}</button>
        <button className="btn" type="submit" name="decision" value="deny" disabled={pending}>Deny</button>
      </div>
    </form>
  );
}
