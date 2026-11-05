"use client";
import { useActionState } from "react";
import { createWorkspaceInOrg } from "@/app/actions/workspace";
import { WorkspaceFields } from "@/components/WorkspaceFields";

export function NewWorkspaceInOrgForm({ orgId }: { orgId: string }) {
  const [state, action, pending] = useActionState(createWorkspaceInOrg.bind(null, orgId), undefined);
  const tz = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC";
  return (
    <form action={action} className="card card-b stack" style={{ maxWidth: 520 }}>
      <h3>New workspace</h3>
      <p className="muted" style={{ fontSize: 13, marginTop: -6 }}>One workspace per client or brand. Its posts, channels and media stay separate.</p>
      <WorkspaceFields timezone={tz} />
      {state?.error && <p className="err" role="alert">{state.error}</p>}
      <button className="btn primary" type="submit" disabled={pending} style={{ width: "max-content" }}>{pending ? "Creating…" : "Create workspace"}</button>
    </form>
  );
}
