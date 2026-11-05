import type { Platform } from "@/db/schema";
import { PLATFORMS } from "@/lib/platforms";
import { PLATFORM_GLYPHS } from "@/lib/platform-glyphs";

/** The platform's own logo, white on its brand colour, so a channel is recognisable at a glance. */
export function PlatformBadge({ platform, large, size }: { platform: Platform; large?: boolean; size?: "xs" }) {
  const p = PLATFORMS[platform];
  return (
    <span className={`pf${large ? " lg" : ""}${size === "xs" ? " xs" : ""}`} data-platform={platform} style={{ background: p.color }} title={p.name} role="img" aria-label={p.name}>
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d={PLATFORM_GLYPHS[platform]} /></svg>
    </span>
  );
}

export function PlatformStack({ platforms, small }: { platforms: Platform[]; small?: boolean }) {
  return (
    <span className="pfs">
      {platforms.map((p) => (
        <PlatformBadge key={p} platform={p} size={small ? "xs" : undefined} />
      ))}
    </span>
  );
}

const AVATAR_COLORS = ["#2B86F5", "#0F9D6B", "#E07A2E", "#6C5BD8", "#D6336C", "#0EA5D8"];
export function Avatar({ name, small }: { name: string; small?: boolean }) {
  const initials = name.split(/\s+/).map((x) => x[0] ?? "").join("").slice(0, 2).toUpperCase();
  const color = AVATAR_COLORS[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_COLORS.length];
  return (
    <span className={`av${small ? " sm" : ""}`} style={{ background: color }} title={name}>
      {initials}
    </span>
  );
}

const STATUS: Record<string, [string, string]> = {
  draft: ["s-draft", "Draft"],
  scheduled: ["s-scheduled", "Scheduled"],
  publishing: ["s-approved", "Publishing"],
  published: ["s-published", "Published"],
  partially_failed: ["s-review", "Partly failed"],
  failed: ["s-failed", "Failed"],
  connected: ["s-published", "Connected"],
  expiring: ["s-review", "Expires soon"],
  reconnect: ["s-failed", "Reconnect"],
  disconnected: ["s-draft", "Disconnected"],
};
export function StatusPill({ status }: { status: string }) {
  const [cls, label] = STATUS[status] ?? ["s-draft", status];
  return <span className={`pill ${cls}`}>{label}</span>;
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="empty stack" style={{ alignItems: "center" }}>
      <b style={{ color: "var(--ink)" }}>{title}</b>
      <p style={{ maxWidth: "46ch" }}>{body}</p>
      {action}
    </div>
  );
}
