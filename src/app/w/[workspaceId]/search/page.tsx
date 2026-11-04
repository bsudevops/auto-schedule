import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/db";
import { channels, inboxThreads, mediaAssets, posts } from "@/db/schema";
import { EmptyState, PlatformBadge, StatusPill } from "@/components/ui";
import { publicUrl } from "@/lib/media/storage";
import { thumbKey } from "@/lib/media/service";
import { requireWorkspace } from "@/lib/session";

export const metadata = { title: "Search" };

export default async function Page({ params, searchParams }: { params: Promise<{ workspaceId: string }>; searchParams: Promise<{ q?: string }> }) {
  const { workspaceId } = await params;
  const { workspace } = await requireWorkspace(workspaceId);
  const q = ((await searchParams).q ?? "").trim().slice(0, 100);
  const pat = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

  const [postRows, mediaRows, threadRows] = q.length < 2 ? [[], [], []] : await Promise.all([
    db.select().from(posts).where(and(eq(posts.workspaceId, workspaceId), or(ilike(posts.caption, pat), sql`exists (select 1 from unnest(${posts.tags}) tag where tag ilike ${pat})`))).orderBy(desc(posts.updatedAt)).limit(20),
    db.select().from(mediaAssets).where(and(eq(mediaAssets.workspaceId, workspaceId), or(ilike(mediaAssets.filename, pat), ilike(mediaAssets.altText, pat)))).orderBy(desc(mediaAssets.createdAt)).limit(12),
    db
      .select({ t: inboxThreads, platform: channels.platform })
      .from(inboxThreads)
      .innerJoin(channels, eq(channels.id, inboxThreads.channelId))
      .where(and(eq(inboxThreads.workspaceId, workspaceId), or(ilike(inboxThreads.authorName, pat), ilike(inboxThreads.subject, pat), sql`exists (select 1 from inbox_messages m where m.thread_id = ${inboxThreads.id} and m.body ilike ${pat})`)))
      .orderBy(desc(inboxThreads.lastMessageAt))
      .limit(10),
  ]);
  const total = postRows.length + mediaRows.length + threadRows.length;
  const fmt = (d: Date | null) => (d ? new Intl.DateTimeFormat("en-US", { timeZone: workspace.timezone, month: "short", day: "numeric" }).format(d) : "No date");

  return (
    <>
      <div className="page-head"><div><h1>Search</h1><p>{q.length < 2 ? "Type at least two characters in the search box." : `${total} result${total === 1 ? "" : "s"} for “${q}” in ${workspace.name}.`}</p></div></div>
      {q.length >= 2 && total === 0 && <div className="card"><EmptyState title="Nothing found" body="Try another word, or check the spelling." /></div>}
      {postRows.length > 0 && (
        <section className="card" style={{ marginBottom: 16 }}>
          <div className="card-h"><h2>Posts</h2></div>
          <div className="card-b tbl-wrap"><table className="tbl"><tbody>
            {postRows.map((p) => (
              <tr key={p.id}>
                <td className="num" style={{ whiteSpace: "nowrap", fontSize: 13 }}>{fmt(p.publishedAt ?? p.scheduledAt)}</td>
                <td><Link href={`/w/${workspaceId}/posts/${p.id}`} style={{ color: "inherit" }}>{p.caption.split("\n")[0]!.slice(0, 100) || "Untitled post"}</Link></td>
                <td style={{ textAlign: "right" }}><StatusPill status={p.status} /></td>
              </tr>
            ))}
          </tbody></table></div>
        </section>
      )}
      {threadRows.length > 0 && (
        <section className="card" style={{ marginBottom: 16 }}>
          <div className="card-h"><h2>Conversations</h2></div>
          <div className="card-b stack">
            {threadRows.map(({ t, platform }) => (
              <Link key={t.id} href={`/w/${workspaceId}/inbox?thread=${t.id}${t.doneAt ? "&filter=done" : ""}`} className="row" style={{ color: "inherit", textDecoration: "none" }}>
                <PlatformBadge platform={platform} /> <b style={{ fontSize: 13.5 }}>{t.authorName}</b> <span className="muted" style={{ fontSize: 12.5 }}>{t.subject}</span>
              </Link>
            ))}
          </div>
        </section>
      )}
      {mediaRows.length > 0 && (
        <section className="card">
          <div className="card-h"><h2>Media</h2><Link className="btn ghost sm" href={`/w/${workspaceId}/media`}>Open library</Link></div>
          <div className="card-b media-grid">
            {mediaRows.map((m) => (
              <div key={m.id} className="asset">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={publicUrl(thumbKey(m.storageKey, m.kind))} alt={m.altText} style={{ width: "100%", aspectRatio: "1", objectFit: "cover", display: "block" }} />
                <div className="meta"><b>{m.filename}</b></div>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
