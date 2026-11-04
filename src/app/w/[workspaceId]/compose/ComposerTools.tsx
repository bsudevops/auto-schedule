"use client";
import { useRef, useState, useTransition } from "react";
import { aiWriteAction, deleteHashtagSetAction, importStockAction, saveHashtagSetAction, searchStockAction } from "@/app/actions/composer";
import { Icon } from "@/components/Icon";
import { tagsIn } from "@/lib/hashtags";
import type { StockPhoto } from "@/lib/stock";

export type HashtagSet = { id: string; name: string; tags: string[] };
type Media = { id: string; kind: "image" | "video"; filename: string; thumb: string; url: string };

const TASKS = [
  { id: "draft", label: "Write a draft", hint: "Uses your text as the topic" },
  { id: "improve", label: "Improve" },
  { id: "shorter", label: "Make shorter" },
  { id: "variants", label: "3 versions" },
  { id: "hashtags", label: "Suggest hashtags" },
] as const;

/** Writing help: suggestions the person reads and chooses; nothing changes until they pick one. */
export function AiPanel({ workspaceId, text, channelIds, onUse, onClose }: {
  workspaceId: string; text: string; channelIds: string[]; onUse: (value: string, how: "replace" | "tags") => void; onClose: () => void;
}) {
  const [task, setTask] = useState<(typeof TASKS)[number]["id"] | null>(null);
  const [results, setResults] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function run(t: (typeof TASKS)[number]["id"]) {
    setTask(t);
    setError(null);
    setResults([]);
    start(async () => {
      const r = await aiWriteAction(workspaceId, { task: t, text, channelIds });
      if ("error" in r) setError(r.error);
      else setResults(r.suggestions);
    });
  }

  return (
    <div className="ai-panel" role="region" aria-label="Writing help">
      <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
        <b className="row" style={{ gap: 6, fontSize: 13 }}><Icon name="spark" size={15} /> Writing help</b>
        <button type="button" className="icon-btn" aria-label="Close writing help" onClick={onClose}><Icon name="x" size={15} /></button>
      </div>
      <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
        {TASKS.map((t) => (
          <button type="button" key={t.id} className={`btn sm${task === t.id ? " primary" : ""}`} disabled={pending || !text.trim()} title={"hint" in t ? t.hint : undefined} onClick={() => run(t.id)}>{t.label}</button>
        ))}
      </div>
      {!text.trim() && <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>Write a few words about the post first. For a draft, the topic is enough.</p>}
      {pending && <p className="muted" role="status" style={{ fontSize: 12.5, margin: 0 }}>Writing…</p>}
      {error && <p className="err" role="alert" style={{ margin: 0 }}>{error}</p>}
      {results.length > 0 && (
        <ol className="ai-results">
          {results.map((r) => (
            <li key={r}>
              <p>{r}</p>
              <button type="button" className="btn sm" onClick={() => onUse(r, task === "hashtags" ? "tags" : "replace")}>
                {task === "hashtags" ? "Add to caption" : "Use this"}
              </button>
            </li>
          ))}
        </ol>
      )}
      <p className="muted" style={{ fontSize: 11.5, margin: 0 }}>Suggestions come from Claude. Check facts before you post.</p>
    </div>
  );
}

/** The # menu: insert a saved set, or save the caption's hashtags as a new one. */
export function HashtagMenu({ workspaceId, sets: initial, caption, onInsert, onHash }: {
  workspaceId: string; sets: HashtagSet[]; caption: string; onInsert: (tags: string[]) => void; onHash: () => void;
}) {
  const [sets, setSets] = useState(initial);
  const [name, setName] = useState("");
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  const [pending, start] = useTransition();
  const found = tagsIn(caption);
  const ref = useRef<HTMLDetailsElement>(null);
  const close = () => ref.current?.removeAttribute("open");

  return (
    <details ref={ref} className="tag-menu" style={{ position: "relative" }}>
      <summary className="icon-btn" title="Hashtags" aria-label="Hashtags" style={{ listStyle: "none" }}><Icon name="hash" /></summary>
      <div className="menu" style={{ width: 300, padding: 8 }}>
        <button type="button" className="mi" onClick={() => { close(); onHash(); }}>Insert a # here</button>
        <div className="label" style={{ margin: "8px 6px 4px" }}>Saved sets</div>
        {sets.length === 0 && <p className="muted" style={{ fontSize: 12.5, margin: "0 6px 6px" }}>No sets yet. Save the hashtags you use often below.</p>}
        {sets.map((s) => (
          <div key={s.id} className="tag-set">
            <button type="button" className="mi" onClick={() => { close(); onInsert(s.tags); }} title={s.tags.join(" ")}>
              <span><b>{s.name}</b><small>{s.tags.join(" ")}</small></span>
            </button>
            <button type="button" className="icon-btn" aria-label={`Delete ${s.name}`} disabled={pending}
              onClick={() => start(async () => { const r = await deleteHashtagSetAction(workspaceId, s.id); setSets(r.sets); })}>
              <Icon name="trash" size={14} />
            </button>
          </div>
        ))}
        <form className="tag-save" onSubmit={(e) => {
          e.preventDefault();
          setMsg(null);
          start(async () => {
            const r = await saveHashtagSetAction(workspaceId, { name, tags: found.join(" ") });
            if ("error" in r) setMsg({ error: r.error });
            else { setSets(r.sets); setName(""); setMsg({ ok: r.ok }); }
          });
        }}>
          <label className="field"><span>Save this caption&apos;s {found.length || ""} hashtag{found.length === 1 ? "" : "s"} as a set</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Set name, like Coffee" maxLength={40} disabled={!found.length} /></label>
          <button className="btn sm" disabled={pending || !found.length || !name.trim()}>Save set</button>
          {msg?.error && <p className="err" role="alert" style={{ margin: 0 }}>{msg.error}</p>}
          {msg?.ok && <p className="muted" role="status" style={{ margin: 0, fontSize: 12.5 }}>{msg.ok}</p>}
        </form>
      </div>
    </details>
  );
}

/** Stock photo search inside the media picker. Picking a photo adds it to the library. */
export function StockSearch({ workspaceId, onAdded }: { workspaceId: string; onAdded: (m: Media) => void }) {
  const [q, setQ] = useState("");
  const [photos, setPhotos] = useState<StockPhoto[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [pending, start] = useTransition();

  function search(p: number) {
    setError(null);
    start(async () => {
      const r = await searchStockAction(workspaceId, q, p);
      setSearched(true);
      if ("error" in r) return setError(r.error);
      setPhotos((prev) => (p === 1 ? r.photos : [...prev, ...r.photos]));
      setHasMore(r.hasMore);
      setPage(p);
    });
  }

  async function add(id: string) {
    setAdding(id);
    setError(null);
    const r = await importStockAction(workspaceId, id);
    setAdding(null);
    if ("error" in r) return setError(r.error ?? "Couldn't add that photo.");
    onAdded(r.media);
  }

  return (
    <div className="stack" style={{ gap: 12 }}>
      <form className="row" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); search(1); }}>
        <input className="input" aria-label="Search stock photos" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search free photos, like coffee shop" maxLength={100} />
        <button className="btn" disabled={pending || !q.trim()}><Icon name="search" /> Search</button>
      </form>
      {error && <p className="err" role="alert">{error}</p>}
      {searched && !pending && !photos.length && !error && <p className="muted">No photos found. Try other words.</p>}
      {photos.length > 0 && (
        <div className="media-grid" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(130px,1fr))" }}>
          {photos.map((p) => (
            <button type="button" key={p.id} className="asset" disabled={adding !== null} onClick={() => add(p.id)} aria-label={`Add photo by ${p.photographer}${p.alt ? `: ${p.alt}` : ""}`}>
              <div className="img">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.thumb} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                {adding === p.id && <span className="kind">Adding…</span>}
              </div>
              <div className="meta"><small className="muted">{p.photographer}</small></div>
            </button>
          ))}
        </div>
      )}
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <small className="muted">Photos provided by <a href="https://www.pexels.com" target="_blank" rel="noreferrer">Pexels</a>. Free to use; crediting the photographer is appreciated.</small>
        {hasMore && <button type="button" className="btn sm" disabled={pending} onClick={() => search(page + 1)}>{pending ? "Loading…" : "More photos"}</button>}
      </div>
    </div>
  );
}
