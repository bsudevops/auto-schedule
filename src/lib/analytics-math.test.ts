import { describe, expect, it } from "vitest";
import { csvCell, daysEnding, shiftDay, sortChannels, summarize, type DayRow } from "./analytics-math";

const row = (channelId: string, day: string, o: Partial<DayRow>): DayRow => ({ channelId, day, followers: null, impressions: null, reach: null, engagements: null, videoViews: null, linkClicks: null, ...o });

describe("dates", () => {
  it("shifts across months and builds ranges ending today", () => {
    expect(shiftDay("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysEnding("2026-11-04", 3)).toEqual(["2026-11-02", "2026-11-03", "2026-11-04"]);
  });
});

describe("summarize", () => {
  const today = "2026-11-04";
  const rows = [
    row("a", "2026-11-03", { followers: 100, impressions: 1000, engagements: 50 }),
    row("a", "2026-11-04", { followers: 110, impressions: 3000, engagements: 70 }),
    row("b", "2026-11-04", { reach: 500 }), // reach stands in for impressions
    row("a", "2026-11-01", { impressions: 2000, engagements: 60 }), // previous period
    row("c", "2026-11-04", { impressions: 99999 }), // channel not selected
  ];

  it("adds up the selected channels and compares with the previous period", () => {
    const s = summarize(rows, { today, range: 2, channelIds: ["a", "b"], postsByChannel: { a: 3 } });
    expect(s.kpis.impressions).toEqual({ value: 4500, change: 125 });
    expect(s.kpis.engagements.value).toBe(120);
    expect(s.kpis.followersGained.value).toBe(10);
    expect(s.series).toEqual([{ day: "2026-11-03", value: 1000 }, { day: "2026-11-04", value: 3500 }]);
    const a = s.byChannel.find((c) => c.channelId === "a")!;
    expect(a).toMatchObject({ followers: 110, growth: 10, impressions: 4000, engagementRate: 3, posts: 3 });
  });

  it("returns no change when the previous period is empty", () => {
    const s = summarize(rows, { today, range: 2, channelIds: ["b"], postsByChannel: {} });
    expect(s.kpis.impressions.change).toBeNull();
  });
});

describe("sortChannels", () => {
  it("sorts both ways and puts missing values last when descending", () => {
    const base = { channelId: "", followers: null, growth: null, impressions: 0, reach: 0, engagements: 0, engagementRate: null, posts: 0 };
    const rows = [{ ...base, name: "B", reach: 5 }, { ...base, name: "A", reach: 9 }, { ...base, name: "C", reach: 1 }];
    expect(sortChannels(rows, "reach", -1).map((r) => r.name)).toEqual(["A", "B", "C"]);
    expect(sortChannels(rows, "name", 1).map((r) => r.name)).toEqual(["A", "B", "C"]);
  });
});

describe("csvCell", () => {
  it("quotes and neutralises formulas", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell(42)).toBe("42");
    expect(csvCell(-3)).toBe("-3");
    expect(csvCell(null)).toBe("");
  });
});
