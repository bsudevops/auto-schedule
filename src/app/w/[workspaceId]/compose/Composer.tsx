"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { deletePostAction, savePostAction } from "@/app/actions/posts";
import { Icon } from "@/components/Icon";
import { MediaCarousel } from "@/components/MediaCarousel";
import { PlatformBadge, StatusPill } from "@/components/ui";
import type { Platform } from "@/db/schema";
import { PLATFORMS } from "@/lib/platforms";
import { addTags } from "@/lib/hashtags";
import { checkPost } from "@/lib/post-rules";
import { uploadFiles } from "../media/MediaControls";
import type { DriveConfig } from "@/lib/drive";
import { AiPanel, HashtagMenu, StockSearch, type HashtagSet } from "./ComposerTools";
import { DrivePicker } from "./DrivePicker";
import { YoutubeSettings, ytOptions } from "./YoutubeSettings";

const MEDIA_FIRST = new Set<Platform>(["instagram", "tiktok"]);

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
  /** Gemini is set up, so captions and titles can be written from the media. */
  mediaAiEnabled?: boolean;
  stockEnabled: boolean;
  /** Google Drive is set up and this person may add media: the picker opens on Drive. */
  drive?: DriveConfig | null;
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
  // Files dragged from the computer onto the editor are uploaded and added to the post.
  const [dropping, setDropping] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [dropErrors, setDropErrors] = useState<string[]>([]);
  const dragDepth = useRef(0);
  const dragFrom = useRef<number | null>(null);

  // A file dropped anywhere else on the page would make the browser open it and leave the composer.
  useEffect(() => {
    const stop = (e: DragEvent) => { if (e.dataTransfer?.types.includes("Files")) e.preventDefault(); };
    window.addEventListener("dragover", stop);
    window.addEventListener("drop", stop);
    return () => { window.removeEventListener("dragover", stop); window.removeEventListener("drop", stop); };
  }, []);

  async function addFiles(list: FileList | File[]) {
    const files = Array.from(list).filter((f) => f.type.startsWith("image/") || f.type.startsWith("video/"));
    const skipped = list.length - files.length;
    const room = 10 - mediaIds.length;
    if (!files.length) { setDropErrors(skipped ? ["Only images and videos can be added to a post."] : []); return; }
    if (room <= 0) { setDropErrors(["A post can have up to 10 files. Remove one to add another."]); return; }
    const batch = files.slice(0, room);
    setDropErrors([]);
    setUploading(batch.length);
    const r = await uploadFiles(workspaceId, batch);
    setUploading(0);
    setMediaIds((ids) => [...ids, ...r.ids.filter((id) => !ids.includes(id))].slice(0, 10));
    setDropErrors([
      ...r.errors,
      ...(files.length > room ? [`Only ${room} more file${room === 1 ? "" : "s"} fit in this post, so the rest were left out.`] : []),
      ...(skipped ? ["Only images and videos can be added to a post."] : []),
    ]);
    router.refresh();
  }

  const isFiles = (e: React.DragEvent) => e.dataTransfer.types.includes("Files");
  const dropZone = readonly ? {} : {
    onDragEnter: (e: React.DragEvent) => { if (!isFiles(e)) return; e.preventDefault(); dragDepth.current += 1; setDropping(true); },
    onDragOver: (e: React.DragEvent) => { if (!isFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = "copy"; },
    onDragLeave: (e: React.DragEvent) => { if (!isFiles(e)) return; dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDropping(false); },
    onDrop: (e: React.DragEvent) => { if (!isFiles(e)) return; e.preventDefault(); dragDepth.current = 0; setDropping(false); void addFiles(e.dataTransfer.files); },
  };

  /** Drag a thumbnail onto another to change the order (the first file is the cover). */
  function moveMedia(from: number, to: number) {
    if (from === to) return;
    setMediaIds((ids) => { const n = [...ids]; const [x] = n.splice(from, 1); n.splice(to, 0, x!); return n; });
  }

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

              <section className={`card drop-zone${dropping ? " dropping" : ""}`} {...dropZone}>
                {dropping && <div className="drop-hint" aria-hidden="true"><Icon name="upload" size={26} /><b>Drop to add to this post</b><span>Images and videos, up to 10 files</span></div>}
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
                    <div className="m" key={m.id} title={chosenMedia.length > 1 ? "Drag to reorder" : undefined}
                      draggable={!readonly && chosenMedia.length > 1}
                      onDragStart={(e) => { dragFrom.current = i; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", m.id); }}
                      onDragOver={(e) => { if (dragFrom.current != null) e.preventDefault(); }}
                      onDrop={(e) => { if (dragFrom.current == null) return; e.preventDefault(); e.stopPropagation(); moveMedia(dragFrom.current, i); dragFrom.current = null; }}
                      onDragEnd={() => { dragFrom.current = null; }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {m.kind === "image" ? <img src={m.thumb} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 10 }} /> : <video src={m.url} muted style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 10 }} />}
                      <button type="button" className="m-remove" aria-label={`Remove ${m.filename}`} title="Remove" onClick={() => setMediaIds((ids) => ids.filter((_, j) => j !== i))}><Icon name="x" size={12} /></button>
                    </div>
                  ))}
                  {Array.from({ length: uploading }, (_, k) => <div className="m uploading" key={`up${k}`} aria-label="Uploading"><span className="spin" /></div>)}
                  <button type="button" className="m add" aria-label="Add media" title="Add media, or drag files here" onClick={() => setPicker(true)}>+</button>
                </div>
                {dropErrors.length > 0 && <div style={{ padding: "0 18px 12px" }}>{dropErrors.map((m) => <p key={m} className="err" role="alert" style={{ margin: "2px 0" }}>{m}</p>)}</div>}
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
                    <button type="button" className={`icon-btn${aiOpen ? " on" : ""}`} title={props.mediaAiEnabled ? "AI writing: from your media or your text" : "Writing help"} aria-label="Writing help" aria-expanded={aiOpen} onClick={() => setAiOpen((o) => !o)}><Icon name="spark" /></button>
                  )}
                  <div className="counters">
                    {selected.map((c) => {
                      const len = (overrides[c.id] ?? caption).length;
                      const lim = PLATFORMS[c.platform].captionLimit;
                      return <span key={c.id} className={`counter${len > lim ? " over" : ""}`} title={`${PLATFORMS[c.platform].name} limit`}><PlatformBadge platform={c.platform} size="xs" /> {len}/{lim > 9999 ? "∞" : lim}</span>;
                    })}
                  </div>
                </div>
                {aiOpen && (
                  <AiPanel workspaceId={workspaceId} text={text} channelIds={chIds} onClose={() => setAiOpen(false)}
                    onUse={(v, how) => setText(how === "tags" ? addTags(text, v.split(/\s+/)) : v)}
                    media={props.mediaAiEnabled ? {
                      ids: chosenMedia.map((m) => m.id), kinds: chosenMedia.map((m) => m.kind),
                      youtube: selected.some((c) => c.platform === "youtube"),
                      onUseTitle: (t) => setOptions((all) => Object.fromEntries([...Object.entries(all), ...selected.filter((c) => c.platform === "youtube").map((c) => [c.id, { ...ytOptions(all[c.id]), title: t }])])),
                    } : undefined} />
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
                    <div className="seg">{selected.map((c) => <button type="button" key={c.id} className={previewCh?.id === c.id ? "on" : ""} onClick={() => setTab(c.id)} title={PLATFORMS[c.platform].name} aria-label={PLATFORMS[c.platform].name}><PlatformBadge platform={c.platform} size="xs" /></button>)}</div>
                  )}
                </div>
                <div className="card-b">
                  {previewCh ? (
                    <div className="preview">
                      <div className="preview-h"><PlatformBadge platform={previewCh.platform} large /><div><b style={{ fontSize: 13.5 }}>{previewCh.handle}</b><div className="muted" style={{ fontSize: 11.5 }}>{PLATFORMS[previewCh.platform].name}</div></div></div>
                      {(() => {
                        const text = <div className="preview-b">{previewText || <span className="muted">Your caption appears here.</span>}</div>;
                        const mediaEl = chosenMedia.length > 0 && (
                          <MediaCarousel fit="natural" className="preview-media" slides={chosenMedia.map((m) => ({ id: m.id, kind: m.kind, src: m.url, thumb: m.kind === "image" ? m.thumb : undefined, alt: m.filename }))} />
                        );
                        // Instagram and TikTok put the media first and the caption under it; the others show the text first.
                        return MEDIA_FIRST.has(previewCh.platform) ? <>{mediaEl}{text}</> : <>{text}{mediaEl}</>;
                      })()}
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

      {picker && <MediaPicker workspaceId={workspaceId} media={media} chosen={mediaIds} stockEnabled={props.stockEnabled} drive={props.drive ?? null}
        onAdded={(added) => {
          setMedia((all) => [...added, ...all.filter((x) => !added.some((a) => a.id === x.id))]);
          setMediaIds((ids) => [...ids, ...added.map((a) => a.id).filter((id) => !ids.includes(id))].slice(0, 10));
          setPicker(false);
        }}
        onClose={() => setPicker(false)} onPick={(id) => { setMediaIds((ids) => (ids.includes(id) ? ids : [...ids, id].slice(0, 10))); setPicker(false); }} />}
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

function MediaPicker({ workspaceId, media, chosen, stockEnabled, drive, onAdded, onClose, onPick }: { workspaceId: string; media: Media[]; chosen: string[]; stockEnabled: boolean; drive: DriveConfig | null; onAdded: (m: Media[]) => void; onClose: () => void; onPick: (id: string) => void }) {
  const router = useRouter();
  // Google Drive comes first when it's set up; uploads and the library stay one tab away.
  const [tab, setTab] = useState<"drive" | "library" | "stock">(drive ? "drive" : "library");
  const tabs = [
    ...(drive ? [{ id: "drive" as const, label: "Google Drive" }] : []),
    { id: "library" as const, label: drive ? "Upload or library" : "Your library" },
    ...(stockEnabled ? [{ id: "stock" as const, label: "Free stock photos" }] : []),
  ];
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [over, setOver] = useState(false);
  async function upload(files: FileList | File[]) {
    if (!files.length) return;
    setBusy(true);
    const r = await uploadFiles(workspaceId, files);
    setBusy(false);
    setErrors(r.errors);
    router.refresh();
    if (r.ids.length && !r.errors.length) r.ids.forEach(onPick);
  }
  return (
    <div className="scrim" onClick={(e) => e.target === e.currentTarget && onClose()} onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Add media">
        <div className="modal-h"><h2>Add media</h2><button type="button" className="icon-btn" aria-label="Close" onClick={onClose}><Icon name="x" /></button></div>
        <div className="modal-b">
          {tabs.length > 1 && (
            <div className="seg" role="tablist" style={{ alignSelf: "flex-start", flexWrap: "wrap" }}>
              {tabs.map((t) => (
                <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)}>{t.label}</button>
              ))}
            </div>
          )}
          {tab === "drive" && drive ? <DrivePicker workspaceId={workspaceId} config={drive} max={10 - chosen.length} onAdded={onAdded} />
          : tab === "stock" ? <StockSearch workspaceId={workspaceId} onAdded={(m) => onAdded([m])} /> : <>
          <label className={`upload-drop${over ? " over" : ""}`}
            onDragOver={(e) => { if (!e.dataTransfer.types.includes("Files")) return; e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { if (!e.dataTransfer.types.includes("Files")) return; e.preventDefault(); setOver(false); void upload(e.dataTransfer.files); }}>
            <Icon name="upload" size={22} />
            <b>{busy ? "Uploading…" : "Drag files here or click to upload"}</b>
            <span className="muted">Images and videos from your computer</span>
            <input type="file" hidden multiple accept="image/*,video/mp4,video/quicktime,video/webm" disabled={busy}
              onChange={(e) => { if (e.target.files?.length) void upload(e.target.files); }} />
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
