"use client";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Icon } from "@/components/Icon";
import { dismissRemovedAlertAction } from "@/app/actions/posts";

/** Closes a "no longer on the platform" alert on the Overview. The post stays marked elsewhere. */
export function DismissAlertButton({ workspaceId, postId }: { workspaceId: string; postId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button type="button" className="icon-btn ov-dismiss" aria-label="Dismiss this alert" title="Dismiss" disabled={pending}
      onClick={(e) => {
        const row = (e.currentTarget as HTMLElement).closest(".ov-alert") as HTMLElement | null;
        if (row) row.hidden = true;
        start(async () => {
          const r = await dismissRemovedAlertAction(workspaceId, postId);
          if (!r.ok && row) row.hidden = false;
          router.refresh();
        });
      }}>
      <Icon name="x" size={16} />
    </button>
  );
}
