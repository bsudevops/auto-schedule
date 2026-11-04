"use client";
import { useRef, useState, useTransition } from "react";
import { addSlot, createQueue, deleteQueue, removeSlot } from "@/app/actions/queues";
import { Icon } from "@/components/Icon";
import { PlatformBadge, PlatformStack } from "@/components/ui";
import type { Platform } from "@/db/schema";
import { PLATFORMS } from "@/lib/platforms";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const fmt = (m: number) => { const h = Math.floor(m / 60), mi = m % 60; return `${h % 12 || 12}:${String(mi).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`; };

type Q = { id: string; name: string; platforms: Platform[]; slots: Array<{ id: string; weekday: number; minuteOfDay: number }> };

export function QueueManager({ workspaceId, canEdit, queues, channels }: { workspaceId: string; canEdit: boolean; queues: Q[]; channels: Array<{ id: string; platform: Platform; handle: string }> }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const run = (fn: () => Promise<{ ok?: string; error?: string }>) => start(async () => { const r = await fn(); setMsg(r.error ?? null); });
  const name = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<string[]>([]);

  return (
    <div className="stack" style={{ gap: 16 }}>
      <p className="muted">A queue is a set of weekly posting times. When you add a post to a queue, it takes the next open time.</p>
      {msg && <p className="err" role="alert">{msg}</p>}
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
