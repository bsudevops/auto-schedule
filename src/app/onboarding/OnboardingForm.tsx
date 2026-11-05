"use client";
import { useActionState } from "react";
import { createOrganization } from "@/app/actions/workspace";

export function OnboardingForm() {
  const [state, action, pending] = useActionState(createOrganization, undefined);
  return (
    <form action={action} className="card card-b stack">
      <label className="field"><span>Company or agency name</span><input className="input" name="orgName" id="orgName" required maxLength={80} placeholder="e.g. Your company name" /></label>
      {state?.error && <p className="err" role="alert">{state.error}</p>}
      <button className="btn primary" type="submit" disabled={pending} style={{ justifyContent: "center" }}>{pending ? "Setting up…" : "Continue"}</button>
    </form>
  );
}
