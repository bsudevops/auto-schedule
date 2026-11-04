"use client";
import { useRef, useState, useTransition } from "react";
import { addSlot, createQueue, deleteQueue, removeSlot, shuffleQueue } from "@/app/actions/queues";
import { Icon } from "@/components/Icon";
import { PlatformBadge, PlatformStack } from "@/components/ui";
import type { Platform } from "@/db/schema";
import { PLATFORMS } from "@/lib/platforms";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const fmt = (m: number) => { const h = Math.floor(m / 60), mi = m % 60; return `${h % 12 || 12}:${String(mi).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`; };

type Q = { id: string; name: string; platforms: Platform[]; upcoming: number; slots: Array<{ id: string; weekday: number; minuteOfDay: number }> };
type Best = { weekday: number; hour: number; label: string; lift: number | null };

export function QueueManager({ workspaceId, canEdit, queues, channels, bestTimes }: { workspaceId: string; canEdit: boolean; queues: Q[]; channels: Array<{ id: string; platform: Platform; handle: string }>; bestTimes: Best[] }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const run = (fn: () => Promise<{ ok?: string; error?: string }>, announce = false) => start(async () => { const r = await fn(); setMsg(r.error ?? null); setOkMsg(announce && r.ok ? r.ok : null); });
  const name = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<string[]>([]);

  return (
    <div className="stack" style={{ gap: 16 }}>
      <p className="muted">A queue is a set of weekly posting times. When you add a post to a queue, it takes the next open time.</p>
      {msg && <p className="err" role="alert">{msg}</p>}
      {okMsg && <p className="banner" role="status">{okMsg}</p>}
      <div className="grid g-3">
        {queues.map((q) => (
          <section key={q.id} className="card">
            <div className="card-h"><h3>{q.name}</h3><PlatformStack platforms={q.platforms} /></div>
            <div className="card-b stack">
              <div className="label">Weekly times</div>
              <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
                {q.slots.length ? q.slots.map((s) => (
                  <span key={s.id} className="chip mono" style={{ fontSize: 12 }}>
                    {DAYS[s.weekday]} {fmt(s.minuteOfDay)}
                    {canEdit && <button type="button" aria-label="Remove time" disabled={pending} onClick={() => run(() => removeSlot(workspaceId, q.id, s.id))} style={{ border: 0, background: "none", color: "var(--muted)", padding: 0 }}>×</button>}
                  </span>
                )) : <span className="muted" style={{ fontSize: 13 }}>No times yet.</span>}
              </div>
              {canEdit && <AddSlot disabled={pending} onAdd={(wd, t) => run(() => addSlot(workspaceId, q.id, wd, t))} />}
              {canEdit && bestTimes.some((b) => !q.slots.some((s) => s.weekday === b.weekday && s.minuteOfDay === b.hour * 60)) && (
                <div className="stack" style={{ gap: 6 }}>
                  <div className="label">Your best times</div>
                  <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
                    {bestTimes.filter((b) => !q.slots.some((s) => s.weekday === b.weekday && s.minuteOfDay === b.hour * 60)).map((b) => (
                      <button type="button" key={`${b.weekday}-${b.hour}`} className="chip" disabled={pending} title={b.lift !== null ? `Posts at this time get ${Math.round(b.lift * 100)}% more engagement than your average` : undefined}
                        onClick={() => run(() => addSlot(workspaceId, q.id, b.weekday, `${String(b.hour).padStart(2, "0")}:00`))}>
                        <Icon name="plus" size={12} /> {b.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <span className="muted" style={{ fontSize: 12.5 }}>{q.upcoming} upcoming post{q.upcoming === 1 ? "" : "s"}</span>
                {canEdit && q.upcoming > 1 && (
                  <button type="button" className="btn sm" disabled={pending} onClick={() => run(() => shuffleQueue(workspaceId, q.id), true)} title="Keep the same times, in a new random order">
                    <Icon name="refresh" /> Shuffle order
                  </button>
                )}
              </div>
              {canEdit && <button type="button" className="btn sm ghost danger" style={{ width: "max-content" }} disabled={pending} onClick={() => run(() => deleteQueue(workspaceId, q.id))}><Icon name="trash" /> Delete queue</button>}
            </div>
          </section>
        ))}
        {canEdit && (
          <form className="card card-b stack" onSubmit={(e) => { e.preventDefault(); run(async () => { const r = await createQueue(workspaceId, name.current?.value ?? "", picked); if (r.ok && name.current) { name.current.value = ""; setPicked([]); } return r; }); }}>
            <h3>New queue</h3>
            <label className="field"><span>Name</span><input ref={name} className="input" id="queue-name" placeholder="e.g. Weekday mornings" maxLength={60} required /></label>
            <div className="label">Channels</div>
            <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
              {channels.map((c) => (
                <button type="button" key={c.id} className={`chip${picked.includes(c.id) ? " on" : ""}`} aria-pressed={picked.includes(c.id)} onClick={() => setPicked((p) => (p.includes(c.id) ? p.filter((x) => x !== c.id) : [...p, c.id]))}>
                  <PlatformBadge platform={c.platform} /> {PLATFORMS[c.platform].name}
                </button>
              ))}
            </div>
            <button className="btn primary" disabled={pending} style={{ width: "max-content" }}><Icon name="plus" /> Create queue</button>
          </form>
        )}
      </div>
    </div>
  );
}

function AddSlot({ onAdd, disabled }: { onAdd: (weekday: number, time: string) => void; disabled: boolean }) {
  const [wd, setWd] = useState(1);
  const [t, setT] = useState("09:00");
  return (
    <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
      <select className="input" aria-label="Day" value={wd} onChange={(e) => setWd(Number(e.target.value))} style={{ width: "auto", padding: "6px 8px" }}>{DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select>
      <input type="time" className="input" aria-label="Time" value={t} onChange={(e) => setT(e.target.value)} style={{ width: "auto", padding: "6px 8px" }} />
      <button type="button" className="btn sm" disabled={disabled} onClick={() => onAdd(wd, t)}>Add time</button>
    </div>
  );
}
