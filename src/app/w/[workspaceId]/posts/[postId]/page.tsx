import { and, asc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { channels, postTargets, posts } from "@/db/schema";
import { AutoRefresh } from "@/components/AutoRefresh";
import { PlatformBadge, StatusPill } from "@/components/ui";
import { can } from "@/lib/permissions";
import { PLATFORMS } from "@/lib/platforms";
import { requireWorkspace } from "@/lib/session";
import { Composer } from "../../compose/Composer";
import { loadComposer } from "../../compose/load";
import { RetryButton } from "./RetryButton";

export const metadata = { title: "Post" };

const LIVE = new Set(["publishing", "published", "failed", "partially_failed"]);

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

  const targets = await db
    .select({ target: postTargets, channel: channels })
    .from(postTargets)
    .innerJoin(channels, eq(channels.id, postTargets.channelId))
    .where(eq(postTargets.postId, post.id))
    .orderBy(asc(channels.platform));
  const fmt = (d: Date | null) => (d ? new Intl.DateTimeFormat("en-US", { timeZone: workspace.timezone, dateStyle: "medium", timeStyle: "short" }).format(d) : "");
  const failed = targets.filter((t) => t.target.status === "failed").length;

  return (
    <>
      {(post.status === "publishing" || due) && <AutoRefresh />}
      <div className="page-head">
        <div>
          <h1>Post</h1>
          <p>
            {post.status === "publishing" || due ? "Publishing now. This page shows each channel's progress." : post.publishedAt ? `Published ${fmt(post.publishedAt)}.` : `Planned for ${fmt(post.scheduledAt)}.`}
          </p>
        </div>
        <StatusPill status={post.status} />
      </div>

      <div className="grid g-2" style={{ alignItems: "start" }}>
        <div className="card card-b stack">
          <h3>Caption</h3>
          <p style={{ whiteSpace: "pre-wrap", fontSize: 14 }}>{post.caption || <span className="muted">No caption.</span>}</p>
          {post.firstComment && (
            <>
              <h3 style={{ marginTop: 8 }}>First comment</h3>
              <p style={{ whiteSpace: "pre-wrap", fontSize: 14 }}>{post.firstComment}</p>
            </>
          )}
        </div>
        <div className="card card-b stack">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h3>Channels</h3>
            {failed > 0 && can(member, "publish") && <RetryButton workspaceId={workspaceId} postId={post.id} count={failed} />}
          </div>
          {targets.map(({ target: t, channel: c }) => (
            <div key={t.id} className="row" data-target={c.handle} style={{ alignItems: "flex-start", padding: "8px 0", borderBottom: "1px solid var(--line)" }}>
              <PlatformBadge platform={c.platform} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
                  <b style={{ fontSize: 14 }}>{c.displayName}</b>
                  <StatusPill status={t.status === "pending" ? "scheduled" : t.status} />
                </div>
                <div className="muted" style={{ fontSize: 12.5 }}>{PLATFORMS[c.platform].name}{t.attempts > 1 ? ` · ${t.attempts} attempts` : ""}</div>
                {t.error && <p className={t.status === "failed" ? "err" : "muted"} style={{ fontSize: 13, marginTop: 4 }}>{t.error}</p>}
                {t.status === "failed" && c.status === "reconnect" && <Link href={`/w/${workspaceId}/channels`} style={{ fontSize: 13 }}>Reconnect {PLATFORMS[c.platform].name}</Link>}
                {t.externalUrl && (
                  <a href={t.externalUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13 }}>View on {PLATFORMS[c.platform].name}</a>
                )}
              </div>
            </div>
          ))}
          {targets.length === 0 && <p className="muted">This post had no channels, so nothing was sent.</p>}
        </div>
      </div>
    </>
  );
}
