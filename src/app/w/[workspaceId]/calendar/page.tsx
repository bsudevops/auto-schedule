import Link from "next/link";
import { and, asc, count, eq, gt, gte, inArray, isNull, lt, or } from "drizzle-orm";
import { Icon } from "@/components/Icon";
import { EmptyState, PlatformStack, StatusPill } from "@/components/ui";
import { db } from "@/db";
import { channels, postTargets, posts, queueChannels, queueSlots, queues, type Platform } from "@/db/schema";
import { addDays, addMonths, localParts, monthGrid, parseLocal, startOfWeek, type LocalDate } from "@/lib/calendar";
import { describeSlot } from "@/lib/best-times";
import { loadBestTimes } from "@/lib/best-times-load";
import { can } from "@/lib/permissions";
import { zonedToUtc } from "@/lib/queue-slots";
import { requireWorkspace } from "@/lib/session";
import { CalendarBoard, type CalPost } from "./CalendarBoard";
import { QueueManager } from "./QueueManager";

export const metadata = { title: "Calendar" };
const VIEWS = ["month", "week", "list", "queues"] as const;
type View = (typeof VIEWS)[number];

export default async function Page({ params, searchParams }: { params: Promise<{ workspaceId: string }>; searchParams: Promise<{ view?: string; d?: string; saved?: string }> }) {
  const { workspaceId } = await params;
  const sp = await searchParams;
  const { member, workspace } = await requireWorkspace(workspaceId);
  const tz = workspace.timezone;
  const view: View = (VIEWS as readonly string[]).includes(sp.view ?? "") ? (sp.view as View) : "month";
  const today = localParts(new Date(), tz).date;
  const anchor: LocalDate = sp.d && /^\d{4}-\d{2}-\d{2}$/.test(sp.d) ? sp.d : today;
  const base = `/w/${workspaceId}/calendar`;
  const href = (o: { view?: View; d?: string }) => `${base}?view=${o.view ?? view}${o.d ? `&d=${o.d}` : sp.d ? `&d=${anchor}` : ""}`;

  const days = view === "week" ? Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(anchor), i)) : view === "month" ? monthGrid(anchor) : [];
  const listStart = view === "list" ? anchor.slice(0, 8) + "01" : days[0] ?? anchor;
  const listEnd = view === "list" ? addMonths(anchor, 1) : addDays(days[days.length - 1] ?? anchor, 1);
  const toUtc = (d: LocalDate) => { const p = parseLocal(d); return zonedToUtc(p.y, p.m, p.d, 0, 0, tz); };

  const rows = view === "queues" ? [] : await db.select({ id: posts.id, caption: posts.caption, status: posts.status, at: posts.scheduledAt, authorId: posts.authorId })
    .from(posts)
    .where(and(eq(posts.workspaceId, workspaceId), or(and(gte(posts.scheduledAt, toUtc(listStart)), lt(posts.scheduledAt, toUtc(listEnd))), view === "list" ? and(isNull(posts.scheduledAt), eq(posts.status, "draft")) : undefined)))
    .orderBy(asc(posts.scheduledAt));
  const targets = rows.length ? await db.select({ postId: postTargets.postId, platform: channels.platform }).from(postTargets).innerJoin(channels, eq(channels.id, postTargets.channelId)).where(inArray(postTargets.postId, rows.map((r) => r.id))) : [];
  const calPosts: CalPost[] = rows.map((r) => {
    const lp = r.at ? localParts(r.at, tz) : null;
    return {
      id: r.id, title: (r.caption.split("\n")[0] || "Untitled post").slice(0, 80), status: r.status,
      date: lp?.date ?? null, time: lp?.time ?? null, hour: lp?.hour ?? null,
      platforms: [...new Set(targets.filter((t) => t.postId === r.id).map((t) => t.platform))] as Platform[],
      movable: r.status !== "published" && r.status !== "publishing" && can(member, r.authorId === member.userId ? "create_posts" : "edit_others_posts") && (r.status !== "scheduled" || can(member, "publish")),
    };
  });

  const qs = await db.select().from(queues).where(eq(queues.workspaceId, workspaceId)).orderBy(asc(queues.name));
  const slots = qs.length ? await db.select().from(queueSlots).where(inArray(queueSlots.queueId, qs.map((q) => q.id))) : [];
  const openSlots: Record<LocalDate, string> = {};
  for (const d of days) {
    if (d < today) continue;
    const wd = new Date(d + "T00:00:00Z").getUTCDay();
    const s = slots.filter((x) => x.weekday === wd).sort((a, b) => a.minuteOfDay - b.minuteOfDay)[0];
    if (s) openSlots[d] = `${String(Math.floor(s.minuteOfDay / 60)).padStart(2, "0")}:${String(s.minuteOfDay % 60).padStart(2, "0")}`;
  }

  const title = view === "week"
    ? `Week of ${new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(startOfWeek(anchor) + "T00:00:00Z"))}`
    : new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(anchor + "T00:00:00Z"));
  const step = (n: number) => (view === "week" ? addDays(anchor, 7 * n) : addMonths(anchor, n));
  const savedMsg = sp.saved === "draft" ? "Draft saved." : sp.saved === "scheduled" ? "Post scheduled." : null;

  return (
    <>
      <div className="page-head">
        <div><h1>Calendar</h1><p>Drag a post to another day to reschedule it. Dashed slots are open queue times. Times are in {tz.replace(/_/g, " ")}.</p></div>
        <div className="row" style={{ flexWrap: "wrap" }}>
          <nav className="seg" aria-label="Calendar view">{VIEWS.map((v) => <Link key={v} className={view === v ? "on" : ""} aria-current={view === v ? "page" : undefined} href={href({ view: v })}>{v[0]!.toUpperCase() + v.slice(1)}</Link>)}</nav>
          {can(member, "create_posts") && <Link className="btn primary" href={`/w/${workspaceId}/compose`}><Icon name="plus" /> New post</Link>}
        </div>
      </div>
      {savedMsg && <p className="banner" role="status" style={{ marginBottom: 14 }}><Icon name="check" /> {savedMsg}</p>}

      {view === "queues" ? (
        <QueueManager workspaceId={workspaceId} canEdit={can(member, "publish")}
          bestTimes={(await loadBestTimes(workspace)).times.map((b) => ({ weekday: b.weekday, hour: b.hour, lift: b.lift, label: describeSlot(b) }))}
          channels={(await db.select({ id: channels.id, platform: channels.platform, handle: channels.handle }).from(channels).where(eq(channels.workspaceId, workspaceId)))}
          queues={await Promise.all(qs.map(async (q) => ({
            id: q.id, name: q.name,
            upcoming: (await db.select({ n: count() }).from(posts).where(and(eq(posts.queueId, q.id), eq(posts.status, "scheduled"), gt(posts.scheduledAt, new Date()))))[0]?.n ?? 0,
            slots: slots.filter((s) => s.queueId === q.id).sort((a, b) => a.weekday - b.weekday || a.minuteOfDay - b.minuteOfDay).map((s) => ({ id: s.id, weekday: s.weekday, minuteOfDay: s.minuteOfDay })),
            platforms: (await db.select({ p: channels.platform }).from(queueChannels).innerJoin(channels, eq(channels.id, queueChannels.channelId)).where(eq(queueChannels.queueId, q.id))).map((x) => x.p),
          })))} />
      ) : (
        <>
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap" }}>
            <div className="row">
              <Link className="icon-btn" href={href({ d: step(-1) })} aria-label="Previous"><Icon name="left" /></Link>
              <Link className="icon-btn" href={href({ d: step(1) })} aria-label="Next"><Icon name="right" /></Link>
              <h2 style={{ marginLeft: 6 }}>{title}</h2>
              <Link className="btn sm" href={`${base}?view=${view}`}>Today</Link>
            </div>
            <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>{["scheduled", "published", "draft", "failed"].map((s) => <StatusPill key={s} status={s} />)}</div>
          </div>
          {view === "list" ? (
            calPosts.length ? (
              <div className="card tbl-wrap">
                <table className="tbl">
                  <thead><tr><th>When</th><th>Post</th><th>Channels</th><th>Status</th></tr></thead>
                  <tbody>{calPosts.map((p) => (
                    <tr key={p.id}>
                      <td className="num" style={{ whiteSpace: "nowrap" }}>{p.date ? <>{new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(p.date + "T00:00:00Z"))}<div className="muted" style={{ fontSize: 12 }}>{p.time}</div></> : <span className="muted">No date</span>}</td>
                      <td><Link href={`/w/${workspaceId}/posts/${p.id}`} style={{ color: "inherit", fontWeight: 600 }}>{p.title}</Link></td>
                      <td><PlatformStack platforms={p.platforms} /></td>
                      <td><StatusPill status={p.status} /></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            ) : <div className="card"><EmptyState title="No posts this month" body="Schedule a post or save a draft and it appears here." /></div>
          ) : (
            <CalendarBoard workspaceId={workspaceId} view={view} days={days} today={today} month={anchor.slice(0, 7)} posts={calPosts} openSlots={openSlots} canCreate={can(member, "create_posts")} />
          )}
        </>
      )}
    </>
  );
}
