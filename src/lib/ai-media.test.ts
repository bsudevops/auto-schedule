import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { parseMediaSuggestions, MediaAiError } = await import("./ai-media");

describe("parseMediaSuggestions", () => {
  it("keeps captions under the limit, cleans hashtags and titles", () => {
    const r = parseMediaSuggestions({
      captions: ["Short one", "x".repeat(300), "Short one", "Another"],
      titles: ["A <great> title", "t".repeat(120)],
      hashtags: ["coffee", "#ColdBrew", "##latte art", "#"],
    }, 280);
    expect(r.captions).toEqual(["Short one", "Another"]);
    expect(r.titles).toEqual(["A great title"]);
    expect(r.hashtags).toEqual(["#coffee", "#ColdBrew", "#latteart"]);
  });

  it("rejects an answer of the wrong shape", () => {
    expect(() => parseMediaSuggestions({ captions: "nope" }, 280)).toThrow(MediaAiError);
  });
});
