"use client";
import { useState, useTransition } from "react";
import { acceptInvitation } from "@/app/actions/workspace";

export function AcceptButton({ token }: { token: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="stack">
      <button className="btn primary" style={{ width: "max-content" }} disabled={pending}
        onClick={() => start(async () => { const r = await acceptInvitation(token); if (r?.error) setError(r.error); })}>
        {pending ? "Joining…" : "Accept invitation"}
      </button>
      {error && <p className="err" role="alert">{error}</p>}
    </div>
  );
}
