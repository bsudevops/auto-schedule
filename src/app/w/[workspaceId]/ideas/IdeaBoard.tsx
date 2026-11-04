"use client";
import Link from "next/link";
import { useOptimistic, useState, useTransition } from "react";
import { createIdea, deleteIdea, moveIdea } from "@/app/actions/ideas";
import { Icon } from "@/components/Icon";
import { Avatar } from "@/components/ui";

type Idea = { id: string; title: string; column: string; tags: string[]; author: string; mine: boolean };
const COLS = [["idea", "Ideas", "#6A80A0"], ["research", "Researching", "#C77A00"], ["writing", "Writing", "#2B86F5"], ["ready", "Ready to schedule", "#0F9D6B"]] as const;

export function IdeaBoard({ workspaceId, ideas, canCreate, canEditAll }: { workspaceId: string; ideas: Idea[]; canCreate: boolean; canEditAll: boolean }) {
  const [items, setOptimistic] = useOptimistic(ideas, (cur, m: { id: string; column: string } | { id: string; remove: true }) =>
    "remove" in m ? cur.filter((i) => i.id !== m.id) : cur.map((i) => (i.id === m.id ? { ...i, column: m.column } : i)));
  const [, start] = useTransition();
  const [over, setOver] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const movable = (i: Idea) => canCreate && (i.mine || canEditAll);
  function move(id: string, column: string) {
    const idea = items.find((i) => i.id === id);
    if (!idea || idea.column === column || !movable(idea)) return;
    start(async () => { setOptimistic({ id, column }); const r = await moveIdea(workspaceId, id, column); setError(r.error ?? null); });
  }

  return (
    <>
      {error && <p className="err" role="alert" style={{ marginBottom: 10 }}>{error}</p>}
      <div className="board">
        {COLS.map(([key, label, color]) => {
          const list = items.filter((i) => i.column === key);
          return (
            <section key={key} className={`col${over === key ? " drag" : ""}`} aria-label={label}
              onDragOver={(e) => { e.preventDefault(); setOver(key); }} onDragLeave={() => setOver(null)}
              onDrop={(e) => { e.preventDefault(); setOver(null); move(e.dataTransfer.getData("text/idea"), key); }}>
              <div className="col-h"><span style={{ width: 8, height: 8, borderRadius: "50%", background: color }} /><h3>{label}</h3><span className="n">{list.length}</span></div>
              {list.map((i) => (
                <article key={i.id} className="idea" draggable={movable(i)} onDragStart={(e) => e.dataTransfer.setData("text/idea", i.id)} style={{ cursor: movable(i) ? "grab" : "default" }}>
                  <b style={{ fontSize: 13.5 }}>{i.title}</b>
                  {i.tags.length > 0 && <div className="row" style={{ flexWrap: "wrap", gap: 5 }}>{i.tags.map((t) => <span key={t} className="tag" style={{ background: "var(--sky-50)", color: "var(--sky-deep)" }}>{t}</span>)}</div>}
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <Avatar name={i.author} small />
                    <div className="row" style={{ gap: 4 }}>
                      {movable(i) && (
                        <select aria-label="Move to" className="input" value={i.column} onChange={(e) => move(i.id, e.target.value)} style={{ width: "auto", padding: "3px 6px", fontSize: 12 }}>
                          {COLS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                        </select>
                      )}
                      {key === "ready" && canCreate && <Link className="btn sm" href={`/w/${workspaceId}/compose?idea=${i.id}`}>Create post</Link>}
                      {movable(i) && <button type="button" className="icon-btn" style={{ width: 28, height: 28, border: 0 }} aria-label="Delete idea"
                        onClick={() => start(async () => { setOptimistic({ id: i.id, remove: true }); await deleteIdea(workspaceId, i.id); })}><Icon name="trash" size={14} /></button>}
                    </div>
                  </div>
                </article>
              ))}
              {canCreate && (adding === key ? (
                <form className="idea" onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  start(async () => { const r = await createIdea(workspaceId, { title: String(f.get("title")), tags: String(f.get("tags") ?? ""), column: key }); setError(r.error ?? null); if (r.ok) setAdding(null); });
                }}>
                  <input className="input" name="title" id={`idea-title-${key}`} placeholder="Write the idea" autoFocus required maxLength={200} />
                  <input className="input" name="tags" id={`idea-tags-${key}`} placeholder="Tags, comma-separated" />
                  <div className="row" style={{ gap: 6 }}><button className="btn sm primary">Add</button><button type="button" className="btn sm ghost" onClick={() => setAdding(null)}>Cancel</button></div>
                </form>
              ) : (
                <button type="button" className="btn ghost sm" style={{ justifyContent: "center", color: "var(--muted)" }} onClick={() => setAdding(key)}><Icon name="plus" /> Add</button>
              ))}
            </section>
          );
        })}
      </div>
    </>
  );
}
