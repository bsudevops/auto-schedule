"use client";
import { useActionState } from "react";
import { createOrganization } from "@/app/actions/workspace";
import { WorkspaceFields } from "@/components/WorkspaceFields";

export function OnboardingForm() {
  const [state, action, pending] = useActionState(createOrganization, undefined);
  const tz = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC";
  return (
    <form action={action} className="card card-b stack">
      <label className="field"><span>Company or agency name</span><input className="input" name="orgName" id="orgName" required maxLength={80} placeholder="e.g. Your company name" /></label>
      <h3 style={{ marginTop: 8 }}>First workspace</h3>
      <p className="muted" style={{ fontSize: 13, marginTop: -6 }}>One workspace per brand or client.</p>
      <WorkspaceFields timezone={tz} />
      {state?.error && <p className="err" role="alert">{state.error}</p>}
      <button className="btn primary" type="submit" disabled={pending} style={{ justifyContent: "center" }}>{pending ? "Setting up…" : "Continue"}</button>
    </form>
  );
}
