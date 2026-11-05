"use client";
import { useActionState } from "react";
import { createWorkspaceInOrg } from "@/app/actions/workspace";
import { Icon } from "@/components/Icon";
import { WorkspaceFields } from "@/components/WorkspaceFields";

export function NewWorkspaceInOrgForm({ orgId, orgName }: { orgId: string; orgName?: string }) {
  const [state, action, pending] = useActionState(createWorkspaceInOrg.bind(null, orgId), undefined);
  const tz = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC";
  return (
    <form action={action} className="org-form stack">
      <div className="org-form-head">
        <span className="org-form-icon" aria-hidden><Icon name="plus" size={18} /></span>
        <div>
          <h3>New workspace{orgName ? ` in ${orgName}` : ""}</h3>
          <p>One workspace per client or brand. Its posts, channels and media stay separate.</p>
        </div>
      </div>
      <WorkspaceFields timezone={tz} />
      {state?.error && <p className="err" role="alert">{state.error}</p>}
      <button className="btn primary org-submit" type="submit" disabled={pending}>{pending ? "Creating…" : "Create workspace"}</button>
    </form>
  );
}
