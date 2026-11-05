"use client";
import { useRef, useState } from "react";
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
 * YouTube Studio style thumbnail choice: upload or drop an image, use a frame from the video,
 * or let YouTube pick one. Once chosen, one large preview replaces the options.
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
  const [frameMode, setFrameMode] = useState(false);
  const [changing, setChanging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const player = useRef<HTMLVideoElement>(null);
  const chosen = images.find((m) => m.id === value);

  async function save(blob: Blob, name: string) {
    const file = new File([blob], name, { type: "image/jpeg" });
    const r = await uploadFiles(workspaceId, [file]);
    if (!r.ids[0]) throw new Error(r.errors[0] ?? "The upload failed.");
    const url = URL.createObjectURL(blob);
    props.onAdded({ id: r.ids[0], kind: "image", filename: name, thumb: url, url });
    onChange(r.ids[0]);
    setChanging(false);
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

  const showOptions = !chosen || changing;

  return (
    <div className="field">
      <span>Thumbnail</span>
      <small className="muted" style={{ marginTop: -2 }}>Pick an image that shows what&rsquo;s in your video. Custom thumbnails need a verified YouTube channel (youtube.com/verify).</small>
      <input ref={fileRef} id={`${props.idPrefix}-file`} type="file" hidden accept="image/jpeg,image/png,image/webp" onChange={(e) => { pickFile(e.target.files?.[0]); e.target.value = ""; }} />

      {chosen && !changing && (
        <div className="thumb-chosen">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={chosen.url} alt="Chosen thumbnail" />
          <div className="stack" style={{ gap: 6 }}>
            <small><b>Using {chosen.filename}</b></small>
            <div className="row" style={{ gap: 6 }}>
              <button type="button" className="btn sm" onClick={() => setChanging(true)}>Change</button>
              <button type="button" className="btn ghost sm" onClick={() => onChange(null)}>Remove</button>
            </div>
          </div>
        </div>
      )}

      {showOptions && (
        <div className="thumb-opts">
          <button type="button" className={`thumb-opt${drag ? " on" : ""}`} aria-label="Upload a thumbnail" onClick={() => fileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); pickFile(e.dataTransfer.files[0]); }}>
            <Icon name="upload" size={18} />
            <b>{drag ? "Drop image" : "Upload file"}</b>
            <small>or drag it here</small>
          </button>
          {video && (
            <button type="button" className={`thumb-opt${frameMode ? " on" : ""}`} aria-label="Pick a frame from the video" aria-pressed={frameMode} onClick={() => setFrameMode((m) => !m)}>
              <Icon name="img" size={18} />
              <b>Pick a frame</b>
              <small>from the video</small>
            </button>
          )}
          <button type="button" className={`thumb-opt${!value ? " on" : ""}`} aria-pressed={!value} onClick={() => { onChange(null); setChanging(false); setFrameMode(false); }}>
            <Icon name="spark" size={18} />
            <b>Auto-generated</b>
            <small>by YouTube</small>
          </button>
        </div>
      )}

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
      {showOptions && <small className="muted">JPG or PNG, at least 640 pixels wide; 1280×720 works best. Images are resized to fit YouTube&rsquo;s 2 MB limit.</small>}
    </div>
  );
}
