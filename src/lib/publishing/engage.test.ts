import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ENGAGE } from "./engage";
import { mockFetch } from "./test-fetch";

vi.mock("@/db", () => ({ db: {} }));
beforeEach(() => {
  process.env.META_APP_SECRET = "secret";
});
afterEach(() => vi.unstubAllGlobals());

const ctx = (externalId: string, handle = "harborcoffee", meta: Record<string, unknown> = {}) => ({ channel: { externalId, handle, meta }, accessToken: "t" });

describe("Facebook figures", () => {
  it("maps Page insights to one row per day (end_time marks the end of the day)", async () => {
    mockFetch([{ match: "/p1/insights?", body: { data: [
      { name: "page_impressions", values: [{ value: 120, end_time: "2026-11-03T08:00:00+0000" }] },
      { name: "page_post_engagements", values: [{ value: 9, end_time: "2026-11-03T08:00:00+0000" }] },
    ] } }]);
    const rows = await ENGAGE.facebook!.daily!(ctx("p1"), new Date("2026-11-01"), new Date("2026-11-04"));
    expect(rows).toEqual([{ day: "2026-11-02", impressions: 120, engagements: 9 }]);
  });
});

describe("Instagram comments", () => {
  it("turns comments and replies into conversations and recognises our own replies", async () => {
    mockFetch([{ match: "/m1/comments?", body: { data: [
      { id: "c1", username: "jess", text: "Love it", timestamp: "2026-11-03T10:00:00+0000", replies: { data: [{ id: "r1", username: "harborcoffee", text: "Thanks!", timestamp: "2026-11-03T11:00:00+0000" }] } },
    ] } }]);
    const list = await ENGAGE.instagram!.comments!(ctx("ig1"), "m1");
    expect(list[0]).toMatchObject({ id: "c1", author: "jess", fromUs: false });
    expect(list[0]!.replies[0]).toMatchObject({ id: "r1", fromUs: true });
  });

  it("replies to a comment through its replies edge", async () => {
    const f = mockFetch([{ method: "POST", match: /\/c1\/replies$/, body: { id: "r2" } }]);
    expect(await ENGAGE.instagram!.reply!(ctx("ig1"), { externalId: "c1", meta: {} }, "Thank you")).toBe("r2");
    expect(new URLSearchParams(f.calls[0]!.body).get("message")).toBe("Thank you");
  });
});

describe("LinkedIn", () => {
  it("has no follower count for personal profiles", async () => {
    expect(await ENGAGE.linkedin!.followers(ctx("person:1", "x", { author: "urn:li:person:1" }))).toBeNull();
  });
});

describe("TikTok", () => {
  it("reads video figures and offers no comment API", async () => {
    mockFetch([{ method: "POST", match: "video/query", body: { data: { videos: [{ view_count: 900, like_count: 40, comment_count: 3, share_count: 2 }] }, error: { code: "ok" } } }]);
    expect(await ENGAGE.tiktok!.post(ctx("o"), "v1")).toEqual({ videoViews: 900, likes: 40, comments: 3, shares: 2 });
    expect(ENGAGE.tiktok!.comments).toBeUndefined();
  });
});
