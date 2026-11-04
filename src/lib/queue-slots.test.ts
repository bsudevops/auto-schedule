import { describe, expect, it } from "vitest";
import { nextOpenSlot, zonedToUtc } from "./queue-slots";

describe("zonedToUtc", () => {
  it("handles New York standard time", () => {
    expect(zonedToUtc(2026, 11, 5, 8, 0, "America/New_York").toISOString()).toBe("2026-11-05T13:00:00.000Z");
  });
  it("handles Kolkata", () => {
    expect(zonedToUtc(2026, 11, 5, 8, 0, "Asia/Kolkata").toISOString()).toBe("2026-11-05T02:30:00.000Z");
  });
});

describe("nextOpenSlot", () => {
  const weekdayMornings = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, minuteOfDay: 8 * 60 }));
  const wedAfternoon = new Date("2026-11-04T18:00:00Z"); // Wed 1pm in New York

  it("returns the next weekday 8am", () => {
    expect(nextOpenSlot(weekdayMornings, wedAfternoon, "America/New_York")?.toISOString()).toBe("2026-11-05T13:00:00.000Z");
  });
  it("skips slots already taken", () => {
    const taken = [new Date("2026-11-05T13:00:00.000Z")];
    expect(nextOpenSlot(weekdayMornings, wedAfternoon, "America/New_York", taken)?.toISOString()).toBe("2026-11-06T13:00:00.000Z");
  });
  it("returns null without slots", () => {
    expect(nextOpenSlot([], wedAfternoon, "UTC")).toBeNull();
  });
});
