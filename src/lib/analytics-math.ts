/** Pure calculations behind the Analytics page, kept apart from the database so they can be tested. */

export type DayRow = {
  channelId: string;
  day: string; // YYYY-MM-DD
  followers: number | null;
  impressions: number | null;
  reach: number | null;
  engagements: number | null;
  videoViews: number | null;
  linkClicks: number | null;
};

export const RANGES = [7, 30, 90] as const;
export type Range = (typeof RANGES)[number];

/** Shifts a YYYY-MM-DD date by whole days. */
export function shiftDay(day: string, by: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + by);
  return d.toISOString().slice(0, 10);
}

export function daysEnding(today: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => shiftDay(today, i - n + 1));
}

/** Some platforms only report reach, so it stands in for impressions when they're missing. */
const views = (r: DayRow) => r.impressions ?? r.reach ?? 0;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export function pctChange(cur: number, prev: number): number | null {
  if (!prev) return null;
  return ((cur - prev) / prev) * 100;
}

function followerGain(rows: DayRow[]): { gained: number; growth: number | null; latest: number | null } {
  const withF = rows.filter((r) => r.followers !== null).sort((a, b) => a.day.localeCompare(b.day));
  if (!withF.length) return { gained: 0, growth: null, latest: null };
  const first = withF[0]!.followers!;
  const last = withF.at(-1)!.followers!;
  return { gained: last - first, growth: first ? ((last - first) / first) * 100 : null, latest: last };
}

export type ChannelSummary = {
  channelId: string;
  followers: number | null;
  growth: number | null;
  impressions: number;
  reach: number;
  engagements: number;
  engagementRate: number | null;
  posts: number;
};

export function summarize(rows: DayRow[], opts: { today: string; range: number; channelIds: string[]; postsByChannel: Record<string, number> }) {
  const { today, range, channelIds } = opts;
  const cur = new Set(daysEnding(today, range));
  const prev = new Set(daysEnding(shiftDay(today, -range), range));
  const inCur = rows.filter((r) => cur.has(r.day) && channelIds.includes(r.channelId));
  const inPrev = rows.filter((r) => prev.has(r.day) && channelIds.includes(r.channelId));

  const byChannel: ChannelSummary[] = channelIds.map((id) => {
    const rs = inCur.filter((r) => r.channelId === id);
    const f = followerGain(rs);
    const impressions = sum(rs.map(views));
    const engagements = sum(rs.map((r) => r.engagements ?? 0));
    return {
      channelId: id,
      followers: f.latest,
      growth: f.growth,
      impressions,
      reach: sum(rs.map((r) => r.reach ?? r.impressions ?? 0)),
      engagements,
      engagementRate: impressions ? (engagements / impressions) * 100 : null,
      posts: opts.postsByChannel[id] ?? 0,
    };
  });

  const totals = (rs: DayRow[]) => ({
    impressions: sum(rs.map(views)),
    engagements: sum(rs.map((r) => r.engagements ?? 0)),
    videoViews: sum(rs.map((r) => r.videoViews ?? 0)),
    linkClicks: sum(rs.map((r) => r.linkClicks ?? 0)),
    followersGained: sum(channelIds.map((id) => followerGain(rs.filter((r) => r.channelId === id)).gained)),
  });
  const now = totals(inCur);
  const before = totals(inPrev);

  const series = daysEnding(today, range).map((day) => ({ day, value: sum(inCur.filter((r) => r.day === day).map(views)) }));

  return {
    byChannel,
    series,
    kpis: {
      impressions: { value: now.impressions, change: pctChange(now.impressions, before.impressions) },
      engagements: { value: now.engagements, change: pctChange(now.engagements, before.engagements), rate: now.impressions ? (now.engagements / now.impressions) * 100 : null },
      followersGained: { value: now.followersGained, change: pctChange(now.followersGained, before.followersGained) },
      videoViews: { value: now.videoViews, change: pctChange(now.videoViews, before.videoViews) },
      linkClicks: { value: now.linkClicks, change: pctChange(now.linkClicks, before.linkClicks) },
    },
  };
}

export const SORT_KEYS = ["name", "followers", "growth", "reach", "engagementRate", "posts"] as const;
export type SortKey = (typeof SORT_KEYS)[number];

export function sortChannels<T extends ChannelSummary & { name: string }>(rows: T[], key: SortKey, dir: 1 | -1): T[] {
  return [...rows].sort((a, b) => {
    const av = a[key] ?? -Infinity;
    const bv = b[key] ?? -Infinity;
    const c = typeof av === "string" ? av.localeCompare(String(bv)) : (av as number) - (bv as number);
    return c * dir;
  });
}

/** One CSV cell. Values that a spreadsheet would read as a formula are prefixed so they stay text. */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (typeof v !== "number" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function compact(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}
