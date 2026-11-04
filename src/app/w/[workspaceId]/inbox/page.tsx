import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/db";
import { channels, inboxMessages, inboxThreads, user, workspaceMembers } from "@/db/schema";
import { EmptyState, PlatformBadge } from "@/components/ui";
import { can } from "@/lib/permissions";
import { PLATFORMS } from "@/lib/platforms";
import { ENGAGE } from "@/lib/publishing/engage";
import { dryRun } from "@/lib/publishing/run";
import { requireWorkspace } from "@/lib/session";
import { ThreadDetail } from "./ThreadDetail";

export const metadata = { title: "Inbox" };

const FILTERS = [
  ["all", "Open"],
  ["unread", "Unread"],
  ["mine", "Assigned to me"],
  ["negative", "Negative"],
  ["done", "Done"],
] as const;
type Filter = (typeof FILTERS)[number][0];
const KIND: Record<string, string> = { comment: "Comment", mention: "Mention", message: "Message", review: "Review" };

function ago(d: Date) {
  const m = Math.round((Date.now() - d.getTime()) / 60_000);
  if (m < 60) return `${Math.max(1, m)}m`;
  if (m < 1440) return `${Math.round(m / 60)}h`;
  return `${Math.round(m / 1440)}d`;
}

export default async function Page({ params, searchParams }: { params: Promise<{ workspaceId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { workspaceId } = await params;
  const sp = await searchParams;
  const { member, workspace } = await requireWorkspace(workspaceId);
  const filter: Filter = (FILTERS.find(([k]) => k === sp.filter)?.[0] ?? "all") as Filter;
  const channelId = sp.channel && /^[0-9a-f-]{36}$/i.test(sp.channel) ? sp.channel : null;
  const q = (sp.q ?? "").trim().slice(0, 100);

  const conds: SQL[] = [eq(inboxThreads.workspaceId, workspaceId)];
  if (filter === "done") conds.push(isNotNull(inboxThreads.doneAt));
  else conds.push(isNull(inboxThreads.doneAt));
  if (filter === "unread") conds.push(eq(inboxThreads.unread, true));
  if (filter === "mine") conds.push(eq(inboxThreads.assignedTo, member.userId));
  if (filter === "negative") conds.push(eq(inboxThreads.sentiment, "negative"));
  if (channelId) conds.push(eq(inboxThreads.channelId, channelId));
  if (q) {
    const pat = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    conds.push(or(ilike(inboxThreads.authorName, pat), ilike(inboxThreads.subject, pat), sql`exists (select 1 from inbox_messages m where m.thread_id = ${inboxThreads.id} and m.body ilike ${pat})`)!);
  }

  const [threads, chans] = await Promise.all([
    db
      .select({ thread: inboxThreads, platform: channels.platform, channelName: channels.displayName })
      .from(inboxThreads)
      .innerJoin(channels, eq(channels.id, inboxThreads.channelId))
      .where(and(...conds))
      .orderBy(desc(inboxThreads.lastMessageAt))
      .limit(100),
    db.select({ id: channels.id, platform: channels.platform, displayName: channels.displayName }).from(channels).where(eq(channels.workspaceId, workspaceId)).orderBy(asc(channels.platform)),
  ]);
  const ids = threads.map((t) => t.thread.id);
  const previews = ids.length
    ? await db
        .selectDistinctOn([inboxMessages.threadId], { threadId: inboxMessages.threadId, body: inboxMessages.body })
        .from(inboxMessages)
        .where(inArray(inboxMessages.threadId, ids))
        .orderBy(inboxMessages.threadId, desc(inboxMessages.createdAt))
    : [];
  const selected = threads.find((t) => t.thread.id === sp.thread) ?? threads[0];

  let detail = null;
  if (selected) {
    const [messages, people] = await Promise.all([
      db
        .select({ m: inboxMessages, senderName: user.name })
        .from(inboxMessages)
        .leftJoin(user, eq(user.id, inboxMessages.sentBy))
        .where(eq(inboxMessages.threadId, selected.thread.id))
        .orderBy(asc(inboxMessages.createdAt)),
      db
        .select({ id: user.id, name: user.name, role: workspaceMembers.role })
        .from(workspaceMembers)
        .innerJoin(user, eq(user.id, workspaceMembers.userId))
        .where(eq(workspaceMembers.workspaceId, workspaceId))
        .orderBy(asc(user.name)),
    ]);
    const platform = selected.platform;
    detail = {
      thread: {
        id: selected.thread.id,
        authorName: selected.thread.authorName,
        subject: selected.thread.subject,
        kind: KIND[selected.thread.kind]!,
        sentiment: selected.thread.sentiment,
        assignedTo: selected.thread.assignedTo,
        unread: selected.thread.unread,
        done: selected.thread.doneAt !== null,
        platform,
        channelName: selected.channelName,
      },
      messages: messages.map(({ m, senderName }) => ({ id: m.id, fromUs: m.fromUs, body: m.body, who: m.fromUs ? senderName ?? workspace.name : m.authorName ?? selected.thread.authorName, at: m.createdAt.toISOString() })),
      people: people.filter((p) => can({ userId: p.id, role: p.role, active: true }, "reply_inbox")).map((p) => ({ id: p.id, name: p.name })),
      canReply: can(member, "reply_inbox") && (dryRun() || Boolean(ENGAGE[platform]?.reply)),
      replyBlockedReason: !can(member, "reply_inbox") ? "Your role can read the inbox but not reply." : `${PLATFORMS[platform].name} doesn't allow replies through its API.`,
      savedReplies: workspace.savedReplies,
    };
  }

  const href = (o: Record<string, string | null | undefined>) => {
    const p = new URLSearchParams();
    const merged = { filter: filter === "all" ? null : filter, channel: channelId, q: q || null, ...o };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return `/w/${workspaceId}/inbox${s ? `?${s}` : ""}`;
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Inbox</h1>
          <p>Comments on your posts from every channel. New ones arrive every 10 minutes.</p>
        </div>
        <nav className="seg" aria-label="Filter conversations">
          {FILTERS.map(([k, n]) => (
            <Link key={k} href={href({ filter: k === "all" ? null : k, thread: null })} className={filter === k ? "on" : ""} aria-current={filter === k ? "page" : undefined}>{n}</Link>
          ))}
        </nav>
      </div>

      <div className="row" style={{ flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
        <form action={`/w/${workspaceId}/inbox`} className="row" style={{ gap: 8 }}>
          {filter !== "all" && <input type="hidden" name="filter" value={filter} />}
          {channelId && <input type="hidden" name="channel" value={channelId} />}
          <input className="input" name="q" defaultValue={q} placeholder="Search people and messages" aria-label="Search the inbox" style={{ width: 240 }} />
        </form>
        <Link className={`chip${!channelId ? " on" : ""}`} href={href({ channel: null, thread: null })}>All channels</Link>
        {chans.map((c) => (
          <Link key={c.id} className={`chip${channelId === c.id ? " on" : ""}`} href={href({ channel: c.id, thread: null })}>
            <PlatformBadge platform={c.platform} /> {c.displayName}
          </Link>
        ))}
      </div>

      <div className="split">
        <div className="list">
          {threads.length === 0 && <div className="empty">{q ? "No conversations match that search." : filter === "done" ? "Nothing marked done yet." : "Nothing here. You're all caught up."}</div>}
          {threads.map(({ thread: t, platform }) => (
            <Link key={t.id} href={href({ thread: t.id })} className={`item${selected?.thread.id === t.id ? " on" : ""}`} style={{ color: "inherit", textDecoration: "none" }} data-thread={t.authorName}>
              {t.unread ? <span className="unread" aria-label="Unread" /> : <span style={{ width: 8, flex: "none" }} />}
              <PlatformBadge platform={platform} large />
              <div className="grow">
                <div className="t">
                  <span>{t.authorName}</span>
                  <span className="muted" style={{ fontWeight: 400, fontSize: 11.5, flex: "none" }}>{ago(t.lastMessageAt)}</span>
                </div>
                <div className="muted" style={{ fontSize: 11.5 }}>{KIND[t.kind]} · {t.subject || PLATFORMS[platform].name}</div>
                <div className="x">{previews.find((p) => p.threadId === t.id)?.body ?? ""}</div>
              </div>
            </Link>
          ))}
        </div>
        {detail ? (
          <ThreadDetail key={detail.thread.id} workspaceId={workspaceId} replyAs={workspace.name} {...detail} />
        ) : (
          <div className="detail"><EmptyState title="No conversation selected" body="Comments on your published posts appear here once your channels are connected." /></div>
        )}
      </div>
    </>
  );
}
