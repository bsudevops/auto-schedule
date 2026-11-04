"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { assignAction, doneAction, markReadAction, replyAction } from "@/app/actions/inbox";
import { Icon } from "@/components/Icon";
import { PlatformBadge } from "@/components/ui";
import type { Platform } from "@/db/schema";
import { PLATFORMS } from "@/lib/platforms";

type Props = {
  workspaceId: string;
  replyAs: string;
  thread: { id: string; authorName: string; subject: string; kind: string; sentiment: string; assignedTo: string | null; unread: boolean; done: boolean; platform: Platform; channelName: string };
  messages: { id: string; fromUs: boolean; body: string; who: string; at: string }[];
  people: { id: string; name: string }[];
  canReply: boolean;
  replyBlockedReason: string;
  savedReplies: string[];
};

const SENTIMENT: Record<string, string> = { positive: "s-published", negative: "s-failed", neutral: "s-draft" };

export function ThreadDetail({ workspaceId, replyAs, thread, messages, people, canReply, replyBlockedReason, savedReplies }: Props) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (thread.unread) void markReadAction(workspaceId, thread.id).then(() => router.refresh());
    end.current?.scrollIntoView({ block: "end" });
  }, [thread.id, thread.unread, workspaceId, router]);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) setError(r.error ?? "That didn't work.");
      else after?.();
      router.refresh();
    });

  const send = () => run(() => replyAction(workspaceId, thread.id, text), () => setText(""));
  const fmt = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  return (
    <div className="detail">
      <div className="detail-h">
        <PlatformBadge platform={thread.platform} large />
        <div style={{ flex: 1, minWidth: 160 }}>
          <h2>{thread.authorName}</h2>
          <div className="muted" style={{ fontSize: 12.5 }}>{thread.kind}{thread.subject ? ` on “${thread.subject}”` : ""} · {PLATFORMS[thread.platform].name}</div>
        </div>
        <span className={`pill ${SENTIMENT[thread.sentiment]}`}>{thread.sentiment[0]!.toUpperCase() + thread.sentiment.slice(1)}</span>
        <select className="input" style={{ width: "auto" }} aria-label="Assign to" value={thread.assignedTo ?? ""} disabled={pending || !canReply}
          onChange={(e) => run(() => assignAction(workspaceId, thread.id, e.target.value))}>
          <option value="">Unassigned</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button className="btn sm" disabled={pending} onClick={() => run(() => doneAction(workspaceId, thread.id, !thread.done))}>
          <Icon name={thread.done ? "refresh" : "check"} /> {thread.done ? "Reopen" : "Mark done"}
        </button>
        {!thread.unread && (
          <button className="btn sm ghost" disabled={pending} onClick={() => run(() => markReadAction(workspaceId, thread.id, true))}>Mark unread</button>
        )}
      </div>
      <div className="detail-b stack">
        {messages.map((m) => (
          <div key={m.id}>
            <div className={`bubble ${m.fromUs ? "me" : "them"}`} style={{ whiteSpace: "pre-wrap" }}>{m.body}</div>
            <div className="msg-meta" style={m.fromUs ? { textAlign: "right" } : undefined}>{m.who} · {fmt(m.at)}</div>
          </div>
        ))}
        <div ref={end} />
      </div>
      <div className="detail-f">
        {canReply ? (
          <>
            {savedReplies.length > 0 && (
              <div className="row" style={{ gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
                {savedReplies.map((r) => <button key={r} className="chip" onClick={() => setText(r)}>{r}</button>)}
              </div>
            )}
            <form className="row" onSubmit={(e) => { e.preventDefault(); send(); }}>
              <input className="input" value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} placeholder={`Reply as ${replyAs}`} aria-label="Reply" />
              <button className="btn primary" disabled={pending || !text.trim()}><Icon name="send" /> Send</button>
            </form>
          </>
        ) : (
          <p className="muted" style={{ fontSize: 13 }}>{replyBlockedReason}</p>
        )}
        {error && <p className="err" role="alert" style={{ marginTop: 6 }}>{error}</p>}
      </div>
    </div>
  );
}
