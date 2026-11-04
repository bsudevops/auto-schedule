import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiError, parseSuggestions, writeWithAI } from "./ai";
import { addTags, cleanTags, tagsIn } from "./hashtags";
import { mockFetch } from "./publishing/test-fetch";
import { downloadStock, searchStock, StockError } from "./stock";

vi.mock("server-only", () => ({}));

afterEach(() => vi.unstubAllGlobals());

describe("hashtags", () => {
  it("cleans a typed list into one # each, without duplicates", () => {
    expect(cleanTags("#Coffee, latte  #coffee ##cold-brew #")).toEqual(["#Coffee", "#latte", "#coldbrew"]);
    expect(cleanTags(Array.from({ length: 40 }, (_, i) => `t${i}`).join(" "))).toHaveLength(30);
  });
  it("finds hashtags in a caption, ignoring # in the middle of words", () => {
    expect(tagsIn("Fresh beans #coffee\n#Latte and C#sharp #coffee")).toEqual(["#coffee", "#Latte"]);
  });
  it("appends only missing tags on their own paragraph", () => {
    expect(addTags("New roast today", ["#coffee", "#roast"])).toBe("New roast today\n\n#coffee #roast");
    expect(addTags("New roast #coffee", ["#Coffee", "#roast"])).toBe("New roast #coffee\n\n#roast");
    expect(addTags("", ["#a"])).toBe("#a");
    expect(addTags("Hi #a", ["#a"])).toBe("Hi #a");
  });
});

describe("writing help", () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    delete process.env.ANTHROPIC_MODEL;
  });
  afterEach(() => delete process.env.ANTHROPIC_API_KEY);

  it("keeps only valid suggestions within the limit", () => {
    expect(parseSuggestions(JSON.stringify({ suggestions: ["Short one", "x".repeat(50), " Short one "] }), 20)).toEqual(["Short one"]);
    expect(() => parseSuggestions("not json", 20)).toThrow(AiError);
    expect(() => parseSuggestions(JSON.stringify({ suggestions: ["x".repeat(50)] }), 20)).toThrow(/over the character limit/);
  });

  it("asks Claude for structured suggestions with fallbacks and returns them", async () => {
    const f = mockFetch([{
      method: "POST", match: "/v1/messages",
      body: { id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ suggestions: ["A", "B"] }) }], usage: { input_tokens: 1, output_tokens: 1 } },
      headers: { "content-type": "application/json" },
    }]);
    const out = await writeWithAI({ task: "improve", text: "our new latte", platforms: ["Bluesky"], limit: 300 });
    expect(out).toEqual(["A", "B"]);
    const body = JSON.parse(f.calls[0]!.body);
    expect(body).toMatchObject({ model: "claude-opus-5-5", fallbacks: "default", output_config: { effort: "low", format: { type: "json_schema" } } });
    expect(body.messages[0].content).toContain("Character limit for each suggestion: 300");
    expect(body.messages[0].content).toContain("<text>\nour new latte\n</text>");
  });

  it("explains a refusal instead of returning text", async () => {
    mockFetch([{
      method: "POST", match: "/v1/messages",
      body: { id: "m", type: "message", role: "assistant", model: "x", stop_reason: "refusal", content: [], usage: { input_tokens: 1, output_tokens: 0 } },
      headers: { "content-type": "application/json" },
    }]);
    await expect(writeWithAI({ task: "draft", text: "x", platforms: [], limit: 300 })).rejects.toThrow("can't help");
  });

  it("refuses to run without a key", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    await expect(writeWithAI({ task: "draft", text: "x", platforms: [], limit: 300 })).rejects.toBeInstanceOf(AiError);
  });
});

describe("stock photos", () => {
  beforeEach(() => { process.env.PEXELS_API_KEY = "pk"; });
  afterEach(() => delete process.env.PEXELS_API_KEY);
  const photo = (large2x: string) => ({ id: 7, width: 10, height: 10, url: "https://www.pexels.com/photo/7", photographer: "Ana", photographer_url: "https://www.pexels.com/@ana", alt: "Latte art", src: { large2x, large: "", medium: "https://images.pexels.com/m.jpg", tiny: "" } });

  it("searches and maps results", async () => {
    const f = mockFetch([{ match: "/v1/search?", body: { photos: [photo("https://images.pexels.com/a.jpg")], next_page: "x" } }]);
    const r = await searchStock(" latte ", 2);
    expect(r).toEqual({ hasMore: true, photos: [{ id: "7", thumb: "https://images.pexels.com/m.jpg", width: 10, height: 10, alt: "Latte art", photographer: "Ana", photographerUrl: "https://www.pexels.com/@ana", pageUrl: "https://www.pexels.com/photo/7" }] });
    expect(f.calls[0]!.url).toContain("query=latte");
    expect(f.calls[0]!.url).toContain("page=2");
  });

  it("only downloads from Pexels' image host", async () => {
    mockFetch([{ match: "/v1/photos/7", body: photo("https://evil.example.com/a.jpg") }]);
    await expect(downloadStock("7")).rejects.toBeInstanceOf(StockError);
    await expect(downloadStock("../x")).rejects.toThrow("Unknown photo.");
  });

  it("downloads the photo with its credit", async () => {
    mockFetch([
      { match: "/v1/photos/7", body: photo("https://images.pexels.com/a.jpg") },
      { match: "images.pexels.com/a.jpg", body: "jpegbytes" },
    ]);
    const r = await downloadStock("7");
    expect(r).toMatchObject({ filename: "pexels-7.jpg", alt: "Latte art", credit: "Photo by Ana on Pexels" });
    expect(r.data.toString()).toBe("jpegbytes");
  });
});
