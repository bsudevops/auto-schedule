import { BrandLogo } from "@/components/BrandLogo";

/**
 * Shown while a page's data loads: the logo floats with three post cards drifting around it.
 * It fades in after a short delay, so quick pages never flash it. Motion stops for people who ask for less.
 */
export function FloatingLoader({ label = "Loading…", full = false }: { label?: string; full?: boolean }) {
  return (
    <div className={`floating-loader${full ? " full" : ""}`} role="status" aria-live="polite">
      <div className="fl-stage" aria-hidden="true">
        <span className="fl-glow" />
        <span className="fl-card c1"><i style={{ background: "var(--ig-gradient)" }} /><b /><b className="short" /></span>
        <span className="fl-card c2"><i style={{ background: "#FF0033" }} /><b /><b className="short" /></span>
        <span className="fl-card c3"><i style={{ background: "#1877F2" }} /><b /><b className="short" /></span>
        <span className="fl-logo"><BrandLogo size={56} /></span>
        <span className="fl-shadow" />
      </div>
      <p className="fl-label">
        {label}
      </p>
    </div>
  );
}
