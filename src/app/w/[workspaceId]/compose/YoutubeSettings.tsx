"use client";
import { useEffect, useState } from "react";
import { PlatformBadge } from "@/components/ui";
import { YT_CATEGORIES, YT_LANGUAGES, defaultYoutubeOptions, isShort, youtubeTitle, type YoutubeOptions } from "@/lib/youtube-options";

type Img = { id: string; kind: "image" | "video"; filename: string; thumb: string };
type Vid = { width?: number | null; height?: number | null; durationMs?: number | null };

/** Fills in defaults for settings saved before a field existed. */
export function ytOptions(raw: Record<string, unknown> | undefined): YoutubeOptions {
  return { ...defaultYoutubeOptions(), ...(raw ?? {}) } as YoutubeOptions;
}

/**
 * YouTube's "Video details" for one channel: title, visibility, audience, thumbnail, playlist, tags and the rest.
 * The description is the YouTube version of the caption, edited in the YouTube tab above.
 */
export function YoutubeSettings(props: {
  workspaceId: string;
  channel: { id: string; handle: string };
  value: Record<string, unknown> | undefined;
  onChange: (v: YoutubeOptions) => void;
  caption: string;
  onEditDescription: () => void;
  images: Img[];
  video: Vid | undefined;
}) {
  const o = ytOptions(props.value);
  const set = (patch: Partial<YoutubeOptions>) => props.onChange({ ...o, ...patch });
  const [tagDraft, setTagDraft] = useState("");
  const [playlists, setPlaylists] = useState<{ id: string; title: string }[] | null>(null);
  const [more, setMore] = useState(false);
  const id = (f: string) => `yt-${f}-${props.channel.id}`;

  useEffect(() => {
    let live = true;
    fetch(`/api/w/${props.workspaceId}/channels/${props.channel.id}/youtube-playlists`)
      .then((r) => (r.ok ? r.json() : { playlists: [] }))
      .then((d: { playlists?: { id: string; title: string }[] }) => live && setPlaylists(d.playlists ?? []))
      .catch(() => live && setPlaylists([]));
    return () => { live = false; };
  }, [props.workspaceId, props.channel.id]);

  function addTags(raw: string) {
    const fresh = raw.split(",").map((t) => t.trim()).filter(Boolean).filter((t) => !o.tags.includes(t));
    if (fresh.length) set({ tags: [...o.tags, ...fresh].slice(0, 100) });
    setTagDraft("");
  }

  const tagChars = o.tags.join(",").length;
  const short = props.video && isShort({ width: props.video.width ?? null, height: props.video.height ?? null, durationMs: props.video.durationMs ?? null });
  const thumb = props.images.find((m) => m.id === o.thumbnailAssetId);

  return (
    <section className="card" aria-label={`YouTube settings for ${props.channel.handle}`}>
      <div className="card-h"><h3 className="row" style={{ gap: 8 }}><PlatformBadge platform="youtube" /> YouTube settings</h3><span className="muted" style={{ fontSize: 12 }}>@{props.channel.handle}</span></div>
      <div className="card-b stack">
        {short && <p className="banner" style={{ margin: 0 }}>This video is vertical and 3 minutes or shorter, so YouTube will show it as a Short.</p>}

        <label className="field"><span>Title <span className="muted" style={{ fontWeight: 400 }}>({o.title.length}/100)</span></span>
          <input className="input" id={id("title")} value={o.title} maxLength={100} placeholder={youtubeTitle(props.caption)}
            onChange={(e) => set({ title: e.target.value.replace(/[<>]/g, "") })} />
          <small className="muted">Left empty, the caption’s first line is used.</small>
        </label>

        <div className="field"><span>Description</span>
          <p className="muted" style={{ fontSize: 13, margin: 0, whiteSpace: "pre-wrap", maxHeight: 72, overflow: "hidden" }}>{props.caption.trim() || "Your caption becomes the description."}</p>
          <button type="button" className="btn ghost sm" style={{ alignSelf: "flex-start" }} onClick={props.onEditDescription}>Edit the YouTube description</button>
        </div>

        <div className="field"><span>Thumbnail</span>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button type="button" className={`chip${!o.thumbnailAssetId ? " on" : ""}`} aria-pressed={!o.thumbnailAssetId} onClick={() => set({ thumbnailAssetId: null })}>Auto-generated</button>
            {props.images.slice(0, 12).map((m) => (
              <button type="button" key={m.id} className={`chip${o.thumbnailAssetId === m.id ? " on" : ""}`} aria-pressed={o.thumbnailAssetId === m.id} title={m.filename} onClick={() => set({ thumbnailAssetId: m.id })} style={{ padding: 2 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={m.thumb} alt={m.filename} style={{ width: 64, height: 36, objectFit: "cover", borderRadius: 6 }} />
              </button>
            ))}
          </div>
          <small className="muted">{props.images.length ? "Pick an image from your media library (JPG or PNG, up to 2 MB, ideally 1280×720). Custom thumbnails need a verified YouTube channel." : "Upload an image to your media library to use it as a thumbnail."}{thumb ? ` Using ${thumb.filename}.` : ""}</small>
        </div>

        <label className="field"><span>Playlist</span>
          <select className="input" id={id("playlist")} value={o.playlistId} onChange={(e) => set({ playlistId: e.target.value })}>
            <option value="">None</option>
            {o.playlistId && playlists && !playlists.some((p) => p.id === o.playlistId) && <option value={o.playlistId}>Saved playlist</option>}
            {(playlists ?? []).map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
          {playlists === null && <small className="muted">Loading your playlists…</small>}
          {playlists?.length === 0 && <small className="muted">No playlists found on this channel. Create one in YouTube Studio to pick it here.</small>}
        </label>

        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}><legend className="label" style={{ marginBottom: 6 }}>Audience</legend>
          <label className="radio-card"><input type="radio" name={id("kids")} checked={o.madeForKids} onChange={() => set({ madeForKids: true })} /><span><b>Yes, it’s made for kids</b><small>Comments and some features are turned off on made-for-kids videos.</small></span></label>
          <label className="radio-card"><input type="radio" name={id("kids")} checked={!o.madeForKids} onChange={() => set({ madeForKids: false })} /><span><b>No, it’s not made for kids</b></span></label>
        </fieldset>

        <label className="field"><span>Visibility</span>
          <select className="input" id={id("visibility")} value={o.visibility} onChange={(e) => set({ visibility: e.target.value as YoutubeOptions["visibility"] })}>
            <option value="public">Public: everyone can watch</option>
            <option value="unlisted">Unlisted: anyone with the link</option>
            <option value="private">Private: only you</option>
          </select>
        </label>

        <div className="field"><span>Tags <span className="muted" style={{ fontWeight: 400 }}>({tagChars}/500)</span></span>
          {o.tags.length > 0 && (
            <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
              {o.tags.map((t) => <button type="button" key={t} className="chip on" aria-label={`Remove tag ${t}`} onClick={() => set({ tags: o.tags.filter((x) => x !== t) })}>{t} ×</button>)}
            </div>
          )}
          <input className="input" id={id("tags")} aria-label="Tags" value={tagDraft} placeholder="Add tags, separated by commas" onChange={(e) => (e.target.value.endsWith(",") ? addTags(e.target.value) : setTagDraft(e.target.value))}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTags(tagDraft); } }} onBlur={() => tagDraft && addTags(tagDraft)} />
          {tagChars > 500 && <small className="err">YouTube allows up to 500 characters of tags in total.</small>}
        </div>

        <label className="field"><span>Category</span>
          <select className="input" id={id("category")} value={o.categoryId} onChange={(e) => set({ categoryId: e.target.value })}>
            {Object.entries(YT_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>

        <button type="button" className="btn ghost sm" style={{ alignSelf: "flex-start" }} aria-expanded={more} onClick={() => setMore((m) => !m)}>{more ? "Show less" : "Show more"}</button>
        {more && (
          <div className="stack">
            <Toggle id={id("paid")} label="Paid promotion" hint="The video has paid product placement, sponsorship or endorsement. YouTube shows viewers a notice." checked={o.paidPromotion} onChange={(v) => set({ paidPromotion: v })} />
            <Toggle id={id("altered")} label="Altered or synthetic content" hint="Realistic content that was made or changed with AI or other tools." checked={o.alteredContent} onChange={(v) => set({ alteredContent: v })} />
            <Toggle id={id("notify")} label="Notify subscribers" hint="Send a notification and show it in subscription feeds." checked={o.notifySubscribers} onChange={(v) => set({ notifySubscribers: v })} />
            <Toggle id={id("embed")} label="Allow embedding" hint="Others can play the video on their websites." checked={o.embeddable} onChange={(v) => set({ embeddable: v })} />
            <Toggle id={id("likes")} label="Show how many viewers like this video" checked={o.showLikes} onChange={(v) => set({ showLikes: v })} />
            <label className="field"><span>License</span>
              <select className="input" id={id("license")} value={o.license} onChange={(e) => set({ license: e.target.value as YoutubeOptions["license"] })}>
                <option value="youtube">Standard YouTube License</option>
                <option value="creativeCommon">Creative Commons, attribution</option>
              </select>
            </label>
            <label className="field"><span>Video language</span>
              <select className="input" id={id("language")} value={o.language} onChange={(e) => set({ language: e.target.value })}>
                <option value="">Not set</option>
                {Object.entries(YT_LANGUAGES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label className="field"><span>Recording date</span>
              <input type="date" className="input" id={id("recorded")} value={o.recordingDate} onChange={(e) => set({ recordingDate: e.target.value })} style={{ width: "auto" }} />
            </label>
            <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>Age restriction, comments, subtitles, end screens and cards aren’t available to apps through YouTube’s API. Set those in YouTube Studio after the video is published.</p>
          </div>
        )}
      </div>
    </section>
  );
}

function Toggle({ id, label, hint, checked, onChange }: { id: string; label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="row" htmlFor={id} style={{ gap: 12, alignItems: "flex-start", cursor: "pointer" }}>
      <input type="checkbox" className="toggle" id={id} checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span><b style={{ fontSize: 13.5 }}>{label}</b>{hint && <small className="muted" style={{ display: "block", fontSize: 12 }}>{hint}</small>}</span>
    </label>
  );
}
