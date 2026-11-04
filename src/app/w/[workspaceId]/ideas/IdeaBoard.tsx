"use client";
import Link from "next/link";
import { useOptimistic, useState, useTransition } from "react";
import { createIdea, deleteIdea, moveIdea } from "@/app/actions/ideas";
import { Icon } from "@/components/Icon";
import { Avatar } from "@/components/ui";

type Idea = { id: string; title: string; column: string; tags: string[]; author: string; mine: boolean };
const COLS = [["idea", "Ideas"], ["research", "Researching"], ["writing", "Writing"], ["ready", "Ready to schedule"]] as const;

export function IdeaBoard({ workspaceId, ideas, canCreate, canEditAll }: { workspaceId: string; ideas: Idea[]; canCreate: boolean; canEditAll: boolean }) {
  const [items, setOptimistic] = useOptimistic(ideas, (cur, m: { id: string; column: string } | { id: string; remove: true }) =>
    "remove" in m ? cur.filter((i) => i.id !== m.id) : cur.map((i) => (i.id === m.id ? { ...i, column: m.column } : i)));
  const [, start] = useTransition();
  const [over, setOver] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
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
        {COLS.map(([key, label], stage) => {
          const list = items.filter((i) => i.column === key);
          return (
            <section key={key} className={`col${over === key ? " drag" : ""}`} data-stage={key} aria-label={label}
              onDragOver={(e) => { e.preventDefault(); setOver(key); }} onDragLeave={() => setOver(null)}
              onDrop={(e) => { e.preventDefault(); setOver(null); move(e.dataTransfer.getData("text/idea"), key); }}>
              <header className="col-h">
                <span className="col-step">{stage + 1}</span>
                <h2>{label}</h2>
                <span className="n">{list.length}</span>
                {canCreate && (
                  <button type="button" className="col-add" aria-label={`Add an idea to ${label}`} aria-expanded={adding === key} onClick={() => setAdding(adding === key ? null : key)}>
                    <Icon name="plus" size={15} /><span>Add</span>
                  </button>
                )}
              </header>

              <div className="col-body">
                {canCreate && adding === key && (
                  <form className="idea idea-new" onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    start(async () => { const r = await createIdea(workspaceId, { title: String(f.get("title")), tags: String(f.get("tags") ?? ""), column: key }); setError(r.error ?? null); if (r.ok) setAdding(null); });
                  }}>
                    <input className="input" name="title" id={`idea-title-${key}`} aria-label="Idea" placeholder="Write the idea" autoFocus required maxLength={200} />
                    <input className="input" name="tags" id={`idea-tags-${key}`} aria-label="Tags" placeholder="Tags, comma-separated" />
                    <div className="row" style={{ gap: 6 }}><button className="btn sm primary">Add</button><button type="button" className="btn sm ghost" onClick={() => setAdding(null)}>Cancel</button></div>
                  </form>
                )}

                {list.map((i) => (
                  <article key={i.id} className={`idea${dragging === i.id ? " dragging" : ""}${movable(i) ? " movable" : ""}`} draggable={movable(i)}
                    onDragStart={(e) => { e.dataTransfer.setData("text/idea", i.id); setDragging(i.id); }} onDragEnd={() => setDragging(null)}>
                    <div className="idea-top">
                      <h3 className="idea-title">{i.title}</h3>
                      {movable(i) && (
                        <button type="button" className="idea-del" aria-label="Delete idea"
                          onClick={() => start(async () => { setOptimistic({ id: i.id, remove: true }); await deleteIdea(workspaceId, i.id); })}><Icon name="trash" size={15} /></button>
                      )}
                    </div>
                    {i.tags.length > 0 && <ul className="idea-tags" aria-label="Tags">{i.tags.map((t) => <li key={t} className="tag">{t}</li>)}</ul>}
                    <footer className="idea-foot">
                      <span className="idea-author"><Avatar name={i.author} small /><span className="sr-only">Added by {i.author}</span></span>
                      {movable(i) && (
                        <select aria-label="Move to" className="idea-move" value={i.column} onChange={(e) => move(i.id, e.target.value)}>
                          {COLS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                        </select>
                      )}
                    </footer>
                    {key === "ready" && canCreate && <Link className="btn sm primary idea-cta" href={`/w/${workspaceId}/compose?idea=${i.id}`}>Create post</Link>}
                  </article>
                ))}

                {list.length === 0 && adding !== key && (
                  <p className="col-empty">{canCreate ? "Nothing here yet. Use Add above or drag an idea in." : "Nothing here yet."}</p>
                )}
              </div>

            </section>
          );
        })}
      </div>
    </>
  );
}
