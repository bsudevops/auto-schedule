"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { requestOrgDeletionAction } from "@/app/actions/organization";

export function DeleteOrg({ workspaceId, orgName, days }: { workspaceId: string; orgName: string; days: number }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <section className="card card-b stack" style={{ borderColor: "var(--bad-50)" }}>
      <h3 style={{ color: "var(--bad)" }}>Delete organization</h3>
      <p className="muted" style={{ fontSize: 13 }}>
        Deletes {orgName}, every workspace in it, all posts, media, channels and analytics. Publishing and the API stop straight away, and everything is erased after {days} days. You can cancel until then.
      </p>
      <form className="row" style={{ gap: 8, flexWrap: "wrap" }} onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError(null);
          const r = await requestOrgDeletionAction(workspaceId, name);
          if (!r.ok) setError(r.error ?? null);
          router.refresh();
        });
      }}>
        <input className="input" style={{ maxWidth: 300 }} value={name} onChange={(e) => setName(e.target.value)} placeholder={`Type ${orgName} to confirm`} aria-label="Organization name" />
        <button className="btn danger" disabled={pending || name.trim() !== orgName}>Delete organization</button>
      </form>
      {error && <p className="err" role="alert">{error}</p>}
    </section>
  );
}
