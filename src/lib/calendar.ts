/** Date helpers that work on plain local dates ("YYYY-MM-DD") in a workspace's time zone. */
export type LocalDate = string;

export const parseLocal = (d: LocalDate) => { const [y, m, day] = d.split("-").map(Number); return { y: y!, m: m!, d: day! }; };
export const toLocal = (y: number, m: number, d: number): LocalDate => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toISOString().slice(0, 10);
};
export const addDays = (d: LocalDate, n: number): LocalDate => { const p = parseLocal(d); return toLocal(p.y, p.m, p.d + n); };
export const weekday = (d: LocalDate) => { const p = parseLocal(d); return new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay(); };
export const startOfWeek = (d: LocalDate) => addDays(d, -weekday(d));
export const startOfMonth = (d: LocalDate) => { const p = parseLocal(d); return toLocal(p.y, p.m, 1); };
export const addMonths = (d: LocalDate, n: number) => { const p = parseLocal(d); return toLocal(p.y, p.m + n, 1); };

export function localParts(at: Date, timeZone: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}` as LocalDate, time: `${p.hour}:${p.minute}`, hour: Number(p.hour) };
}

/** The 42 days (6 weeks) shown on a month grid, starting on Sunday. */
export function monthGrid(anchor: LocalDate): LocalDate[] {
  const start = startOfWeek(startOfMonth(anchor));
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}
