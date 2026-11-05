import { and, asc, desc, eq, inArray } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { channels, mediaAssets, postMedia, postMetrics, postTargets, posts, publishLog, user as userTable } from "@/db/schema";
import { ActivityList } from "@/components/ActivityList";
import { AutoRefresh } from "@/components/AutoRefresh";
import { Icon } from "@/components/Icon";
import { PlatformBadge, StatusPill } from "@/components/ui";
import { recentActivity } from "@/lib/activity";
import { publicUrl } from "@/lib/media/storage";
import { thumbKey } from "@/lib/media/service";
import { can } from "@/lib/permissions";
import { PLATFORMS } from "@/lib/platforms";
import { requireWorkspace } from "@/lib/session";
import { YT_CATEGORIES, YT_LANGUAGES, youtubeOptions, youtubeTitle } from "@/lib/youtube-options";
import { Composer } from "../../compose/Composer";
import { loadComposer } from "../../compose/load";
import { CheckNowButton } from "./CheckNowButton";
import { RetryButton } from "./RetryButton";

export const metadata = { title: "Post" };

const LIVE = new Set(["publishing", "published", "failed", "partially_failed"]);
const VISIBILITY = { public: "Public", unlisted: "Unlisted", private: "Private" } as const;

export default async function Page({ params }: { params: Promise<{ workspaceId: string; postId: string }> }) {
  const { workspaceId, postId } = await params;
  const { member, workspace } = await requireWorkspace(workspaceId);
  if (!/^[0-9a-f-]{36}$/i.test(postId)) notFound();
  const [post] = await db.select().from(posts).where(and(eq(posts.id, postId), eq(posts.workspaceId, workspaceId)));
  if (!post) notFound();

  // A post that's due any second is about to be picked up, so show its progress instead of the editor.
  const due = post.status === "scheduled" && post.scheduledAt !== null && post.scheduledAt.getTime() <= Date.now() + 30_000;
  if (!LIVE.has(post.status) && !due) {
    const props = await loadComposer({ member, workspace, postId });
    if (!props) notFound();
    return <Composer {...props} />;
  }

  const base = `/w/${workspaceId}`;
  const href = `${base}/posts/${post.id}`;
  const [targets, media, [author], activity] = await Promise.all([
    db.select({ target: postTargets, channel: channels, metrics: postMetrics })
      .from(postTargets)
      .innerJoin(channels, eq(channels.id, postTargets.channelId))
      .leftJoin(postMetrics, eq(postMetrics.targetId, postTargets.id))
      .where(eq(postTargets.postId, post.id))
      .orderBy(asc(channels.platform)),
    db.select({ asset: mediaAssets }).from(postMedia).innerJoin(mediaAssets, eq(mediaAssets.id, postMedia.assetId)).where(eq(postMedia.postId, post.id)).orderBy(asc(postMedia.position)),
    post.authorId ? db.select({ name: userTable.name }).from(userTable).where(eq(userTable.id, post.authorId)) : Promise.resolve([]),
    recentActivity(workspaceId, { href, limit: 10 }),
  ]);
  const logs = targets.length
    ? await db.select().from(publishLog).where(inArray(publishLog.targetId, targets.map((t) => t.target.id))).orderBy(desc(publishLog.createdAt)).limit(20)
    : [];

  const tz = workspace.timezone;
  const fmt = (d: Date | null) => (d ? new Intl.DateTimeFormat("en-US", { timeZone: tz, dateStyle: "medium", timeStyle: "short" }).format(d) : "");
  const failed = targets.filter((t) => t.target.status === "failed").length;
  const isTest = (id: string | null) => !!id?.startsWith("dry-run-");
  const yt = targets.find((t) => t.channel.platform === "youtube");
  const ytOpts = yt ? youtubeOptions.safeParse(yt.target.options ?? {}) : null;
  const o = ytOpts?.success ? ytOpts.data : null;
  const ytCaption = yt ? yt.target.captionOverride ?? post.caption : post.caption;
  const heading = o ? o.title || youtubeTitle(ytCaption) : (post.caption.split("\n")[0] || "Untitled post").slice(0, 120);
  const thumb = o?.thumbnailAssetId ? (await db.select().from(mediaAssets).where(and(eq(mediaAssets.id, o.thumbnailAssetId), eq(mediaAssets.workspaceId, workspaceId))))[0] : undefined;
  const live = targets.find((t) => t.target.externalUrl && !t.target.removedAt);
  const removed = targets.filter((t) => t.target.removedAt);
  const allTest = targets.length > 0 && targets.every((t) => t.target.status !== "published" || isTest(t.target.externalPostId));
  const cover = media[0]?.asset;
  const logChannel = (targetId: string) => targets.find((t) => t.target.id === targetId)?.channel;

  const when = post.status === "publishing" || due ? "Publishing now. This page follows each channel's progress." : post.publishedAt ? `Published ${fmt(post.publishedAt)}` : `Planned for ${fmt(post.scheduledAt)}`;

  return (
    <div className="pd">
      {(post.status === "publishing" || due) && <AutoRefresh />}
      <Link href={`${base}/calendar`} className="pd-back"><Icon name="cal" size={14} /> Calendar</Link>

      <header className="pd-head">
        <div className="pd-title">
          <h1>{heading}</h1>
          <div className="pd-meta">
            <StatusPill status={post.status} />
            {removed.length > 0 && <StatusPill status="removed" />}
            {post.status === "published" && allTest && <StatusPill status="test" />}
            <span className="muted">{when}{author ? `, by ${author.name}` : ""}</span>
          </div>
        </div>
        <div className="pd-actions">
          {live?.target.externalUrl && !isTest(live.target.externalPostId) && (
            <a className="btn primary" href={live.target.externalUrl} target="_blank" rel="noopener noreferrer"><PlatformBadge platform={live.channel.platform} size="xs" /> Open on {PLATFORMS[live.channel.platform].name}</a>
          )}
          {post.status === "published" && !allTest && <CheckNowButton workspaceId={workspaceId} postId={post.id} />}
          {failed > 0 && can(member, "publish") && <RetryButton workspaceId={workspaceId} postId={post.id} count={failed} />}
          {can(member, "create_posts") && <Link className="btn" href={`${base}/compose?from=${post.id}`}><Icon name="plus" /> Duplicate</Link>}
        </div>
      </header>

      {removed.map(({ target: t, channel: c }) => (
        <div className="ov-alert bad" key={`gone-${t.id}`} role="status">
          <Icon name="trash" size={16} />
          <div className="grow"><b>{t.removedReason ?? `Deleted on ${PLATFORMS[c.platform].name}`}</b> <span className="muted">Noticed {fmt(t.removedAt)}. The post stays here for your records; Duplicate sends it again.</span></div>
        </div>
      ))}
      {post.status === "published" && allTest && (
        <div className="banner"><Icon name="eye" /> <span>This was a test run: the app was in dry-run mode, so nothing was sent to {targets.map((t) => PLATFORMS[t.channel.platform].name).join(" or ")}. Duplicate it to send it for real.</span></div>
      )}

      <div className="pd-grid">
        <div className="pd-main">
          <section className="card pd-media" aria-label="Media">
            {cover ? (cover.kind === "video"
              ? <video src={publicUrl(cover.storageKey)} controls preload="metadata" poster={thumb ? publicUrl(thumb.storageKey) : undefined} />
              // eslint-disable-next-line @next/next/no-img-element
              : <img src={publicUrl(cover.storageKey)} alt={cover.altText || ""} />)
              : <div className="pd-nomedia">No media. This post is text only.</div>}
            {media.length > 1 && (
              <div className="pd-strip">
                {media.slice(1).map(({ asset: a }) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={a.id} src={publicUrl(thumbKey(a.storageKey, a.kind))} alt={a.altText || a.filename} />
                ))}
              </div>
            )}
          </section>

          <section className="card card-b stack" aria-labelledby="pd-caption">
            <h2 id="pd-caption">{o ? "Description" : "Caption"}</h2>
            <p className="pd-text">{(o ? ytCaption : post.caption) || <span className="muted">No caption.</span>}</p>
            {post.firstComment && (<><h3>First comment</h3><p className="pd-text">{post.firstComment}</p></>)}
            {targets.filter((t) => t.target.captionOverride != null && t !== yt).map((t) => (
              <div key={t.target.id} className="stack" style={{ gap: 4 }}>
                <h3 className="row" style={{ gap: 6 }}><PlatformBadge platform={t.channel.platform} size="xs" /> {PLATFORMS[t.channel.platform].name} version</h3>
                <p className="pd-text">{t.target.captionOverride}</p>
              </div>
            ))}
          </section>

          {o && (
            <section className="card card-b" aria-labelledby="pd-yt">
              <h2 id="pd-yt" className="row" style={{ gap: 8, marginBottom: 12 }}><PlatformBadge platform="youtube" size="xs" /> YouTube settings used</h2>
              <dl className="pd-facts">
                <div><dt>Visibility</dt><dd>{VISIBILITY[o.visibility]}</dd></div>
                <div><dt>Audience</dt><dd>{o.madeForKids ? "Made for kids" : "Not made for kids"}</dd></div>
                <div><dt>Category</dt><dd>{YT_CATEGORIES[o.categoryId] ?? o.categoryId}</dd></div>
                <div><dt>Thumbnail</dt><dd>{thumb ? thumb.filename : "Auto-generated by YouTube"}</dd></div>
                <div><dt>Playlist</dt><dd>{o.playlistId ? "Added to a playlist" : "None"}</dd></div>
                <div><dt>Language</dt><dd>{o.language ? YT_LANGUAGES[o.language] ?? o.language : "Not set"}</dd></div>
                <div><dt>Paid promotion</dt><dd>{o.paidPromotion ? "Yes" : "No"}</dd></div>
                <div><dt>Altered content</dt><dd>{o.alteredContent ? "Yes" : "No"}</dd></div>
                <div className="wide"><dt>Tags</dt><dd>{o.tags.length ? o.tags.join(", ") : "None"}</dd></div>
              </dl>
            </section>
          )}
        </div>

        <aside className="pd-side">
          <section className="card card-b stack" aria-labelledby="pd-ch">
            <h2 id="pd-ch">Channels</h2>
            {targets.map(({ target: t, channel: c, metrics: m }) => {
              const test = isTest(t.externalPostId);
              const status = t.removedAt ? "removed" : test && t.status === "published" ? "test" : t.status === "pending" ? "scheduled" : t.status;
              const figures = m ? ([["Views", m.videoViews ?? m.impressions], ["Likes", m.likes], ["Comments", m.comments]] as const).filter(([, v]) => v != null) : [];
              return (
                <div key={t.id} className={`pd-target${t.removedAt ? " removed" : ""}`} data-target={c.handle}>
                  <div className="row" style={{ gap: 10, alignItems: "flex-start" }}>
                    <PlatformBadge platform={c.platform} large />
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 6 }}>
                        <b>{c.displayName}</b>
                        <StatusPill status={status} />
                      </div>
                      <div className="muted" style={{ fontSize: 12.5 }}>{PLATFORMS[c.platform].name}, @{c.handle}{t.attempts > 1 ? `, ${t.attempts} attempts` : ""}</div>
                    </div>
                  </div>
                  {figures.length > 0 && !t.removedAt && (
                    <div className="pd-figs">{figures.map(([k, v]) => <div key={k}><b className="num">{v!.toLocaleString("en-US")}</b><span>{k}</span></div>)}</div>
                  )}
                  {t.removedAt && <p className="err" style={{ fontSize: 13 }}>{t.removedReason ?? "No longer on the platform"}, noticed {fmt(t.removedAt)}.</p>}
                  {t.error && <p className={t.status === "failed" ? "err" : "muted"} style={{ fontSize: 13 }}>{t.error}</p>}
                  {t.status === "failed" && c.status === "reconnect" && <Link href={`${base}/channels`} style={{ fontSize: 13 }}>Reconnect {PLATFORMS[c.platform].name}</Link>}
                  {t.externalUrl && !t.removedAt && !test && <a href={t.externalUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, fontWeight: 600 }}>View on {PLATFORMS[c.platform].name}</a>}
                  {t.externalPostId && !test && <span className="muted mono" style={{ fontSize: 11.5 }}>ID {t.externalPostId}</span>}
                </div>
              );
            })}
            {targets.length === 0 && <p className="muted">This post had no channels, so nothing was sent.</p>}
          </section>

          <section className="card card-b stack" aria-labelledby="pd-log">
            <h2 id="pd-log">History</h2>
            <ol className="pd-timeline">
              {removed.map(({ target: t, channel: c }) => (
                <li key={`r${t.id}`} className="bad"><b>{t.removedReason ?? `Deleted on ${PLATFORMS[c.platform].name}`}</b><span>{fmt(t.removedAt)}</span></li>
              ))}
              {logs.map((l) => {
                const c = logChannel(l.targetId);
                const d = (l.detail ?? {}) as { warnings?: string[]; error?: string; attempt?: number };
                return (
                  <li key={l.id} className={l.ok ? "ok" : "bad"}>
                    <b>{l.ok ? "Sent" : "Failed"} to {c ? PLATFORMS[c.platform].name : "a channel"}{d.attempt && d.attempt > 1 ? ` (attempt ${d.attempt})` : ""}</b>
                    <span>{fmt(l.createdAt)}</span>
                    {d.error && <small className="err">{d.error}</small>}
                    {(d.warnings ?? []).map((w) => <small key={w} className="muted">{w}</small>)}
                  </li>
                );
              })}
              {post.scheduledAt && <li><b>Scheduled</b><span>{fmt(post.scheduledAt)}</span></li>}
              <li><b>Created{author ? ` by ${author.name}` : ""}</b><span>{fmt(post.createdAt)}</span></li>
            </ol>
          </section>

          {activity.length > 0 && (
            <section className="card card-b" aria-labelledby="pd-team">
              <h2 id="pd-team" style={{ marginBottom: 6 }}>Team activity</h2>
              <ActivityList entries={activity} timeZone={tz} />
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
