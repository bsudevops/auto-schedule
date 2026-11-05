"use client";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { uploadFiles } from "../media/MediaControls";

export type ThumbImage = { id: string; kind: "image" | "video"; filename: string; thumb: string; url: string };

const MAX_W = 1280;
const MAX_H = 720;
const MIN_W = 640;
const MAX_BYTES = 2 * 1024 * 1024;

/** Draws a frame or image into a JPEG that fits YouTube's thumbnail rules: at most 1280×720 and under 2 MB. */
async function toJpeg(src: CanvasImageSource, w: number, h: number): Promise<Blob> {
  const scale = Math.min(1, MAX_W / w, MAX_H / h);
  const c = document.createElement("canvas");
  c.width = Math.round(w * scale);
  c.height = Math.round(h * scale);
  const g = c.getContext("2d")!;
  g.fillStyle = "#fff";
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(src, 0, 0, c.width, c.height);
  for (const q of [0.9, 0.8, 0.65, 0.5]) {
    const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, "image/jpeg", q));
    if (blob && blob.size <= MAX_BYTES) return blob;
  }
  throw new Error("The image is too detailed to fit in 2 MB.");
}

const seek = (v: HTMLVideoElement, t: number) =>
  new Promise<void>((ok, fail) => {
    const done = () => { v.removeEventListener("seeked", done); v.removeEventListener("error", bad); ok(); };
    const bad = () => { v.removeEventListener("seeked", done); v.removeEventListener("error", bad); fail(new Error("The video couldn't be read.")); };
    v.addEventListener("seeked", done);
    v.addEventListener("error", bad);
    v.currentTime = t;
  });

const frameError = (e: unknown) =>
  e instanceof DOMException && e.name === "SecurityError"
    ? "Your media storage doesn't allow reading video frames. Allow this app's address in the storage's CORS settings, or upload an image instead."
    : (e as Error).message || "Couldn't capture that frame.";

/**
 * YouTube Studio style thumbnail choice: upload or drop an image, use a frame from the video
 * (three suggestions or any moment you pick), choose a library image, or let YouTube pick one.
 */
export function ThumbnailPicker(props: {
  workspaceId: string;
  idPrefix: string;
  value: string | null;
  onChange: (id: string | null) => void;
  images: ThumbImage[];
  video: { url: string } | undefined;
  onAdded: (img: ThumbImage) => void;
}) {
  const { workspaceId, value, onChange, images, video } = props;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [suggested, setSuggested] = useState<{ t: number; src: string }[]>([]);
  const [frameMode, setFrameMode] = useState(false);
  const [library, setLibrary] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const probe = useRef<HTMLVideoElement | null>(null);
  const player = useRef<HTMLVideoElement>(null);
  const chosen = images.find((m) => m.id === value);

  // Three suggested frames, at a quarter, half and three quarters of the video, like YouTube's own.
  useEffect(() => {
    setSuggested([]);
    if (!video) return;
    let live = true;
    const v = document.createElement("video");
    v.crossOrigin = "anonymous";
    v.muted = true;
    v.preload = "auto";
    v.src = video.url;
    probe.current = v;
    v.addEventListener("loadeddata", async () => {
      const out: { t: number; src: string }[] = [];
      try {
        for (const f of [0.25, 0.5, 0.75]) {
          const t = Math.round(v.duration * f * 10) / 10;
          await seek(v, t);
          const c = document.createElement("canvas");
          c.width = 320;
          c.height = Math.round((320 * v.videoHeight) / Math.max(1, v.videoWidth));
          c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
          out.push({ t, src: c.toDataURL("image/jpeg", 0.7) });
        }
      } catch {
        // No suggestions (for example, storage without CORS). Upload and the frame picker still show.
      }
      if (live) setSuggested(out);
    }, { once: true });
    return () => { live = false; v.removeAttribute("src"); v.load(); probe.current = null; };
  }, [video]);

  async function save(blob: Blob, name: string) {
    const file = new File([blob], name, { type: "image/jpeg" });
    const r = await uploadFiles(workspaceId, [file]);
    if (!r.ids[0]) throw new Error(r.errors[0] ?? "The upload failed.");
    const url = URL.createObjectURL(blob);
    props.onAdded({ id: r.ids[0], kind: "image", filename: name, thumb: url, url });
    onChange(r.ids[0]);
  }

  async function run(label: string, fn: () => Promise<void>) {
    setError(null);
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      setError(frameError(e));
    } finally {
      setBusy(null);
    }
  }

  function pickFile(file: File | undefined) {
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return setError("Use a JPG or PNG image.");
    void run("Uploading…", async () => {
      const bmp = await createImageBitmap(file).catch(() => { throw new Error("That image couldn't be read."); });
      if (bmp.width < MIN_W) throw new Error(`That image is ${bmp.width} pixels wide. YouTube needs at least ${MIN_W}; 1280×720 works best.`);
      const blob = await toJpeg(bmp, bmp.width, bmp.height);
      await save(blob, `${file.name.replace(/\.[a-z0-9]+$/i, "")}-thumbnail.jpg`);
    });
  }

  function pickFrame(v: HTMLVideoElement | null, t: number) {
    if (!v) return;
    void run("Saving frame…", async () => {
      if (Math.abs(v.currentTime - t) > 0.05) await seek(v, t);
      const blob = await toJpeg(v, v.videoWidth, v.videoHeight);
      await save(blob, `frame-${t.toFixed(1)}s.jpg`);
      setFrameMode(false);
    });
  }

  const tile = { width: 128, height: 72, borderRadius: 8, overflow: "hidden", flex: "none" } as const;

  return (
    <div className="field">
      <span>Thumbnail</span>
      <small className="muted" style={{ marginTop: -2 }}>Pick an image that shows what&rsquo;s in your video. Custom thumbnails need a verified YouTube channel (youtube.com/verify).</small>

      <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "stretch" }}>
        <button type="button" aria-label="Upload a thumbnail" onClick={() => fileRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); pickFile(e.dataTransfer.files[0]); }}
          style={{ ...tile, border: `1.5px dashed ${drag ? "var(--sky)" : "var(--line)"}`, background: drag ? "var(--sky-soft, rgba(56,132,255,.08))" : "transparent", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, fontSize: 11.5, cursor: "pointer", color: "inherit" }}>
          <Icon name="upload" size={16} />
          <span>{drag ? "Drop image" : "Upload file"}</span>
          <span className="muted" style={{ fontSize: 10 }}>or drag it here</span>
        </button>
        <input ref={fileRef} id={`${props.idPrefix}-file`} type="file" hidden accept="image/jpeg,image/png,image/webp" onChange={(e) => { pickFile(e.target.files?.[0]); e.target.value = ""; }} />

        {video && (
          <button type="button" aria-label="Pick a frame from the video" aria-pressed={frameMode} onClick={() => setFrameMode((m) => !m)}
            style={{ ...tile, border: `1.5px dashed ${frameMode ? "var(--sky)" : "var(--line)"}`, background: "transparent", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, fontSize: 11.5, cursor: "pointer", color: "inherit" }}>
            <Icon name="img" size={16} />
            <span>Pick a frame</span>
            <span className="muted" style={{ fontSize: 10 }}>from the video</span>
          </button>
        )}

        {suggested.map((s, i) => (
          <button type="button" key={s.t} aria-label={`Use suggested frame ${i + 1}`} title={`Frame at ${s.t}s`} onClick={() => pickFrame(probe.current, s.t)}
            style={{ ...tile, padding: 0, border: "1px solid var(--line)", cursor: "pointer" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={s.src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          </button>
        ))}

        <button type="button" aria-pressed={!value} onClick={() => onChange(null)} className={`chip${!value ? " on" : ""}`} style={{ ...tile, justifyContent: "center", fontSize: 11.5, textAlign: "center" }}>
          Auto-generated<br />by YouTube
        </button>
      </div>

      {frameMode && video && (
        <div className="stack" style={{ gap: 8 }}>
          <video ref={player} src={video.url} crossOrigin="anonymous" controls muted preload="auto" aria-label="Video to pick a frame from" style={{ width: "100%", maxHeight: 280, borderRadius: 10, background: "#000" }} />
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn primary sm" disabled={!!busy} onClick={() => pickFrame(player.current, player.current?.currentTime ?? 0)}>Use this frame</button>
            <small className="muted">Pause the video on the moment you want, then use it.</small>
          </div>
        </div>
      )}

      {busy && <small className="muted" role="status">{busy}</small>}
      {error && <small className="err" role="alert">{error}</small>}

      {chosen && (
        <div className="row" style={{ gap: 10, alignItems: "center" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={chosen.url} alt="Chosen thumbnail" style={{ width: 192, height: 108, objectFit: "cover", borderRadius: 8, border: "2px solid var(--sky)" }} />
          <div className="stack" style={{ gap: 4 }}>
            <small><b>Using {chosen.filename}</b></small>
            <button type="button" className="btn ghost sm" onClick={() => onChange(null)}>Remove</button>
          </div>
        </div>
      )}

      {images.length > 0 && (
        <>
          <button type="button" className="btn ghost sm" style={{ alignSelf: "flex-start" }} aria-expanded={library} onClick={() => setLibrary((l) => !l)}>{library ? "Hide library" : "Choose from your media library"}</button>
          {library && (
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              {images.slice(0, 24).map((m) => (
                <button type="button" key={m.id} className={`chip${value === m.id ? " on" : ""}`} aria-pressed={value === m.id} title={m.filename} onClick={() => onChange(m.id)} style={{ padding: 2 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={m.thumb} alt={m.filename} style={{ width: 80, height: 45, objectFit: "cover", borderRadius: 6 }} />
                </button>
              ))}
            </div>
          )}
        </>
      )}
      <small className="muted">JPG or PNG, at least 640 pixels wide; 1280×720 works best. Images are resized to fit YouTube&rsquo;s 2 MB limit.</small>
    </div>
  );
}
