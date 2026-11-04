import { PlatformBadge } from "@/components/ui";
import { BRAND } from "@/lib/brand";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";

const SHOWN = ["facebook", "instagram", "linkedin", "tiktok", "youtube", "pinterest", "threads", "bluesky", "google_business", "mastodon", "devto"] as const;

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  if (await getSessionUser()) redirect("/");
  return (
    <div className="auth">
      <div className="auth-art">
        <div className="row">
          <div className="logo" style={{ background: "#fff", color: "var(--sky-deep)" }}>{BRAND.name[0]}</div>
          <b style={{ fontFamily: "var(--f-display)", fontSize: 20 }}>{BRAND.name}</b>
        </div>
        <div>
          <h1>Plan, schedule and publish for every client in one place.</h1>
          <p style={{ opacity: 0.85, marginTop: 12, maxWidth: "40ch" }}>
            Eleven networks, unlimited workspaces, and one inbox for every comment and message.
          </p>
        </div>
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          {SHOWN.map((p) => <PlatformBadge key={p} platform={p} />)}
        </div>
      </div>
      <div className="auth-form">{children}</div>
    </div>
  );
}
