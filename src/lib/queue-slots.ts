/**
 * Finds the next open queue slot after `from`.
 * Slots are weekly (weekday 0 = Sunday, minuteOfDay in the workspace's time zone).
 * `taken` holds times already used by queued posts.
 */
export function nextOpenSlot(
  slots: Array<{ weekday: number; minuteOfDay: number }>,
  from: Date,
  timeZone: string,
  taken: Date[] = [],
  horizonDays = 60,
): Date | null {
  if (!slots.length) return null;
  const takenSet = new Set(taken.map((d) => d.getTime()));
  const candidates: Date[] = [];
  for (let day = 0; day <= horizonDays; day++) {
    const local = localParts(new Date(from.getTime() + day * 86_400_000), timeZone);
    for (const s of slots) {
      if (s.weekday !== local.weekday) continue;
      const at = zonedToUtc(local.year, local.month, local.day, Math.floor(s.minuteOfDay / 60), s.minuteOfDay % 60, timeZone);
      if (at > from && !takenSet.has(at.getTime())) candidates.push(at);
    }
    if (candidates.length) return candidates.sort((a, b) => a.getTime() - b.getTime())[0]!;
  }
  return null;
}

const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function localParts(d: Date, timeZone: string) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric", weekday: "short" });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return { year: Number(p.year), month: Number(p.month), day: Number(p.day), weekday: WD[p.weekday as string] ?? 0 };
}

/** Converts a wall-clock time in `timeZone` to a UTC Date. */
export function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, timeZone: string): Date {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric",
  });
  const p = Object.fromEntries(f.formatToParts(new Date(guess)).map((x) => [x.type, x.value]));
  const asIfUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute));
  return new Date(guess - (asIfUtc - guess));
}
