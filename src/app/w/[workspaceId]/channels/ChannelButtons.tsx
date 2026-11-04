"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { disconnectChannelAction, removeChannelAction } from "@/app/actions/channels";
import { Icon } from "@/components/Icon";

export function ChannelButtons({ workspaceId, channelId, name, reconnectHref, status }: { workspaceId: string; channelId: string; name: string; reconnectHref: string | null; status: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<{ ok: boolean }>) =>
    start(async () => {
      try {
        await fn();
        router.refresh();
      } catch {
        setError("That didn't work. Try again.");
      }
    });

  return (
    <div className="row" style={{ gap: 8, marginTop: status === "disconnected" ? 0 : 12, flexWrap: "wrap" }}>
      {reconnectHref && status !== "connected" && (
        <a className="btn sm primary" href={reconnectHref}><Icon name="refresh" /> {status === "expiring" ? "Renew" : "Reconnect"}</a>
      )}
      {status !== "disconnected" ? (
        <button className="btn sm ghost danger" disabled={pending}
          onClick={() => confirm(`Disconnect ${name}? Scheduled posts for it won't go out until you reconnect it.`) && run(() => disconnectChannelAction(workspaceId, channelId))}>
          Disconnect
        </button>
      ) : (
        <button className="btn sm ghost danger" disabled={pending}
          onClick={() => confirm(`Remove ${name} for good? Its post history on this channel is deleted too.`) && run(() => removeChannelAction(workspaceId, channelId))}>
          <Icon name="trash" /> Remove
        </button>
      )}
      {error && <span className="err">{error}</span>}
    </div>
  );
}
