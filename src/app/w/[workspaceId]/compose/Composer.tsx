"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { deletePostAction, savePostAction } from "@/app/actions/posts";
import { Icon } from "@/components/Icon";
import { PlatformBadge, StatusPill } from "@/components/ui";
import type { Platform } from "@/db/schema";
import { PLATFORMS } from "@/lib/platforms";
import { addTags } from "@/lib/hashtags";
import { checkPost } from "@/lib/post-rules";
import { uploadFiles } from "../media/MediaControls";
import { AiPanel, HashtagMenu, StockSearch, type HashtagSet } from "./ComposerTools";
import { YoutubeSettings } from "./YoutubeSettings";

type Mode = "draft" | "now" | "schedule" | "queue";
type Channel = { id: string; platform: Platform; handle: string; displayName: string; status: string };
type Media = { id: string; kind: "image" | "video"; filename: string; thumb: string; url: string; width?: number | null; height?: number | null; durationMs?: number | null };

export type ComposerProps = {
  workspaceId: string;
  timezone: string;
  canPublish: boolean;
  postStatus: string | null;
  channels: Channel[];
  media: Media[];
  queues: Array<{ id: string; name: string; next: string | null }>;
  hashtagSets: HashtagSet[];
  aiEnabled: boolean;
  stockEnabled: boolean;
  initial: {
    postId?: string;
    channelIds: string[];
    caption: string;
    overrides: Record<string, string>;
    /** Platform settings per channel ID, such as YouTube's title and visibility. */
    options: Record<string, Record<string, unknown>>;
    mediaIds: string[];
    firstComment: string;
    tags: string[];
    mode: Mode;
    date: string;
    time: string;
    queueId?: string;
  };
};

const EMOJI = ["💡", "🎉", "🔥", "✨", "❤️", "👏", "📣", "🙌", "😊", "👉"];

export function Composer(props: ComposerProps) {
  const { workspaceId, timezone, canPublish, channels, queues, initial } = props;
  const [media, setMedia] = useState(props.media);
  // A file uploaded from the media picker arrives in props.media after a refresh; keep it alongside anything added here.
  useEffect(() => setMedia((cur) => [...props.media, ...cur.filter((c) => !props.media.some((p) => p.id === c.id))]), [props.media]);
  const [aiOpen, setAiOpen] = useState(false);
  const readonly = props.postStatus === "readonly" || props.postStatus === "published" || props.postStatus === "publishing";
  const router = useRouter();
  const [chIds, setChIds] = useState(initial.channelIds);
  const [caption, setCaption] = useState(initial.caption);
  const [overrides, setOverrides] = useState(initial.overrides);
  const [options, setOptions] = useState(initial.options);
  const [tab, setTab] = useState<string>("all");
  const [mediaIds, setMediaIds] = useState(initial.mediaIds);
  const [firstComment, setFirstComment] = useState(initial.firstComment);
  const [tags, setTags] = useState(initial.tags.join(", "));
  const [mode, setMode] = useState<Mode>(canPublish ? (initial.mode === "draft" ? "schedule" : initial.mode) : "draft");
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [queueId, setQueueId] = useState(initial.queueId);
  const [picker, setPicker] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const textRef = useRef<HTMLTextAreaElement>(null);

  const selected = channels.filter((c) => chIds.includes(c.id));
  const activeTab = selected.some((c) => c.id === tab) ? tab : "all";
  const text = activeTab === "all" ? caption : (overrides[activeTab] ?? caption);
  const previewCh = selected.find((c) => c.id === activeTab) ?? selected[0];
  const previewText = previewCh ? (overrides[previewCh.id] ?? caption) : caption;
  const chosenMedia = mediaIds.map((id) => media.find((m) => m.id === id)).filter(Boolean) as Media[];
  const problems = useMemo(() => checkPost(selected, caption, overrides, chosenMedia), [selected, caption, overrides, chosenMedia]);

  function setText(v: string) {
    if (activeTab === "all") setCaption(v);
    else setOverrides((o) => ({ ...o, [activeTab]: v }));
  }
  function insert(s: string) {
    const el = textRef.current;
    const pos = el?.selectionStart ?? text.length;
    setText(text.slice(0, pos) + s + text.slice(pos));
    requestAnimationFrame(() => el?.focus());
  }
  function toggleChannel(id: string) {
    setChIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  }

  function submit(asDraft: boolean) {
    setError(null);
    start(async () => {
      const r = await savePostAction(workspaceId, {
        postId: initial.postId, channelIds: chIds, caption, overrides, mediaIds, firstComment,
        options: Object.fromEntries(Object.entries(options).filter(([id]) => chIds.includes(id))),
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        mode: asDraft ? "draft" : mode, date, time, queueId,
      });
      if (!r.ok) return setError(r.error);
      router.push(`/w/${workspaceId}/calendar?saved=${r.status}${r.scheduledAt ? `&at=${encodeURIComponent(r.scheduledAt)}` : ""}`);
    });
  }

  const primaryLabel = mode === "now" ? "Publish now" : mode === "queue" ? "Add to queue" : "Schedule";

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{initial.postId ? "Edit post" : "Create post"}</h1>
          <p>Write once, then adjust the caption for any channel. Times are in {timezone.replace(/_/g, " ")}.</p>
        </div>
        {props.postStatus && props.postStatus !== "readonly" && <StatusPill status={props.postStatus} />}
      </div>
      {readonly && <p className="banner" style={{ marginBottom: 16 }}>{props.postStatus === "readonly" ? "You can view this post but not change it." : "This post has been published, so it can't be changed."}</p>}

      {channels.length === 0 ? (
        <div className="card card-b stack" style={{ alignItems: "flex-start" }}>
          <h3>Connect a channel first</h3>
          <p className="muted">Posts go out through connected channels. Connect a social account to start.</p>
          <Link className="btn primary" href={`/w/${workspaceId}/channels`}>Go to channels</Link>
        </div>
      ) : (
        <fieldset disabled={readonly || pending} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          <div className="comp">
            <div className="stack" style={{ gap: 16 }}>
              <section className="card"><div className="card-b">
                <div className="label" style={{ marginBottom: 10 }}>Post to</div>
                <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
                  {channels.map((c) => (
                    <button type="button" key={c.id} className={`chip${chIds.includes(c.id) ? " on" : ""}`} aria-pressed={chIds.includes(c.id)} onClick={() => toggleChannel(c.id)}
                      title={c.status === "reconnect" ? "This channel needs reconnecting before posts can go out" : undefined}>
                      <PlatformBadge platform={c.platform} /> {PLATFORMS[c.platform].name}
                      <span className="muted" style={{ fontSize: 11 }}>@{c.handle}</span>
                      {c.status === "reconnect" && <span className="pill s-failed nodot" style={{ fontSize: 10 }}>Reconnect</span>}
                    </button>
                  ))}
                </div>
              </div></section>

              <section className="card">
                <div className="editor-tabs" role="tablist">
                  <button type="button" role="tab" aria-selected={activeTab === "all"} className={activeTab === "all" ? "on" : ""} onClick={() => setTab("all")}>All channels</button>
                  {selected.map((c) => (
                    <button type="button" role="tab" aria-selected={activeTab === c.id} key={c.id} className={activeTab === c.id ? "on" : ""} onClick={() => setTab(c.id)}>
                      <PlatformBadge platform={c.platform} /> {PLATFORMS[c.platform].name}
                      {overrides[c.id] != null && <span className="pill s-approved nodot" style={{ fontSize: 10 }}>Custom</span>}
                    </button>
                  ))}
                </div>
                {activeTab !== "all" && (
                  <div className="row" style={{ padding: "10px 18px 0", fontSize: 12.5, color: "var(--muted)", flexWrap: "wrap" }}>
                    Editing the {PLATFORMS[selected.find((c) => c.id === activeTab)!.platform].name} version only.
                    {overrides[activeTab] != null && <button type="button" className="btn ghost sm" onClick={() => setOverrides((o) => { const n = { ...o }; delete n[activeTab]; return n; })}>Use the main caption</button>}
                  </div>
                )}
                <textarea ref={textRef} className="editor-area" id="caption" aria-label="Caption" placeholder="What do you want to share?" value={text} onChange={(e) => setText(e.target.value)} />
                <div className="media-strip">
                  {chosenMedia.map((m, i) => (
                    <div className="m" key={m.id} style={{ overflow: "hidden" }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {m.kind === "image" ? <img src={m.thumb} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 10 }} /> : <video src={m.url} muted style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 10 }} />}
                      <button type="button" aria-label={`Remove ${m.filename}`} onClick={() => setMediaIds((ids) => ids.filter((_, j) => j !== i))}>×</button>
                    </div>
                  ))}
                  <button type="button" className="m add" aria-label="Add media" onClick={() => setPicker(true)}>+</button>
                </div>
                <div className="editor-tools">
                  <button type="button" className="icon-btn" title="Add media" aria-label="Add media" onClick={() => setPicker(true)}><Icon name="img" /></button>
                  <details style={{ position: "relative" }}>
                    <summary className="icon-btn" title="Emoji" aria-label="Emoji" style={{ listStyle: "none" }}><Icon name="smile" /></summary>
                    <div className="menu" style={{ width: 220, display: "flex", flexWrap: "wrap", gap: 2 }}>
                      {EMOJI.map((e) => <button type="button" key={e} className="mi" style={{ width: 36, justifyContent: "center" }} onClick={() => insert(e)}>{e}</button>)}
                    </div>
                  </details>
                  <HashtagMenu workspaceId={workspaceId} sets={props.hashtagSets} caption={text} onHash={() => insert("#")} onInsert={(t) => setText(addTags(text, t))} />
                  {props.aiEnabled && (
                    <button type="button" className={`icon-btn${aiOpen ? " on" : ""}`} title="Writing help" aria-label="Writing help" aria-expanded={aiOpen} onClick={() => setAiOpen((o) => !o)}><Icon name="spark" /></button>
                  )}
                  <div className="counters">
                    {selected.map((c) => {
                      const len = (overrides[c.id] ?? caption).length;
                      const lim = PLATFORMS[c.platform].captionLimit;
                      return <span key={c.id} className={`counter${len > lim ? " over" : ""}`} title={`${PLATFORMS[c.platform].name} limit`}>{PLATFORMS[c.platform].short} {len}/{lim > 9999 ? "∞" : lim}</span>;
                    })}
                  </div>
                </div>
                {aiOpen && (
                  <AiPanel workspaceId={workspaceId} text={text} channelIds={chIds} onClose={() => setAiOpen(false)}
                    onUse={(v, how) => setText(how === "tags" ? addTags(text, v.split(/\s+/)) : v)} />
                )}
              </section>

              {selected.filter((c) => c.platform === "youtube").map((c) => (
                <YoutubeSettings key={c.id} workspaceId={workspaceId} channel={c} value={options[c.id]} caption={overrides[c.id] ?? caption}
                  onChange={(v) => setOptions((all) => ({ ...all, [c.id]: v }))}
                  onEditDescription={() => { setTab(c.id); requestAnimationFrame(() => { textRef.current?.focus(); textRef.current?.scrollIntoView({ block: "center" }); }); }}
                  images={media.filter((m) => m.kind === "image")} video={chosenMedia.find((m) => m.kind === "video")}
                  onAddImage={(img) => setMedia((all) => [img, ...all.filter((x) => x.id !== img.id)])} />
              ))}

              <section className="card"><div className="card-b stack">
                <label className="field"><span>Tags <span className="muted" style={{ fontWeight: 400 }}>(comma-separated, for your team only)</span></span>
                  <input className="input" id="tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="launch, spring-campaign" /></label>
                <label className="field"><span>First comment <span className="muted" style={{ fontWeight: 400 }}>(posted as a reply where the platform allows it)</span></span>
                  <input className="input" id="first-comment" value={firstComment} onChange={(e) => setFirstComment(e.target.value)} maxLength={2200} placeholder="Add hashtags or a link as the first comment" /></label>
              </div></section>
            </div>

            <div className="stack" style={{ gap: 16, position: "sticky", top: 12 }}>
              <section className="card">
                <div className="card-h"><h3>Preview</h3>
                  {selected.length > 1 && (
                    <div className="seg">{selected.map((c) => <button type="button" key={c.id} className={previewCh?.id === c.id ? "on" : ""} onClick={() => setTab(c.id)} title={PLATFORMS[c.platform].name}>{PLATFORMS[c.platform].short}</button>)}</div>
                  )}
                </div>
                <div className="card-b">
                  {previewCh ? (
                    <div className="preview">
                      <div className="preview-h"><PlatformBadge platform={previewCh.platform} large /><div><b style={{ fontSize: 13.5 }}>{previewCh.handle}</b><div className="muted" style={{ fontSize: 11.5 }}>{PLATFORMS[previewCh.platform].name}</div></div></div>
                      <div className="preview-b">{previewText || <span className="muted">Your caption appears here.</span>}</div>
                      {chosenMedia[0] && (chosenMedia[0].kind === "image"
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img className="preview-img" src={chosenMedia[0].url} alt="" style={{ objectFit: "cover" }} />
                        : <video className="preview-img" src={chosenMedia[0].url} controls />)}
                      <div className="preview-f"><span className="row" style={{ gap: 5 }}><Icon name="heart" size={15} /> Like</span><span className="row" style={{ gap: 5 }}><Icon name="msg" size={15} /> Comment</span><span className="row" style={{ gap: 5 }}><Icon name="share" size={15} /> Share</span></div>
                    </div>
                  ) : <div className="empty">Pick at least one channel to see a preview.</div>}
                </div>
              </section>

              <section className="card"><div className="card-b stack">
                <div className="label">When</div>
                {!canPublish && <p className="muted" style={{ fontSize: 13 }}>Your role can save drafts. An editor or manager schedules them.</p>}
                {canPublish && (
                  <>
                    <label className="radio-card"><input type="radio" name="when" value="now" checked={mode === "now"} onChange={() => setMode("now")} /><span><b>Publish now</b><small>Goes out right away</small></span></label>
                    <label className="radio-card"><input type="radio" name="when" value="schedule" checked={mode === "schedule"} onChange={() => setMode("schedule")} />
                      <span style={{ flex: 1 }}><b>Schedule</b><small>Pick a date and time</small>
                        {mode === "schedule" && (
                          <span className="row" style={{ marginTop: 8, gap: 8, flexWrap: "wrap" }}>
                            <input type="date" className="input" id="date" aria-label="Date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: "auto" }} />
                            <input type="time" className="input" id="time" aria-label="Time" value={time} onChange={(e) => setTime(e.target.value)} style={{ width: "auto" }} />
                          </span>
                        )}
                      </span>
                    </label>
                    <label className="radio-card"><input type="radio" name="when" value="queue" checked={mode === "queue"} disabled={!queues.length} onChange={() => setMode("queue")} />
                      <span style={{ flex: 1 }}><b>Add to queue</b>
                        <small>{queues.length ? "Goes out in the queue's next open slot" : "Create a queue on the calendar page first"}</small>
                        {mode === "queue" && (
                          <select className="input" id="queue" aria-label="Queue" value={queueId} onChange={(e) => setQueueId(e.target.value)} style={{ marginTop: 8 }}>
                            {queues.map((q) => <option key={q.id} value={q.id}>{q.name}{q.next ? ` (next: ${q.next})` : " (no open slots)"}</option>)}
                          </select>
                        )}
                      </span>
                    </label>
                  </>
                )}
                {!readonly && problems.length > 0 && mode !== "draft" && (
                  <ul className="muted" style={{ fontSize: 12.5, margin: 0, paddingLeft: 18 }}>{problems.map((p) => <li key={p}>{p}</li>)}</ul>
                )}
                {error && <p className="err" role="alert">{error}</p>}
                {!readonly && (
                  <div className="row" style={{ justifyContent: "flex-end", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
                    {initial.postId && <DeleteButton workspaceId={workspaceId} postId={initial.postId} />}
                    <button type="button" className="btn" onClick={() => submit(true)}>Save draft</button>
                    {canPublish && <button type="button" className="btn primary" disabled={problems.length > 0} onClick={() => submit(false)}><Icon name="send" /> {pending ? "Saving…" : primaryLabel}</button>}
                  </div>
                )}
              </div></section>
            </div>
          </div>
        </fieldset>
      )}

      {picker && <MediaPicker workspaceId={workspaceId} media={media} chosen={mediaIds} stockEnabled={props.stockEnabled}
        onStock={(m) => { setMedia((all) => [m, ...all.filter((x) => x.id !== m.id)]); setMediaIds((ids) => (ids.includes(m.id) ? ids : [...ids, m.id].slice(0, 10))); setPicker(false); }} onClose={() => setPicker(false)} onPick={(id) => { setMediaIds((ids) => (ids.includes(id) ? ids : [...ids, id].slice(0, 10))); setPicker(false); }} />}
    </>
  );
}

function DeleteButton({ workspaceId, postId }: { workspaceId: string; postId: string }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  if (!confirm) return <button type="button" className="btn ghost danger" onClick={() => setConfirm(true)} style={{ marginRight: "auto" }}><Icon name="trash" /> Delete</button>;
  return (
    <button type="button" className="btn danger" style={{ marginRight: "auto" }} disabled={pending}
      onClick={() => start(async () => { const r = await deletePostAction(workspaceId, postId); if (r.ok) router.push(`/w/${workspaceId}/calendar`); })}>
      Delete for good
    </button>
  );
}

function MediaPicker({ workspaceId, media, chosen, stockEnabled, onStock, onClose, onPick }: { workspaceId: string; media: Media[]; chosen: string[]; stockEnabled: boolean; onStock: (m: Media) => void; onClose: () => void; onPick: (id: string) => void }) {
  const router = useRouter();
  const [tab, setTab] = useState<"library" | "stock">("library");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  return (
    <div className="scrim" onClick={(e) => e.target === e.currentTarget && onClose()} onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Add media">
        <div className="modal-h"><h2>Add media</h2><button type="button" className="icon-btn" aria-label="Close" onClick={onClose}><Icon name="x" /></button></div>
        <div className="modal-b">
          {stockEnabled && (
            <div className="seg" role="tablist" style={{ alignSelf: "flex-start" }}>
              <button type="button" role="tab" aria-selected={tab === "library"} className={tab === "library" ? "on" : ""} onClick={() => setTab("library")}>Your library</button>
              <button type="button" role="tab" aria-selected={tab === "stock"} className={tab === "stock" ? "on" : ""} onClick={() => setTab("stock")}>Free stock photos</button>
            </div>
          )}
          {tab === "stock" ? <StockSearch workspaceId={workspaceId} onAdded={onStock} /> : <>
          <label className="btn" style={{ cursor: "pointer", width: "max-content" }}>
            <Icon name="upload" /> {busy ? "Uploading…" : "Upload from your computer"}
            <input type="file" hidden multiple accept="image/*,video/mp4,video/quicktime,video/webm" disabled={busy}
              onChange={async (e) => {
                if (!e.target.files?.length) return;
                setBusy(true);
                const r = await uploadFiles(workspaceId, e.target.files);
                setBusy(false);
                setErrors(r.errors);
                router.refresh();
                if (r.ids[0] && !r.errors.length) onPick(r.ids[0]);
              }} />
          </label>
          {errors.map((m) => <p key={m} className="err" role="alert">{m}</p>)}
          {media.length ? (
            <div className="media-grid" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(110px,1fr))" }}>
              {media.map((m) => (
                <button type="button" key={m.id} className={`asset${chosen.includes(m.id) ? " on" : ""}`} onClick={() => onPick(m.id)}>
                  <div className="img">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {m.kind === "image" ? <img src={m.thumb} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <video src={m.url} muted preload="metadata" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
                    <span className="kind">{m.kind === "image" ? "Image" : "Video"}</span>
                  </div>
                  <div className="meta"><b>{m.filename}</b></div>
                </button>
              ))}
            </div>
          ) : <p className="muted">Your media library is empty. Upload a file to get started.</p>}
          </>}
        </div>
      </div>
    </div>
  );
}
