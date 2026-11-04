/**
 * Best times to post, worked out from the workspace's own published posts: each post's engagement
 * is credited to the weekday and hour it went out (in the workspace's time zone), and the hours
 * with the highest average engagement win. No outside benchmarks are used.
 */
export type TimedResult = { at: Date; engagement: number };
export type BestTime = { weekday: number; hour: number; avg: number; posts: number; lift: number | null };

export const MIN_POSTS = 6; // below this there isn't enough to go on

const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function bestTimes(rows: TimedResult[], timeZone: string, opts: { top?: number; minPerSlot?: number } = {}): BestTime[] {
  const { top = 3, minPerSlot = 2 } = opts;
  if (rows.length < MIN_POSTS) return [];
  const f = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "numeric", hourCycle: "h23" });
  const buckets = new Map<string, { weekday: number; hour: number; sum: number; n: number }>();
  let total = 0;
  for (const r of rows) {
    const p = Object.fromEntries(f.formatToParts(r.at).map((x) => [x.type, x.value]));
    const weekday = WD[p.weekday as string] ?? 0;
    const hour = Number(p.hour) % 24;
    const key = `${weekday}:${hour}`;
    const b = buckets.get(key) ?? { weekday, hour, sum: 0, n: 0 };
    b.sum += r.engagement;
    b.n += 1;
    buckets.set(key, b);
    total += r.engagement;
  }
  const overall = total / rows.length;
  return [...buckets.values()]
    .filter((b) => b.n >= minPerSlot)
    .map((b) => {
      const avg = b.sum / b.n;
      return { weekday: b.weekday, hour: b.hour, avg, posts: b.n, lift: overall > 0 ? avg / overall - 1 : null };
    })
    .sort((a, b) => b.avg - a.avg || b.posts - a.posts || a.weekday - b.weekday || a.hour - b.hour)
    .slice(0, top);
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const describeSlot = (t: { weekday: number; hour: number }) => `${DAYS[t.weekday]} ${t.hour % 12 || 12} ${t.hour >= 12 ? "PM" : "AM"}`;
