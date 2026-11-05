"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { checkPostOnPlatformsAction } from "@/app/actions/posts";
import { Icon } from "@/components/Icon";

/** Asks the platforms right away whether this post is still there (the worker also checks every 15 minutes). */
export function CheckNowButton({ workspaceId, postId }: { workspaceId: string; postId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null);
  return (
    <span className="row" style={{ gap: 8 }}>
      <button type="button" className="btn" disabled={pending}
        onClick={() => start(async () => {
          setNote(null);
          const r = await checkPostOnPlatformsAction(workspaceId, postId);
          if (!r.ok) setNote({ text: r.error, bad: true });
          else setNote({ text: r.removed ? "Gone from the platform. Marked as deleted." : "Checked: still live.", bad: r.removed > 0 });
          router.refresh();
        })}>
        <Icon name="refresh" /> {pending ? "Checking…" : "Check now"}
      </button>
      {note && <span className={note.bad ? "err" : "muted"} role="status" style={{ fontSize: 13 }}>{note.text}</span>}
    </span>
  );
}
