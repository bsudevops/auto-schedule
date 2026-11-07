"use client";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";

export type Slide = { id: string; kind: "image" | "video"; src: string; thumb?: string; alt?: string; poster?: string };

/**
 * Shows one image or video at a time. With more than one item it adds previous/next arrows, a counter and dots;
 * the arrow keys and a swipe work too. `thumbs` adds a strip of clickable thumbnails underneath.
 * `fit` decides how a slide sits in the frame: "contain" letterboxes inside a fixed height,
 * "natural" lets the frame follow the first item's shape, the way the platform would show it.
 */
export function MediaCarousel({ slides, thumbs = false, fit = "contain", className = "" }: { slides: Slide[]; thumbs?: boolean; fit?: "contain" | "natural"; className?: string }) {
  const [i, setI] = useState(0);
  const [ratio, setRatio] = useState<number | null>(null);
  const touch = useRef<number | null>(null);
  const n = slides.length;
  const idx = Math.min(i, Math.max(0, n - 1));
  const many = n > 1;

  // When the list shrinks (a file was removed in the composer), stay on a slide that still exists.
  useEffect(() => { if (i > n - 1) setI(Math.max(0, n - 1)); }, [i, n]);
  // The frame takes the first item's shape, so every slide keeps the same size, like a real carousel.
  // Measured from the first item directly, so it works even if the image loaded before the page became interactive.
  const first = slides[0];
  useEffect(() => {
    setRatio(null);
    if (fit !== "natural" || !first) return;
    const set = (w: number, h: number) => { if (w && h) setRatio(Math.min(Math.max(w / h, 0.56), 1.91)); };
    if (first.kind === "image") {
      const im = new Image();
      im.onload = () => set(im.naturalWidth, im.naturalHeight);
      im.src = first.src;
      return () => { im.onload = null; };
    }
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => set(v.videoWidth, v.videoHeight);
    v.src = first.src;
    return () => { v.onloadedmetadata = null; v.removeAttribute("src"); };
  }, [fit, first?.src, first?.kind]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!n) return null;
  const go = (d: number) => setI((v) => (Math.min(v, n - 1) + d + n) % n);
  const s = slides[idx]!;

  return (
    <div className={`mc ${fit === "natural" ? "mc-natural" : "mc-contain"} ${className}`.trim()} role={many ? "region" : undefined} aria-roledescription={many ? "carousel" : undefined} aria-label={many ? "Media" : undefined}>
      <div
        className="mc-frame"
        style={fit === "natural" && ratio ? { aspectRatio: String(ratio) } : undefined}
        tabIndex={many ? 0 : undefined}
        onKeyDown={(e) => { if (!many) return; if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); } if (e.key === "ArrowRight") { e.preventDefault(); go(1); } }}
        onTouchStart={(e) => { touch.current = e.touches[0]?.clientX ?? null; }}
        onTouchEnd={(e) => {
          const start = touch.current; touch.current = null;
          const end = e.changedTouches[0]?.clientX;
          if (!many || start == null || end == null) return;
          if (Math.abs(end - start) > 40) go(end < start ? 1 : -1);
        }}
      >
        {s.kind === "video"
          ? <video key={s.id} src={s.src} poster={s.poster} controls preload="metadata" />
          // eslint-disable-next-line @next/next/no-img-element
          : <img key={s.id} src={s.src} alt={s.alt ?? ""} />}
        {many && (
          <>
            <button type="button" className="mc-arrow prev" onClick={() => go(-1)} aria-label="Previous"><Icon name="left" size={18} /></button>
            <button type="button" className="mc-arrow next" onClick={() => go(1)} aria-label="Next"><Icon name="right" size={18} /></button>
            <span className="mc-count num" aria-live="polite">{idx + 1}/{n}</span>
            <div className="mc-dots" aria-hidden="true">{slides.map((x, k) => <span key={x.id} className={k === idx ? "on" : ""} />)}</div>
          </>
        )}
      </div>
      {thumbs && many && (
        <div className="mc-strip">
          {slides.map((x, k) => (
            <button type="button" key={x.id} className={k === idx ? "on" : ""} onClick={() => setI(k)} aria-label={`Show item ${k + 1}`} aria-current={k === idx ? "true" : undefined}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {x.kind === "image" || x.thumb ? <img src={x.thumb ?? x.src} alt="" /> : <video src={`${x.src}#t=1`} muted preload="metadata" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
