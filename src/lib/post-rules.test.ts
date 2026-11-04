import { describe, expect, it } from "vitest";
import { checkPost } from "./post-rules";

const ig = { id: "ig", platform: "instagram" as const, handle: "a" };
const tt = { id: "tt", platform: "tiktok" as const, handle: "a" };
const li = { id: "li", platform: "linkedin" as const, handle: "a" };

describe("checkPost", () => {
  it("accepts a LinkedIn text post", () => {
    expect(checkPost([li], "Hello", {}, [])).toEqual([]);
  });
  it("requires media on Instagram", () => {
    expect(checkPost([ig], "Hello", {}, [])).toContain("Instagram posts need 1 to 10 photos or videos.");
  });
  it("requires exactly one video on TikTok", () => {
    expect(checkPost([tt], "Hi", {}, [{ kind: "image" }])).toContain("TikTok posts need exactly one video.");
    expect(checkPost([tt], "Hi", {}, [{ kind: "video" }])).toEqual([]);
  });
  it("checks each channel's own caption against its limit", () => {
    const long = "x".repeat(2300);
    expect(checkPost([li, ig], "short", { ig: long }, [{ kind: "image" }])).toEqual(["The Instagram caption is 100 characters too long."]);
  });
  it("needs a channel", () => {
    expect(checkPost([], "Hi", {}, [])).toEqual(["Pick at least one channel."]);
  });
});
