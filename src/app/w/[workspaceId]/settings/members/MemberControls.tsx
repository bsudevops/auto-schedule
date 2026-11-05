"use client";
import { useActionState, useState, useTransition } from "react";
import { cancelInvitation, changeMemberRole, inviteMember, removeMember, resendInvitation } from "@/app/actions/workspace";
import { Avatar } from "@/components/ui";
import type { WorkspaceRole } from "@/db/schema";
import { ROLE_LABELS, ROLE_RANK } from "@/lib/permissions";

const ASSIGNABLE = ["manager", "editor", "contributor", "viewer"] as const;

export function InviteForm({ workspaceId, actorRole }: { workspaceId: string; actorRole: WorkspaceRole }) {
  const [state, action, pending] = useActionState(inviteMember.bind(null, workspaceId), undefined);
  return (
    <form action={action} className="stack">
      <div className="row" style={{ flexWrap: "wrap", alignItems: "flex-end" }}>
        <label className="field" style={{ flex: "1 1 240px" }}><span>Invite by email</span><input className="input" type="email" name="email" id="invite-email" required placeholder="name@company.com" /></label>
        <label className="field"><span>Role</span>
          <select className="input" name="role" id="invite-role" defaultValue="editor">
            {ASSIGNABLE.filter((r) => ROLE_RANK[r] <= ROLE_RANK[actorRole]).map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
        </label>
        <button className="btn primary" type="submit" disabled={pending}>{pending ? "Sending…" : "Send invite"}</button>
      </div>
      {state?.error && <p className="err" role="alert">{state.error}</p>}
      {state?.ok && <p className="up" role="status">{state.ok}</p>}
      {state?.link && <InviteLink link={state.link} />}
    </form>
  );
}

function InviteLink({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
      <span className="mono" style={{ wordBreak: "break-all", fontSize: 12.5 }}>{link}</span>
      <button type="button" className="btn sm" onClick={() => navigator.clipboard?.writeText(link).then(() => setCopied(true))}>{copied ? "Copied" : "Copy link"}</button>
    </div>
  );
}

/** A pending invitation, with Resend (fresh link, new 7 days) and Cancel. */
export function InvitationRow({ workspaceId, inv, manage }: { workspaceId: string; inv: { id: string; email: string; role: WorkspaceRole; expiresAt: Date }; manage: boolean }) {
  const [pending, start] = useTransition();
  const [res, setRes] = useState<{ error?: string; ok?: string; link?: string } | undefined>();
  return (
    <tr>
      <td>
        <b style={{ fontSize: 13.5 }}>{inv.email}</b>
        <div className="muted" style={{ fontSize: 12 }}>Invitation pending · expires {new Date(inv.expiresAt).toLocaleDateString()}</div>
        {res?.error && <div className="err" role="alert">{res.error}</div>}
        {res?.ok && <div className="up" role="status">{res.ok}</div>}
        {res?.link && <InviteLink link={res.link} />}
      </td>
      <td>{ROLE_LABELS[inv.role]}</td>
      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
        {manage && <>
          <button className="btn sm ghost" disabled={pending} onClick={() => start(async () => setRes(await resendInvitation(workspaceId, inv.id)))}>{pending ? "…" : "Resend"}</button>
          <button className="btn sm ghost danger" disabled={pending} onClick={() => start(async () => setRes(await cancelInvitation(workspaceId, inv.id)))}>Cancel</button>
        </>}
      </td>
    </tr>
  );
}

export function MemberRow({ workspaceId, m, actorRole, editable, isYou }: {
  workspaceId: string; m: { userId: string; name: string; email: string; role: WorkspaceRole }; actorRole: WorkspaceRole; editable: boolean; isYou: boolean;
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <tr>
      <td><div className="row"><Avatar name={m.name} /><div><b style={{ fontSize: 13.5 }}>{m.name}{isYou && <span className="muted"> (you)</span>}</b><div className="muted" style={{ fontSize: 12 }}>{m.email}</div></div></div></td>
      <td>
        {editable ? (
          <select className="input" style={{ width: "auto", padding: "5px 8px" }} aria-label={`Role for ${m.name}`} defaultValue={m.role} disabled={pending}
            onChange={(e) => start(async () => { const r = await changeMemberRole(workspaceId, m.userId, e.target.value as WorkspaceRole); setMsg(r.error ?? null); })}>
            {ASSIGNABLE.filter((r) => ROLE_RANK[r] <= ROLE_RANK[actorRole]).map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
        ) : <span className="pill nodot s-scheduled">{ROLE_LABELS[m.role]}</span>}
        {msg && <div className="err">{msg}</div>}
      </td>
      <td style={{ textAlign: "right" }}>
        {editable && <button className="btn sm ghost danger" disabled={pending} onClick={() => start(async () => { const r = await removeMember(workspaceId, m.userId); setMsg(r.error ?? null); })}>Remove</button>}
      </td>
    </tr>
  );
}
