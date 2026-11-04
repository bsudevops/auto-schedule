import type { Platform } from "@/db/schema";
import { PLATFORMS } from "@/lib/platforms";

export function PlatformBadge({ platform, large }: { platform: Platform; large?: boolean }) {
  const p = PLATFORMS[platform];
  return (
    <span className={`pf${large ? " lg" : ""}`} style={{ background: p.color }} title={p.name}>
      {p.short}
    </span>
  );
}

export function PlatformStack({ platforms }: { platforms: Platform[] }) {
  return (
    <span className="pfs">
      {platforms.map((p) => (
        <PlatformBadge key={p} platform={p} />
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
