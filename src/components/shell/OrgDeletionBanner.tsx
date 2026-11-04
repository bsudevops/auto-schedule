"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { cancelOrgDeletionAction } from "@/app/actions/organization";

export function OrgDeletionBanner({ workspaceId, orgName, deleteOn }: { workspaceId: string; orgName: string; deleteOn: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const day = new Date(deleteOn).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  return (
    <div className="banner" role="alert" style={{ marginBottom: 16, background: "var(--bad-50)", color: "var(--bad)" }}>
      <span style={{ flex: 1 }}>{orgName} and all its workspaces will be deleted on {day}. Publishing and the API are paused until then.</span>
      {error && <span>{error}</span>}
      <button className="btn sm" disabled={pending} onClick={() => start(async () => {
        const r = await cancelOrgDeletionAction(workspaceId);
        if (!r.ok) setError(r.error ?? null);
        router.refresh();
      })}>Cancel deletion</button>
    </div>
  );
}
