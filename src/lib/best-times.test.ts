import { describe, expect, it } from "vitest";
import { bestTimes, describeSlot, MIN_POSTS } from "./best-times";
import { shuffleTimes } from "./queue-slots";

const utc = (iso: string) => new Date(iso);

describe("bestTimes", () => {
  it("needs enough posts before it says anything", () => {
    const rows = Array.from({ length: MIN_POSTS - 1 }, () => ({ at: utc("2026-10-06T13:00:00Z"), engagement: 100 }));
    expect(bestTimes(rows, "UTC")).toEqual([]);
  });

  it("ranks hours by average engagement in the workspace's time zone", () => {
    const rows = [
      // Tuesdays 09:00 New York (13:00 UTC): strong
      { at: utc("2026-10-06T13:05:00Z"), engagement: 300 }, { at: utc("2026-10-13T13:40:00Z"), engagement: 260 },
      // Fridays 18:00 New York (22:00 UTC): middling
      { at: utc("2026-10-09T22:00:00Z"), engagement: 150 }, { at: utc("2026-10-16T22:10:00Z"), engagement: 130 },
      // Sunday 07:00 New York: weak
      { at: utc("2026-10-11T11:00:00Z"), engagement: 20 }, { at: utc("2026-10-18T11:00:00Z"), engagement: 30 },
      // A lone great post at an odd hour is not enough on its own
      { at: utc("2026-10-07T03:00:00Z"), engagement: 5000 },
    ];
    const r = bestTimes(rows, "America/New_York");
    expect(r.map(describeSlot)).toEqual(["Tuesday 9 AM", "Friday 6 PM", "Sunday 7 AM"]);
    expect(r[0]).toMatchObject({ weekday: 2, hour: 9, avg: 280, posts: 2 });
    expect(r[0]!.lift).toBeCloseTo(280 / (5890 / 7) - 1, 5);
  });
});

describe("shuffleTimes", () => {
  const items = [0, 1, 2, 3].map((i) => ({ id: `p${i}`, at: new Date(Date.UTC(2026, 10, 10 + i, 13)) }));

  it("reuses exactly the same times", () => {
    const r = shuffleTimes(items, () => 0.42);
    expect(r.map((x) => x.at.getTime()).sort()).toEqual(items.map((x) => x.at.getTime()).sort());
    expect(r.map((x) => x.id)).toEqual(items.map((x) => x.id));
  });

  it("always changes the order when there are two or more posts", () => {
    // rand() close to 1 leaves every element in place in a Fisher-Yates pass.
    const r = shuffleTimes(items, () => 0.9999);
    expect(r.some((x, i) => x.at.getTime() !== items[i]!.at.getTime())).toBe(true);
    expect(shuffleTimes(items.slice(0, 2), () => 0.9999).map((x) => x.at)).toEqual([items[1]!.at, items[0]!.at]);
  });

  it("leaves a single post alone", () => {
    expect(shuffleTimes(items.slice(0, 1))).toEqual([{ id: "p0", at: items[0]!.at }]);
  });
});
