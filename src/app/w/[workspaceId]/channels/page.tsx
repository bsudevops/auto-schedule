import { and, asc, count, eq, gte } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/db";
import { channels, postTargets } from "@/db/schema";
import { Icon } from "@/components/Icon";
import { EmptyState, PlatformBadge, StatusPill } from "@/components/ui";
import { can } from "@/lib/permissions";
import { PLATFORMS } from "@/lib/platforms";
import { PROVIDERS, RATE_LIMITS, providerFor } from "@/lib/publishing";
import { dryRun } from "@/lib/publishing/run";
import { slotsUsed } from "@/lib/publishing/rate-limit";
import { requireWorkspace } from "@/lib/session";
import { ChannelButtons } from "./ChannelButtons";
import { ConnectList, type ConnectOption } from "./ConnectList";

export const metadata = { title: "Channels" };

const ERRORS: Record<string, string> = {
  cancelled: "The connection was cancelled on the platform's site. Nothing was added.",
  forbidden: "Only owners and managers can connect channels.",
  not_configured: "That platform isn't set up yet. Add its app credentials to the server's environment first.",
  connect_expired: "That connection attempt expired. Start again.",
  no_accounts: "The platform didn't return any accounts you can post to. For Instagram, the account must be a business or creator account linked to a Facebook Page.",
  context: "We couldn't reach that server. Check the address and try again.",
  failed: "The platform didn't accept the connection. Try again, and check the server logs if it keeps failing.",
};

/** Pages, boards and locations are names, not @handles. */
function shownHandle(platform: string, handle: string) {
  return ["facebook", "google_business", "pinterest", "youtube"].includes(platform) || handle.startsWith("@") ? handle : `@${handle}`;
}

const HINTS: Record<string, string> = {
  bluesky: "Connects with an app password",
  devto: "Connects with an API key",
  mastodon: "Asks for your server, then you sign in there",
};

function relative(d: Date | null) {
  if (!d) return "Hasn't published yet.";
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  return days <= 0 ? "Last published today." : `Last published ${days} day${days === 1 ? "" : "s"} ago.`;
}

export default async function Page({ params, searchParams }: { params: Promise<{ workspaceId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { workspaceId } = await params;
  const sp = await searchParams;
  const { member, workspace } = await requireWorkspace(workspaceId);
  const manage = can(member, "manage_channels");
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const [rows, monthly] = await Promise.all([
    db.select().from(channels).where(eq(channels.workspaceId, workspaceId)).orderBy(asc(channels.platform), asc(channels.handle)),
    db
      .select({ channelId: postTargets.channelId, n: count() })
      .from(postTargets)
      .innerJoin(channels, eq(channels.id, postTargets.channelId))
      .where(and(eq(channels.workspaceId, workspaceId), eq(postTargets.status, "published"), gte(postTargets.publishedAt, monthStart)))
      .groupBy(postTargets.channelId),
  ]);
  const active = rows.filter((c) => c.status !== "disconnected");
  const gone = rows.filter((c) => c.status === "disconnected");
  const usage = await Promise.all(
    active.map(async (c) => {
      const limit = RATE_LIMITS[c.platform];
      if (!limit) return null;
      try {
        return { used: await slotsUsed(c.id, limit), ...limit };
      } catch {
        return null; // Redis unavailable: just leave the figure out
      }
    }),
  );
  const options: ConnectOption[] = Object.values(PROVIDERS).map((p) => ({
    id: p.id,
    name: p.name,
    platforms: p.platforms,
    configured: p.configured(),
    envVars: p.envVars,
    kind: p.connect === "credentials" ? "credentials" : p.contextFields ? "context" : "oauth",
    fields: p.fields ?? p.contextFields ?? [],
    hint: HINTS[p.id],
  }));
  const connectHref = (platform: (typeof rows)[number]["platform"]) => {
    const p = providerFor(platform);
    return p ? `/api/w/${workspaceId}/channels/connect/${p.id}` : null;
  };
  const errorMsg = sp.error && sp.error !== "context" ? ERRORS[sp.error] ?? ERRORS.failed : null;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Channels</h1>
          <p>Social accounts connected to {workspace.name}. Each one uses the platform&apos;s official API.</p>
        </div>
      </div>

      {dryRun() && (
        <div className="banner" style={{ marginBottom: 16 }}>
          <Icon name="shield" /> Dry run is on. Scheduled posts are marked as published without being sent to any platform.
        </div>
      )}
      {errorMsg && <div className="banner" role="alert" style={{ marginBottom: 16, background: "var(--bad-50)", color: "var(--bad)" }}>{errorMsg}</div>}
      {sp.connected && <div className="banner" role="status" style={{ marginBottom: 16, background: "var(--ok-50)", color: "var(--ok)" }}>{sp.connected === "0" ? "No accounts were added." : `${sp.connected} channel${sp.connected === "1" ? "" : "s"} connected.`}</div>}

      {active.length === 0 ? (
        <div className="card">
          <EmptyState title="No channels yet" body="Connect a social account below to start publishing from this workspace." />
        </div>
      ) : (
        <div className="grid g-2">
          {active.map((c, i) => {
            const u = usage[i];
            const href = connectHref(c.platform);
            const posted = monthly.find((m) => m.channelId === c.id)?.n ?? 0;
            return (
              <div className="card card-b" key={c.id} data-channel={c.handle}>
                <div className="row" style={{ alignItems: "flex-start" }}>
                  <PlatformBadge platform={c.platform} large />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
                      <h3>{c.displayName}</h3>
                      <StatusPill status={c.status} />
                    </div>
                    <div className="muted" style={{ fontSize: 13 }}>
                      {PLATFORMS[c.platform].name} · {shownHandle(c.platform, c.handle)} · {c.lastError ?? relative(c.lastPublishedAt)}
                    </div>
                    <div className="row" style={{ gap: 18, marginTop: 12, flexWrap: "wrap", fontSize: 12.5 }}>
                      {c.followers != null && (
                        <span><b className="num">{c.followers.toLocaleString("en-US")}</b> <span className="muted">followers</span></span>
                      )}
                      <span><b className="num">{posted}</b> <span className="muted">posts this month</span></span>
                      {u && <span className="muted">Posting limit: {u.used}/{u.max} per {u.windowSec >= 86_400 ? "day" : "hour"}</span>}
                    </div>
                    {manage && <ChannelButtons workspaceId={workspaceId} channelId={c.id} name={c.displayName} reconnectHref={href} status={c.status} />}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="card card-b" style={{ marginTop: 16 }}>
        <h3>Connect a channel</h3>
        <p className="muted" style={{ fontSize: 13 }}>
          {manage ? "Most platforms ask you to sign in on their own site. Bluesky and DEV.to use an app password or API key instead, and Mastodon asks for your server first. You then choose which accounts to add." : "Ask an owner or manager to connect channels."}
        </p>
        <ConnectList
          workspaceId={workspaceId}
          options={options}
          manage={manage}
          open={sp.connect}
          contextError={sp.error === "context" ? sp.detail?.slice(0, 200) ?? ERRORS.context : undefined}
        />
      </div>

      {gone.length > 0 && (
        <div className="card card-b" style={{ marginTop: 16 }}>
          <h3>Disconnected</h3>
          <p className="muted" style={{ fontSize: 13 }}>These channels no longer publish. Their post history is kept until you remove them.</p>
          <div className="stack" style={{ marginTop: 10 }}>
            {gone.map((c) => (
              <div className="row" key={c.id} style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
                <div className="row"><PlatformBadge platform={c.platform} /> <span>{c.displayName}</span></div>
                {manage && <ChannelButtons workspaceId={workspaceId} channelId={c.id} name={c.displayName} reconnectHref={connectHref(c.platform)} status={c.status} />}
              </div>
            ))}
          </div>
        </div>
      )}
      <p className="muted" style={{ fontSize: 12.5, marginTop: 16 }}>
        Want to change when queued posts go out? <Link href={`/w/${workspaceId}/calendar`}>Edit queues on the calendar</Link>.
      </p>
    </>
  );
}
