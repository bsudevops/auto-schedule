import Link from "next/link";
import { and, asc, count, desc, eq, gte, inArray, isNull, lt } from "drizzle-orm";
import { Icon } from "@/components/Icon";
import { EmptyState, PlatformBadge, PlatformStack, StatusPill } from "@/components/ui";
import { db } from "@/db";
import { channels, inboxThreads, postTargets, posts, user as userTable, type Platform } from "@/db/schema";
import { fmtDay, fmtTime, fmtWeekdayTime, greeting } from "@/lib/format";
import { can } from "@/lib/permissions";
import { PLATFORMS } from "@/lib/platforms";
import { requireWorkspace } from "@/lib/session";

export const metadata = { title: "Overview" };

export default async function Overview({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const { user, member, workspace } = await requireWorkspace(workspaceId);
  const tz = workspace.timezone;
  const now = new Date();
  const in7 = new Date(now.getTime() + 7 * 86_400_000);
  const ago30 = new Date(now.getTime() - 30 * 86_400_000);
  const ws = eq(posts.workspaceId, workspaceId);

  const [upcoming, failed, recent, chans, [sched7], [pub30], [unread]] = await Promise.all([
    db.select({ id: posts.id, caption: posts.caption, at: posts.scheduledAt, status: posts.status, author: userTable.name })
      .from(posts).leftJoin(userTable, eq(userTable.id, posts.authorId))
      .where(and(ws, eq(posts.status, "scheduled"), gte(posts.scheduledAt, now))).orderBy(asc(posts.scheduledAt)).limit(6),
    db.select({ id: posts.id, caption: posts.caption, error: postTargets.error, platform: channels.platform })
      .from(postTargets).innerJoin(posts, eq(posts.id, postTargets.postId)).innerJoin(channels, eq(channels.id, postTargets.channelId))
      .where(and(ws, eq(postTargets.status, "failed"))).orderBy(desc(posts.scheduledAt)).limit(3),
    db.select({ id: posts.id, caption: posts.caption, at: posts.publishedAt })
      .from(posts).where(and(ws, eq(posts.status, "published"))).orderBy(desc(posts.publishedAt)).limit(3),
    db.select().from(channels).where(and(eq(channels.workspaceId, workspaceId), inArray(channels.status, ["connected", "expiring", "reconnect"]))).orderBy(asc(channels.platform)),
    db.select({ n: count() }).from(posts).where(and(ws, eq(posts.status, "scheduled"), gte(posts.scheduledAt, now), lt(posts.scheduledAt, in7))),
    db.select({ n: count() }).from(posts).where(and(ws, eq(posts.status, "published"), gte(posts.publishedAt, ago30))),
    db.select({ n: count() }).from(inboxThreads).where(and(eq(inboxThreads.workspaceId, workspaceId), eq(inboxThreads.unread, true), isNull(inboxThreads.doneAt))),
  ]);

  const postIds = [...upcoming, ...recent].map((p) => p.id);
  const targetRows = postIds.length
    ? await db.select({ postId: postTargets.postId, platform: channels.platform }).from(postTargets).innerJoin(channels, eq(channels.id, postTargets.channelId)).where(inArray(postTargets.postId, postIds))
    : [];
  const platformsOf = (id: string) => [...new Set(targetRows.filter((t) => t.postId === id).map((t) => t.platform))] as Platform[];
  const title = (caption: string) => (caption.split("\n")[0] || "Untitled post").slice(0, 90);
  const base = `/w/${workspaceId}`;
  const needsChannel = chans.length === 0;
  const attention = [
    ...failed.map((f) => ({ key: `f${f.id}${f.platform}`, tone: "bad" as const, title: `“${title(f.caption)}” failed on ${PLATFORMS[f.platform].name}`, body: f.error ?? "The platform rejected the post.", href: `${base}/calendar`, cta: "Review" })),
    ...chans.filter((c) => c.status !== "connected").map((c) => ({
      key: c.id, tone: c.status === "reconnect" ? ("bad" as const) : ("warn" as const),
      title: c.status === "reconnect" ? `${PLATFORMS[c.platform].name} needs reconnecting` : `${PLATFORMS[c.platform].name} connection expires soon`,
      body: `${workspace.name} · @${c.handle}`, href: `${base}/channels`, cta: c.status === "reconnect" ? "Reconnect" : "Renew",
    })),
    ...((unread?.n ?? 0) > 0 ? [{ key: "inbox", tone: "info" as const, title: `${unread!.n} unread conversation${unread!.n === 1 ? "" : "s"}`, body: "Comments, mentions and messages waiting for a reply.", href: `${base}/inbox`, cta: "Open inbox" }] : []),
  ];

  const kpis = [
    ["Scheduled next 7 days", sched7?.n ?? 0],
    ["Published last 30 days", pub30?.n ?? 0],
    ["Connected channels", chans.length],
    ["Unread conversations", unread?.n ?? 0],
  ] as const;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{greeting(tz)}, {user.name.split(" ")[0]}</h1>
          <p>Here is what is happening in {workspace.name} today, {fmtDay(now, tz)}.</p>
        </div>
        <div className="row">
          <Link className="btn" href={`${base}/calendar`}><Icon name="cal" /> Open calendar</Link>
          {can(member, "create_posts") && <Link className="btn primary" href={`${base}/compose`}><Icon name="plus" /> Create post</Link>}
        </div>
      </div>

      {needsChannel && (
        <div className="banner" style={{ marginBottom: 16 }}>
          <Icon name="link" /> <span style={{ flex: 1, minWidth: 200 }}>Connect your first channel to start scheduling posts for {workspace.name}.</span>
          {can(member, "manage_channels") && <Link className="btn sm primary" href={`${base}/channels`}>Connect a channel</Link>}
        </div>
      )}

      <div className="grid g-4" style={{ marginBottom: 16 }}>
        {kpis.map(([label, v]) => (
          <div key={label} className="card kpi"><div className="label">{label}</div><div className="v num">{v}</div></div>
        ))}
      </div>

      <div className="grid g-main">
        <div className="stack" style={{ gap: 16 }}>
          <section className="card">
            <div className="card-h"><h2>Up next</h2><Link href={`${base}/calendar`} className="btn ghost sm">View calendar</Link></div>
            <div className="card-b" style={{ paddingTop: 6 }}>
              {upcoming.length ? upcoming.map((p) => (
                <div className="li" key={p.id}>
                  <span className="timeline-time num">{fmtWeekdayTime(p.at!, tz)}</span>
                  <div className="grow"><div className="t">{title(p.caption)}</div><div className="s">{p.author ?? "Former member"}</div></div>
                  <PlatformStack platforms={platformsOf(p.id)} />
                  <StatusPill status={p.status} />
                </div>
              )) : <EmptyState title="Nothing scheduled yet" body="Posts you schedule show up here in the order they go out." />}
            </div>
          </section>
          <section className="card">
            <div className="card-h"><h2>Needs attention</h2></div>
            <div className="card-b" style={{ paddingTop: 6 }}>
              {attention.length ? attention.map((a) => (
                <div className="li" key={a.key}>
                  <span className="pf lg" style={{ background: `var(--${a.tone === "info" ? "sky" : a.tone}-50)`, color: `var(--${a.tone === "info" ? "sky-deep" : a.tone})` }}>
                    <Icon name={a.tone === "info" ? "inbox" : a.tone === "warn" ? "clock" : "x"} size={16} />
                  </span>
                  <div className="grow"><div className="t">{a.title}</div><div className="s">{a.body}</div></div>
                  <Link className="btn sm" href={a.href}>{a.cta}</Link>
                </div>
              )) : <EmptyState title="All clear" body="No failed posts, expiring connections or unread messages." />}
            </div>
          </section>
        </div>
        <div className="stack" style={{ gap: 16 }}>
          <section className="card">
            <div className="card-h"><h2>Recently published</h2><Link href={`${base}/analytics`} className="btn ghost sm">See results</Link></div>
            <div className="card-b" style={{ paddingTop: 6 }}>
              {recent.length ? recent.map((p) => (
                <div className="li" key={p.id}>
                  <div className="grow"><div className="t">{title(p.caption)}</div><div className="s">{p.at ? `${fmtDay(p.at, tz)} at ${fmtTime(p.at, tz)}` : ""}</div></div>
                  <PlatformStack platforms={platformsOf(p.id)} />
                </div>
              )) : <EmptyState title="Nothing published yet" body="Published posts and their reach appear here." />}
            </div>
          </section>
          <section className="card">
            <div className="card-h"><h2>Channels</h2><Link href={`${base}/channels`} className="btn ghost sm">Manage</Link></div>
            <div className="card-b" style={{ paddingTop: 8 }}>
              {chans.length ? chans.map((c) => (
                <div className="li" key={c.id}>
                  <PlatformBadge platform={c.platform} large />
                  <div className="grow"><div className="t">{PLATFORMS[c.platform].name}</div><div className="s">@{c.handle}</div></div>
                  <StatusPill status={c.status} />
                </div>
              )) : <EmptyState title="No channels yet" body="Connect Instagram, Facebook, LinkedIn or TikTok to get started." />}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
