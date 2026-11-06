"use client";
import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import { saveNotificationPrefsAction, sendTestEmailAction } from "@/app/actions/notifications";

type Row = { type: string; label: string; inApp: boolean; email: boolean };

export function PrefsForm({ rows, email, workspaceId, emailOn }: { rows: Row[]; email: string; workspaceId: string; emailOn: boolean }) {
  const [state, action, pending] = useActionState(saveNotificationPrefsAction, undefined);
  return (
    <div className="stack" style={{ gap: 16 }}>
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
    <TestEmail email={email} emailOn={emailOn} />
    </div>
  );
}

function TestEmail({ email, emailOn }: { email: string; emailOn: boolean }) {
  const [pending, start] = useTransition();
  const [res, setRes] = useState<{ ok?: string; error?: string }>();
  return (
    <section className="card">
      <div className="card-h"><h2>Email sending</h2>
        <span className={`pill nodot ${emailOn ? "s-published" : "s-draft"}`}>{emailOn ? "SMTP set up" : "Not set up"}</span>
      </div>
      <div className="card-b stack" style={{ gap: 10 }}>
        <p className="muted" style={{ fontSize: 13, margin: 0 }}>
          {emailOn
            ? "Invitations, sign-up confirmations, password resets and notification emails are sent through your SMTP server."
            : "SMTP isn't configured, so emails are only printed to the server log. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD and EMAIL_FROM in .env and restart."}
        </p>
        <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
          <button type="button" className="btn" disabled={pending} onClick={() => start(async () => setRes(await sendTestEmailAction()))}>
            {pending ? "Sending…" : `Send a test email to ${email}`}
          </button>
          {res?.ok && <span className="up" role="status">{res.ok}</span>}
          {res?.error && <span className="err" role="alert">{res.error}</span>}
        </div>
      </div>
    </section>
  );
}
