"use client";
import { useActionState } from "react";
import { createWorkspace } from "@/app/actions/workspace";
import { WorkspaceFields } from "@/components/WorkspaceFields";

export function NewWorkspaceForm({ workspaceId }: { workspaceId: string }) {
  const [state, action, pending] = useActionState(createWorkspace.bind(null, workspaceId), undefined);
  return (
    <form action={action} className="stack" style={{ maxWidth: 520 }}>
      <WorkspaceFields />
      {state?.error && <p className="err" role="alert">{state.error}</p>}
      <button className="btn primary" type="submit" disabled={pending} style={{ width: "max-content" }}>{pending ? "Creating…" : "Create workspace"}</button>
    </form>
  );
}
