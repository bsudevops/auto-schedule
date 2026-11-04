import { describe, expect, it } from "vitest";
import { addDays, localParts, monthGrid, startOfWeek, weekday } from "./calendar";

describe("calendar dates", () => {
  it("builds a 6-week month grid starting on Sunday", () => {
    const g = monthGrid("2026-11-18");
    expect(g[0]).toBe("2026-11-01");
    expect(g).toHaveLength(42);
    expect(weekday(g[0]!)).toBe(0);
  });
  it("crosses month and year boundaries", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(startOfWeek("2027-01-01")).toBe("2026-12-27");
  });
  it("reads local date and time in the workspace time zone", () => {
    expect(localParts(new Date("2026-11-05T02:30:00Z"), "America/New_York")).toMatchObject({ date: "2026-11-04", time: "21:30" });
  });
});
