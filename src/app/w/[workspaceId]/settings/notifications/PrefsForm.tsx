"use client";
import Link from "next/link";
import { useActionState } from "react";
import { saveNotificationPrefsAction } from "@/app/actions/notifications";

type Row = { type: string; label: string; inApp: boolean; email: boolean };

export function PrefsForm({ rows, email, workspaceId }: { rows: Row[]; email: string; workspaceId: string }) {
  const [state, action, pending] = useActionState(saveNotificationPrefsAction, undefined);
  return (
    <form action={action} className="card">
      <div className="card-h"><h2>Your notifications</h2><span className="muted" style={{ fontSize: 12.5 }}>Emails go to {email}. These apply in every workspace.</span></div>
      <div className="card-b tbl-wrap">
        <table className="tbl">
          <thead><tr><th>When</th><th style={{ textAlign: "center" }}>In the app</th><th style={{ textAlign: "center" }}>Email</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.type}>
                <td>{r.label}</td>
                <td style={{ textAlign: "center" }}><input type="checkbox" name={`${r.type}.inApp`} defaultChecked={r.inApp} aria-label={`${r.label}: in the app`} /></td>
                <td style={{ textAlign: "center" }}><input type="checkbox" name={`${r.type}.email`} defaultChecked={r.email} aria-label={`${r.label}: email`} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted" style={{ fontSize: 12.5, marginTop: 12 }}>
          To send events to another system, add a webhook in <Link href={`/w/${workspaceId}/settings/developer`}>API &amp; webhooks</Link>.
        </p>
        <div className="row" style={{ justifyContent: "flex-end", gap: 12, paddingTop: 12 }}>
          {state?.ok && <span className="up" role="status">{state.ok}</span>}
          <button className="btn primary" disabled={pending}>Save</button>
        </div>
      </div>
    </form>
  );
}
