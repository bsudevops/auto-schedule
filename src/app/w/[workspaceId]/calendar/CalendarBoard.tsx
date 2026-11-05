"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useOptimistic, useState, useTransition } from "react";
import { reschedulePostAction } from "@/app/actions/posts";
import { Icon } from "@/components/Icon";
import { PlatformBadge } from "@/components/ui";
import type { Platform } from "@/db/schema";

export type CalPost = { id: string; title: string; status: string; date: string | null; time: string | null; hour: number | null; platforms: Platform[]; movable: boolean; /** Why it is gone from a platform, when it is. */ removed?: string | null };

const EV_CLASS: Record<string, string> = { published: "published", draft: "draft", failed: "failed", partially_failed: "failed" };
const HOURS = Array.from({ length: 17 }, (_, i) => i + 6);
const fmtHour = (h: number) => `${h > 12 ? h - 12 : h}${h >= 12 ? "pm" : "am"}`;
const fmtTime = (t: string) => { const [h, m] = t.split(":").map(Number); return `${h! % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""}${h! >= 12 ? "pm" : "am"}`; };

export function CalendarBoard({ workspaceId, view, days, today, month, posts, openSlots, canCreate }: {
  workspaceId: string; view: "month" | "week"; days: string[]; today: string; month: string; posts: CalPost[]; openSlots: Record<string, string>; canCreate: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [, start] = useTransition();
  const [items, move] = useOptimistic(posts, (cur, m: { id: string; date: string; time: string }) =>
    cur.map((p) => (p.id === m.id ? { ...p, date: m.date, time: m.time, hour: Number(m.time.slice(0, 2)) } : p)));

  function drop(id: string, date: string, hour?: number) {
    const p = items.find((x) => x.id === id);
    if (!p || !p.movable) return;
    const time = hour != null ? `${String(hour).padStart(2, "0")}:00` : p.time ?? "09:00";
    if (p.date === date && p.time === time) return;
    setError(null);
    start(async () => {
      move({ id, date, time });
      const r = await reschedulePostAction(workspaceId, id, date, time);
      if (!r.ok) setError(r.error ?? "Couldn't move the post.");
      router.refresh();
    });
  }

  const zone = (key: string, date: string, hour?: number) => ({
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); setOver(key); },
    onDragLeave: () => setOver((o) => (o === key ? null : o)),
    onDrop: (e: React.DragEvent) => { e.preventDefault(); setOver(null); drop(e.dataTransfer.getData("text/post"), date, hour); },
  });

  const chip = (p: CalPost) => (
    <Link key={p.id} href={`/w/${workspaceId}/posts/${p.id}`} className={`ev ${EV_CLASS[p.status] ?? ""}${p.removed ? " removed" : ""}`} draggable={p.movable}
      onDragStart={(e) => e.dataTransfer.setData("text/post", p.id)} title={p.removed ? `${p.title}: ${p.removed}` : p.title} style={{ textDecoration: "none", color: "inherit", cursor: p.movable ? "grab" : "pointer" }}>
      {p.platforms[0] && <PlatformBadge platform={p.platforms[0]} size="xs" />}
      {p.time && <span className="tm">{fmtTime(p.time)}</span>}
      <span className="tt">{p.title}</span>
    </Link>
  );

  return (
    <>
      {error && <p className="err" role="alert" style={{ marginBottom: 10 }}>{error}</p>}
      {view === "month" ? (
        <div className="card" style={{ overflow: "hidden" }}>
          <div className="cal">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => <div key={d} className="dow">{d}</div>)}
            {days.map((d) => {
              const ps = items.filter((p) => p.date === d).sort((a, b) => (a.time ?? "").localeCompare(b.time ?? ""));
              const slot = openSlots[d];
              return (
                <div key={d} className={`day${d.slice(0, 7) !== month ? " out" : ""}${d === today ? " today" : ""}${over === d ? " drag" : ""}`} {...zone(d, d)}>
                  <div className="day-h">
                    <span className="dn">{Number(d.slice(8))}</span>
                    {canCreate && d >= today && <Link className="day-add" href={`/w/${workspaceId}/compose?date=${d}`} aria-label={`Create a post on ${d}`} title="Create a post on this day"><Icon name="plus" size={14} /></Link>}
                  </div>
                  {ps.slice(0, 3).map(chip)}
                  {ps.length > 3 && <Link href={`?view=week&d=${d}`} className="muted" style={{ fontSize: 11, paddingLeft: 4 }}>+{ps.length - 3} more</Link>}
                  {slot && ps.length < 3 && canCreate && (
                    <Link className="ev slot" href={`/w/${workspaceId}/compose?date=${d}`} style={{ textDecoration: "none" }}><span className="tm">{fmtTime(slot)}</span><span className="tt">Open slot</span></Link>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="tbl-wrap">
          <div className="week" style={{ minWidth: 720 }}>
            <div />
            {days.map((d) => (
              <div key={d} className={`wh${d === today ? " today" : ""}`}>
                {new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(new Date(d + "T00:00:00Z"))}
                <b className="num">{Number(d.slice(8))}</b>
              </div>
            ))}
            {HOURS.map((h) => [
              <div key={`h${h}`} className="hr">{fmtHour(h)}</div>,
              ...days.map((d) => {
                const key = `${d}-${h}`;
                return (
                  <div key={key} className={`cell${over === key ? " drag" : ""}`} {...zone(key, d, h)}>
                    {items.filter((p) => p.date === d && p.hour === h).map(chip)}
                    {canCreate && d >= today && <Link className="day-add" href={`/w/${workspaceId}/compose?date=${d}&time=${String(h).padStart(2, "0")}:00`} aria-label={`Create a post on ${d} at ${fmtHour(h)}`} title="Create a post at this time"><Icon name="plus" size={14} /></Link>}
                  </div>
                );
              }),
            ])}
          </div>
        </div>
      )}
    </>
  );
}
