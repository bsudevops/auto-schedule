"use client";
import { useActionState } from "react";
import { updateWorkspace } from "@/app/actions/workspace";
import { WorkspaceFields } from "@/components/WorkspaceFields";

type Ws = { id: string; name: string; timezone: string; color: string; defaultHashtags: string; defaultFirstComment: string; savedReplies: string[] };

export function WorkspaceForm({ workspace, canEdit }: { workspace: Ws; canEdit: boolean }) {
  const [state, action, pending] = useActionState(updateWorkspace.bind(null, workspace.id), undefined);
  return (
    <form action={action} className="card card-b">
      {!canEdit && <p className="banner" style={{ marginBottom: 12 }}>Only owners and managers can change these settings.</p>}
      <div className="set-row">
        <div><h3>Workspace</h3><p>Name, time zone and colour for this brand. Posting times use this time zone.</p></div>
        <div className="stack" style={{ maxWidth: 520 }}><WorkspaceFields name={workspace.name} timezone={workspace.timezone} color={workspace.color} disabled={!canEdit} /></div>
      </div>
      <div className="set-row">
        <div><h3>Post defaults</h3><p>Prefilled on every new post in this workspace.</p></div>
        <div className="stack" style={{ maxWidth: 520 }}>
          <label className="field"><span>Default hashtags</span><input className="input" name="defaultHashtags" id="defaultHashtags" defaultValue={workspace.defaultHashtags} maxLength={500} disabled={!canEdit} placeholder="#BSUScheduler #Coffee" /></label>
          <label className="field"><span>Default first comment</span><input className="input" name="defaultFirstComment" id="defaultFirstComment" defaultValue={workspace.defaultFirstComment} maxLength={2000} disabled={!canEdit} /></label>
        </div>
      </div>
      <div className="set-row">
        <div><h3>Saved replies</h3><p>Shown as one-click replies in the inbox. One per line.</p></div>
        <div className="stack" style={{ maxWidth: 520 }}>
          <label className="field"><span>Saved replies</span><textarea className="input" name="savedReplies" id="savedReplies" rows={4} defaultValue={workspace.savedReplies.join("\n")} disabled={!canEdit} placeholder={"Thanks so much!\nSorry about that. Can you send us a message with the details?"} /></label>
        </div>
      </div>
      {canEdit && (
        <div className="row" style={{ justifyContent: "flex-end", paddingTop: 16, gap: 12 }}>
          {state?.error && <span className="err" role="alert">{state.error}</span>}
          {state?.ok && <span className="up" role="status">{state.ok}</span>}
          <button className="btn primary" type="submit" disabled={pending}>{pending ? "Saving…" : "Save changes"}</button>
        </div>
      )}
    </form>
  );
}
