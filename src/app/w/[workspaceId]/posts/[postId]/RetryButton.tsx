"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { retryFailedAction } from "@/app/actions/posts";
import { Icon } from "@/components/Icon";

export function RetryButton({ workspaceId, postId, count }: { workspaceId: string; postId: string; count: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="row" style={{ gap: 8 }}>
      {error && <span className="err">{error}</span>}
      <button className="btn sm primary" disabled={pending}
        onClick={() => start(async () => {
          const r = await retryFailedAction(workspaceId, postId);
          if (!r.ok) setError(r.error ?? "Couldn't retry.");
          router.refresh();
        })}>
        <Icon name="refresh" /> Retry {count === 1 ? "failed channel" : `${count} failed channels`}
      </button>
    </span>
  );
}
