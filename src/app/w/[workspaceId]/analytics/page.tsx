import Link from "next/link";
import { EmptyState, PlatformBadge } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { compact, RANGES, SORT_KEYS, sortChannels, type SortKey } from "@/lib/analytics-math";
import { loadAnalytics, parseRange } from "@/lib/analytics";
import { describeSlot, MIN_POSTS } from "@/lib/best-times";
import { loadBestTimes } from "@/lib/best-times-load";
import { requireWorkspace } from "@/lib/session";

export const metadata = { title: "Analytics" };

const fmtChange = (c: number | null) => (c === null ? null : `${c >= 0 ? "+" : ""}${c.toFixed(1)}%`);

export default async function Page({ params, searchParams }: { params: Promise<{ workspaceId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { workspaceId } = await params;
  const sp = await searchParams;
  const { workspace } = await requireWorkspace(workspaceId);
  const range = parseRange(sp.range);
  const channelId = sp.channel && /^[0-9a-f-]{36}$/i.test(sp.channel) ? sp.channel : null;
  const sort: SortKey = (SORT_KEYS as readonly string[]).includes(sp.sort ?? "") ? (sp.sort as SortKey) : "reach";
  const dir: 1 | -1 = sp.dir === "asc" ? 1 : -1;
  const [data, best] = await Promise.all([loadAnalytics(workspace, range, channelId), loadBestTimes(workspace, channelId)]);
  const { summary, selected } = data;

  const href = (o: Record<string, string | null>) => {
    const p = new URLSearchParams();
    const merged: Record<string, string | null> = { range: range === 30 ? null : String(range), channel: selected?.id ?? null, sort: sort === "reach" ? null : sort, dir: dir === -1 ? null : "asc", ...o };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return `/w/${workspaceId}/analytics${s ? `?${s}` : ""}`;
  };
  const exportHref = `/api/w/${workspaceId}/analytics/export?range=${range}${selected ? `&channel=${selected.id}` : ""}`;

  if (data.channels.length === 0) {
    return (
      <>
        <div className="page-head"><div><h1>Analytics</h1></div></div>
        <div className="card"><EmptyState title="No channels yet" body="Connect a channel to see how your posts perform." action={<Link className="btn primary" href={`/w/${workspaceId}/channels`}>Connect a channel</Link>} /></div>
      </>
    );
  }

  const label = selected ? selected.displayName : "All channels";
  const useClicks = selected?.platform === "linkedin";
  const k = summary.kpis;
  const kpis: [string, string, string | null][] = [
    ["Impressions", compact(k.impressions.value), fmtChange(k.impressions.change)],
    ["Engagements", compact(k.engagements.value), k.engagements.rate !== null ? `${k.engagements.rate.toFixed(1)}% rate` : fmtChange(k.engagements.change)],
    ["Followers gained", `${k.followersGained.value >= 0 ? "+" : ""}${k.followersGained.value.toLocaleString("en-US")}`, fmtChange(k.followersGained.change)],
    useClicks ? ["Link clicks", compact(k.linkClicks.value), fmtChange(k.linkClicks.change)] : ["Video views", compact(k.videoViews.value), fmtChange(k.videoViews.change)],
  ];

  // Chart geometry
  const pts = summary.series.map((s) => s.value);
  const n = pts.length;
  const W = 960, H = 240, PL = 48, PR = 12, PT = 14, PB = 26;
  const max = Math.max(...pts, 1);
  const step = max > 40000 ? 20000 : max > 4000 ? 2000 : max > 1000 ? 500 : 100;
  const top = Math.ceil(max / step / 4) * step * 4 || 400;
  const x = (i: number) => PL + i * ((W - PL - PR) / Math.max(1, n - 1));
  const y = (v: number) => PT + (H - PT - PB) * (1 - v / top);
  const line = pts.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const every = n <= 7 ? 1 : n <= 30 ? 6 : 15;
  const dayLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const hasData = pts.some((v) => v > 0);

  const rows = sortChannels(summary.byChannel, sort, dir);
  const th = (key: SortKey, text: string, right = false) => {
    const on = sort === key;
    const next = on ? (dir === -1 ? "asc" : null) : key === "name" ? "asc" : null;
    return (
      <th style={right ? { textAlign: "right" } : undefined} aria-sort={on ? (dir === 1 ? "ascending" : "descending") : "none"}>
        <Link className={`sortbtn${on ? " on" : ""}`} href={href({ sort: key === "reach" ? null : key, dir: next })} scroll={false}>
          {text}<span aria-hidden="true">{on ? (dir === 1 ? "▲" : "▼") : "↕"}</span>
        </Link>
      </th>
    );
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Analytics</h1>
          <p>{selected ? `Results for ${selected.displayName}.` : `Performance across ${data.channels.length} connected channel${data.channels.length === 1 ? "" : "s"}.`} Pick a channel to drill in.</p>
        </div>
        <div className="row" style={{ flexWrap: "wrap" }}>
          <nav className="seg" aria-label="Date range">
            {RANGES.map((r) => <Link key={r} href={href({ range: r === 30 ? null : String(r) })} className={range === r ? "on" : ""} scroll={false}>{r} days</Link>)}
          </nav>
          <a className="btn" href={exportHref}>Export CSV</a>
        </div>
      </div>

      <nav className="row" style={{ flexWrap: "wrap", gap: 8, marginBottom: 16 }} aria-label="Filter by channel">
        <Link className={`chip${!selected ? " on" : ""}`} href={href({ channel: null })} scroll={false}><Icon name="grid" size={14} /> All channels</Link>
        {data.channels.map((c) => (
          <Link key={c.id} className={`chip${selected?.id === c.id ? " on" : ""}`} href={href({ channel: c.id })} scroll={false}><PlatformBadge platform={c.platform} /> {c.displayName}</Link>
        ))}
      </nav>

      <div className="grid g-4" style={{ marginBottom: 16 }}>
        {kpis.map(([name, v, d]) => (
          <div className="card kpi" key={name}>
            <div className="label">{name}</div>
            <div className="v num">{v}</div>
            <div className={`d ${d?.startsWith("-") ? "down" : "up"}`}>{d ?? "–"} {d && !d.endsWith("rate") && <span className="muted" style={{ fontWeight: 500 }}>vs previous {range} days</span>}</div>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-h"><h2>Impressions</h2><div className="row muted" style={{ fontSize: 12.5 }}>{selected ? <PlatformBadge platform={selected.platform} /> : <span style={{ width: 10, height: 10, borderRadius: 3, background: "var(--sky)" }} />} {label}, daily</div></div>
        <div className="card-b">
          {hasData ? (
            <div className="tbl-wrap">
              <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", minWidth: 480, height: "auto", display: "block" }} role="img" aria-label={`Daily impressions for ${label}, last ${range} days`}>
                {[0, top / 4, top / 2, (top * 3) / 4, top].map((t) => (
                  <g key={t}>
                    <line x1={PL} x2={W - PR} y1={y(t)} y2={y(t)} stroke="var(--line-2)" />
                    <text x={PL - 8} y={y(t) + 4} textAnchor="end" fontSize="10.5" fill="var(--muted)" fontFamily="JetBrains Mono, monospace">{compact(t)}</text>
                  </g>
                ))}
                <polygon points={`${x(0)},${y(0)} ${line} ${x(n - 1)},${y(0)}`} fill="var(--sky-100)" opacity=".75" />
                <polyline points={line} fill="none" stroke="var(--sky)" strokeWidth="2.2" strokeLinejoin="round" />
                <circle cx={x(n - 1)} cy={y(pts[n - 1]!)} r="4.5" fill="var(--panel)" stroke="var(--sky)" strokeWidth="2.5" />
                <text x={x(n - 1) - 8} y={y(pts[n - 1]!) - 10} textAnchor="end" fontSize="11" fontWeight="600" fill="var(--ink)">{pts[n - 1]!.toLocaleString("en-US")}</text>
                {summary.series.map((s, i) => (i % every === 0 || i === n - 1) && (
                  <text key={s.day} x={x(i)} y={H - 8} textAnchor={i === n - 1 ? "end" : i === 0 ? "start" : "middle"} fontSize="10.5" fill="var(--muted)">{dayLabel(s.day)}</text>
                ))}
              </svg>
            </div>
          ) : (
            <EmptyState title="No figures yet" body="Figures arrive from the platforms every 6 hours after a channel is connected." />
          )}
        </div>
      </div>

      <div className="grid g-main" style={{ alignItems: "start" }}>
        <div className="card">
          <div className="card-h"><h2>By channel</h2><span className="muted" style={{ fontSize: 12.5 }}>Click a column to sort, or a channel to filter</span></div>
          <div className="card-b tbl-wrap">
            <table className="tbl">
              <thead><tr>{th("name", "Channel")}{th("followers", "Followers", true)}{th("growth", "Growth", true)}{th("reach", "Reach", true)}{th("engagementRate", "Eng. rate", true)}{th("posts", "Posts", true)}</tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.channelId} className={selected?.id === r.channelId ? "sel" : ""}>
                    <td><Link href={href({ channel: selected?.id === r.channelId ? null : r.channelId })} scroll={false} className="row" style={{ color: "inherit", textDecoration: "none" }}><PlatformBadge platform={r.platform} /> <b style={{ fontWeight: 600 }}>{r.name}</b></Link></td>
                    <td className="num" style={{ textAlign: "right" }}>{r.followers?.toLocaleString("en-US") ?? "–"}</td>
                    <td className={`num ${r.growth !== null && r.growth < 0 ? "down" : "up"}`} style={{ textAlign: "right" }}>{r.growth === null ? "–" : `${r.growth >= 0 ? "+" : ""}${r.growth.toFixed(1)}%`}</td>
                    <td className="num" style={{ textAlign: "right" }}>{r.reach.toLocaleString("en-US")}</td>
                    <td className="num" style={{ textAlign: "right" }}>{r.engagementRate === null ? "–" : `${r.engagementRate.toFixed(1)}%`}</td>
                    <td className="num" style={{ textAlign: "right" }}>{r.posts}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card">
          <div className="card-h"><h2>Top posts</h2><span className="muted" style={{ fontSize: 12.5 }}>{label}</span></div>
          <div className="card-b tbl-wrap">
            {data.top.length ? (
              <table className="tbl">
                <thead><tr><th>Post</th><th style={{ textAlign: "right" }}>Reach</th></tr></thead>
                <tbody>
                  {data.top.map((p) => (
                    <tr key={p.postId}>
                      <td>
                        <Link href={`/w/${workspaceId}/posts/${p.postId}`} style={{ color: "inherit", textDecoration: "none" }}>
                          <b style={{ fontSize: 13 }}>{p.caption.split("\n")[0]!.slice(0, 70) || "Untitled post"}</b>
                          <div className="muted" style={{ fontSize: 11.5 }}>{p.publishedAt ? new Intl.DateTimeFormat("en-US", { timeZone: workspace.timezone, month: "short", day: "numeric" }).format(p.publishedAt) : ""} · {p.engagements.toLocaleString("en-US")} engagements</div>
                        </Link>
                      </td>
                      <td className="num" style={{ textAlign: "right" }}>{p.reach.toLocaleString("en-US")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="empty">No published posts with figures in this period.</div>
            )}
          </div>
        </div>
      </div>

      <section className="card" style={{ marginTop: 16 }} aria-labelledby="best-times">
        <div className="card-h"><h2 id="best-times">Best times to post</h2><span className="muted" style={{ fontSize: 12.5 }}>{label}, last 90 days, {workspace.timezone.replace(/_/g, " ")}</span></div>
        <div className="card-b">
          {best.times.length ? (
            <>
              <ol className="best-times">
                {best.times.map((t, i) => (
                  <li key={`${t.weekday}-${t.hour}`}>
                    <span className="rank num">{i + 1}</span>
                    <div className="grow">
                      <b>{describeSlot(t)}</b>
                      <div className="muted" style={{ fontSize: 12.5 }}>
                        {t.lift !== null && t.lift > 0 ? `${Math.round(t.lift * 100)}% more engagement than your average` : "About your average engagement"} · {t.posts} posts
                      </div>
                    </div>
                    <span className="num">{Math.round(t.avg).toLocaleString("en-US")} <span className="muted" style={{ fontSize: 12 }}>avg. engagements</span></span>
                  </li>
                ))}
              </ol>
              <p className="muted" style={{ fontSize: 12.5, margin: "12px 0 0" }}>
                Worked out from your own {best.sample} published posts with results. Add these times to a queue from the <Link href={`/w/${workspaceId}/calendar?view=queues`}>Queues</Link> view.
              </p>
            </>
          ) : (
            <div className="empty">Not enough results yet. Best times appear once about {MIN_POSTS} published posts{selected ? " on this channel" : ""} have figures, with at least two at the same hour.</div>
          )}
        </div>
      </section>
    </>
  );
}
