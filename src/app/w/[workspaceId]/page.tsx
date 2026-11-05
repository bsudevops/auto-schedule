import Link from "next/link";
import { and, asc, count, desc, eq, gte, inArray, isNull, lt } from "drizzle-orm";
import { ActivityList } from "@/components/ActivityList";
import { Icon } from "@/components/Icon";
import { EmptyState, PlatformBadge, PlatformStack, StatusPill } from "@/components/ui";
import { db } from "@/db";
import { channels, inboxThreads, mediaAssets, postMedia, postTargets, posts, user as userTable, type Platform } from "@/db/schema";
import { recentActivity } from "@/lib/activity";
import { addDays, localParts } from "@/lib/calendar";
import { fmtDay, fmtTime, greeting } from "@/lib/format";
import { publicUrl } from "@/lib/media/storage";
import { thumbKey } from "@/lib/media/service";
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
  const monthStart = new Date(now.getTime() - 30 * 86_400_000);
  const ws = eq(posts.workspaceId, workspaceId);

  const [upcoming, failed, recent, chans, [pub30], [unread], activity, perChannel] = await Promise.all([
    db.select({ id: posts.id, caption: posts.caption, at: posts.scheduledAt, status: posts.status, author: userTable.name })
      .from(posts).leftJoin(userTable, eq(userTable.id, posts.authorId))
      .where(and(ws, eq(posts.status, "scheduled"), gte(posts.scheduledAt, now), lt(posts.scheduledAt, in7))).orderBy(asc(posts.scheduledAt)).limit(60),
    db.select({ id: posts.id, caption: posts.caption, error: postTargets.error, platform: channels.platform })
      .from(postTargets).innerJoin(posts, eq(posts.id, postTargets.postId)).innerJoin(channels, eq(channels.id, postTargets.channelId))
      .where(and(ws, eq(postTargets.status, "failed"))).orderBy(desc(posts.scheduledAt)).limit(3),
    db.select({ id: posts.id, caption: posts.caption, at: posts.publishedAt })
      .from(posts).where(and(ws, eq(posts.status, "published"))).orderBy(desc(posts.publishedAt)).limit(4),
    db.select().from(channels).where(and(eq(channels.workspaceId, workspaceId), inArray(channels.status, ["connected", "expiring", "reconnect"]))).orderBy(asc(channels.platform)),
    db.select({ n: count() }).from(posts).where(and(ws, eq(posts.status, "published"), gte(posts.publishedAt, ago30))),
    db.select({ n: count() }).from(inboxThreads).where(and(eq(inboxThreads.workspaceId, workspaceId), eq(inboxThreads.unread, true), isNull(inboxThreads.doneAt))),
    recentActivity(workspaceId, { limit: 6 }),
    db.select({ channelId: postTargets.channelId, n: count() }).from(postTargets).innerJoin(channels, eq(channels.id, postTargets.channelId))
      .where(and(eq(channels.workspaceId, workspaceId), eq(postTargets.status, "published"), gte(postTargets.publishedAt, monthStart))).groupBy(postTargets.channelId),
  ]);

  const postIds = [...upcoming, ...recent].map((p) => p.id);
  const recentIds = recent.map((p) => p.id);
  const [targetRows, covers] = await Promise.all([
    postIds.length
      ? db.select({ postId: postTargets.postId, platform: channels.platform, url: postTargets.externalUrl }).from(postTargets).innerJoin(channels, eq(channels.id, postTargets.channelId)).where(inArray(postTargets.postId, postIds))
      : [],
    recentIds.length
      ? db.select({ postId: postMedia.postId, position: postMedia.position, key: mediaAssets.storageKey, kind: mediaAssets.kind }).from(postMedia).innerJoin(mediaAssets, eq(mediaAssets.id, postMedia.assetId)).where(inArray(postMedia.postId, recentIds))
      : [],
  ]);
  const platformsOf = (id: string) => [...new Set(targetRows.filter((t) => t.postId === id).map((t) => t.platform))] as Platform[];
  const linkOf = (id: string) => targetRows.find((t) => t.postId === id && t.url);
  const coverOf = (id: string) => covers.filter((c) => c.postId === id).sort((a, b) => a.position - b.position)[0];
  const title = (caption: string) => (caption.split("\n")[0] || "Untitled post").slice(0, 90);
  const base = `/w/${workspaceId}`;
  const canCreate = can(member, "create_posts");
  const needsChannel = chans.length === 0;

  const attention = [
    ...failed.map((f) => ({ key: `f${f.id}${f.platform}`, tone: "bad" as const, title: `“${title(f.caption)}” failed on ${PLATFORMS[f.platform].name}`, body: f.error ?? "The platform rejected the post.", href: `${base}/calendar`, cta: "Review" })),
    ...chans.filter((c) => c.status !== "connected").map((c) => ({
      key: c.id, tone: c.status === "reconnect" ? ("bad" as const) : ("warn" as const),
      title: c.status === "reconnect" ? `${PLATFORMS[c.platform].name} needs reconnecting` : `${PLATFORMS[c.platform].name} connection expires soon`,
      body: `@${c.handle} in ${workspace.name}`, href: `${base}/channels`, cta: c.status === "reconnect" ? "Reconnect" : "Renew",
    })),
    ...((unread?.n ?? 0) > 0 ? [{ key: "inbox", tone: "info" as const, title: `${unread!.n} unread conversation${unread!.n === 1 ? "" : "s"}`, body: "Comments, mentions and messages waiting for a reply.", href: `${base}/inbox`, cta: "Open inbox" }] : []),
  ];

  // The next seven days in the workspace's time zone, each with the posts going out that day.
  const today = localParts(now, tz).date;
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  const byDay = new Map(days.map((d) => [d, [] as typeof upcoming]));
  for (const p of upcoming) byDay.get(localParts(p.at!, tz).date)?.push(p);
  const dayName = (d: string, i: number) =>
    i === 0 ? "Today" : i === 1 ? "Tomorrow" : new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
  const followers = chans.reduce((n, c) => n + (c.followers ?? 0), 0);

  const kpis = [
    ["Scheduled next 7 days", upcoming.length],
    ["Published last 30 days", pub30?.n ?? 0],
    ["Connected channels", chans.length],
    ["Unread conversations", unread?.n ?? 0],
  ] as const;

  return (
    <div className="ov">
      <div className="page-head">
        <div>
          <h1>{greeting(tz)}, {user.name.split(" ")[0]}</h1>
          <p>Here is what is happening in {workspace.name} today, {fmtDay(now, tz)}.</p>
        </div>
        <div className="row">
          <Link className="btn" href={`${base}/calendar`}><Icon name="cal" /> Open calendar</Link>
          {canCreate && <Link className="btn primary" href={`${base}/compose`}><Icon name="plus" /> Create post</Link>}
        </div>
      </div>

      {needsChannel && (
        <div className="banner">
          <Icon name="link" /> <span style={{ flex: 1, minWidth: 200 }}>Connect your first channel to start scheduling posts for {workspace.name}.</span>
          {can(member, "manage_channels") && <Link className="btn sm primary" href={`${base}/channels`}>Connect a channel</Link>}
        </div>
      )}

      {attention.length > 0 && (
        <section className="ov-alerts" aria-labelledby="ov-attention">
          <h2 id="ov-attention" className="sr-only">Needs attention</h2>
          {attention.map((a) => (
            <div className={`ov-alert ${a.tone}`} key={a.key}>
              <Icon name={a.tone === "info" ? "inbox" : a.tone === "warn" ? "clock" : "x"} size={16} />
              <div className="grow"><b>{a.title}</b> <span className="muted">{a.body}</span></div>
              <Link className="btn sm" href={a.href}>{a.cta}</Link>
            </div>
          ))}
        </section>
      )}

      <section className="ov-stats card" aria-label="This workspace at a glance">
        {kpis.map(([label, v]) => (
          <div key={label} className="ov-stat"><div className="v num">{v}</div><div className="label">{label}</div></div>
        ))}
        <div className="ov-stat"><div className="v num">{followers.toLocaleString("en-US")}</div><div className="label">Followers across channels</div></div>
      </section>

      <div className="ov-grid">
        <section className="card ov-week" aria-labelledby="ov-next">
          <div className="card-h"><h2 id="ov-next">Up next</h2><Link href={`${base}/calendar?view=week`} className="btn ghost sm">View calendar</Link></div>
          <div className="ov-days">
            {days.map((d, i) => {
              const ps = byDay.get(d)!;
              return (
                <div className={`ov-day${i === 0 ? " today" : ""}`} key={d}>
                  <div className="ov-day-h">
                    <span><b>{dayName(d, i)}</b> <span className="muted num">{Number(d.slice(8))}</span></span>
                    {canCreate && <Link className="day-add" href={`${base}/compose?date=${d}`} aria-label={`Create a post on ${dayName(d, i)}`} title="Create a post on this day"><Icon name="plus" size={14} /></Link>}
                  </div>
                  {ps.length ? ps.map((p) => (
                    <Link className="ov-post" key={p.id} href={`${base}/posts/${p.id}`} title={`${title(p.caption)}, by ${p.author ?? "a former member"}`}>
                      <span className="tm num"><PlatformStack platforms={platformsOf(p.id)} small />{fmtTime(p.at!, tz)}</span>
                      <span className="tt">{title(p.caption)}</span>
                    </Link>
                  )) : <span className="ov-free">Nothing yet</span>}
                </div>
              );
            })}
          </div>
        </section>

        <section className="card ov-channels" aria-labelledby="ov-ch">
          <div className="card-h"><h2 id="ov-ch">Channels</h2><Link href={`${base}/channels`} className="btn ghost sm">Manage</Link></div>
          <div className="card-b" style={{ paddingTop: 4 }}>
            {chans.length ? chans.map((c) => (
              <div className="li" key={c.id}>
                <PlatformBadge platform={c.platform} large />
                <div className="grow"><div className="t">{c.displayName || PLATFORMS[c.platform].name}</div><div className="s">@{c.handle}</div></div>
                <div className="ov-ch-n">
                  <span><b className="num">{(c.followers ?? 0).toLocaleString("en-US")}</b> followers</span>
                  <span><b className="num">{perChannel.find((m) => m.channelId === c.id)?.n ?? 0}</b> posts in 30 days</span>
                </div>
                <StatusPill status={c.status} />
              </div>
            )) : <EmptyState title="No channels yet" body="Connect a social account to get started." />}
          </div>
        </section>

        <section className="card ov-recent" aria-labelledby="ov-pub">
          <div className="card-h"><h2 id="ov-pub">Recently published</h2><Link href={`${base}/analytics`} className="btn ghost sm">See results</Link></div>
          <div className="card-b">
            {recent.length ? (
              <div className="ov-tiles">
                {recent.map((p) => {
                  const cover = coverOf(p.id);
                  const live = linkOf(p.id);
                  return (
                    <article className="ov-tile" key={p.id}>
                      <Link href={`${base}/posts/${p.id}`} className="ov-cover" aria-label={title(p.caption)}>
                        {cover ? (cover.kind === "image"
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={publicUrl(thumbKey(cover.key, cover.kind))} alt="" loading="lazy" />
                          : <video src={`${publicUrl(cover.key)}#t=1`} muted preload="metadata" />)
                          : <span className="ov-cover-text">{title(p.caption)}</span>}
                        <span className="ov-cover-pf"><PlatformStack platforms={platformsOf(p.id)} /></span>
                      </Link>
                      <div className="ov-tile-b">
                        <Link href={`${base}/posts/${p.id}`} className="t">{title(p.caption)}</Link>
                        <span className="s">{p.at ? `${fmtDay(p.at, tz)} at ${fmtTime(p.at, tz)}` : ""}</span>
                        {live?.url && <a href={live.url} target="_blank" rel="noreferrer" className="ov-live">View on {PLATFORMS[live.platform].name}</a>}
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : <EmptyState title="Nothing published yet" body="Published posts and their reach appear here." />}
          </div>
        </section>

        <section className="card ov-activity" aria-labelledby="ov-act">
          <div className="card-h"><h2 id="ov-act">Team activity</h2><Link href={`${base}/activity`} className="btn ghost sm">See all</Link></div>
          <div className="card-b" style={{ paddingTop: 4 }}>
            {activity.length ? <ActivityList entries={activity} timeZone={tz} /> : <EmptyState title="No activity yet" body="Posts, channels and team changes show up here as they happen." />}
          </div>
        </section>
      </div>
    </div>
  );
}
