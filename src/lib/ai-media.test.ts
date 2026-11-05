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

describe("pickFallbacks", async () => {
  const { pickFallbacks } = await import("./gemini");
  it("picks other Flash models, stable and newest first, and skips special ones", () => {
    const list = ["models/gemini-3.8-flash", "models/gemini-3.5-flash", "models/gemini-3.8-flash-lite", "models/gemini-3.8-pro", "models/gemini-3.9-flash-preview", "models/gemini-3.8-flash-image", "models/gemini-2.5-flash-tts"];
    expect(pickFallbacks(list, "gemini-3.8-flash")).toEqual(["gemini-3.8-flash-lite", "gemini-3.5-flash"]);
  });
});

describe("generateJson fallback", () => {
  it("moves to the backup model when the main one is overloaded, with a whole-number timeout", async () => {
    process.env.GEMINI_API_KEY = "k";
    process.env.GEMINI_MODEL = "main";
    process.env.GEMINI_FALLBACK_MODELS = "backup";
    let t = 1_000_000;
    const now = vi.spyOn(Date, "now").mockImplementation(() => (t += 1)); // time passes, so 60% of what is left is a fraction
    const seen: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      expect(init.signal).toBeInstanceOf(AbortSignal);
      seen.push(url);
      if (url.includes("/main:")) return new Response(JSON.stringify({ error: { message: "high demand" } }), { status: 503 });
      return new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: '{"ok":true}' }] } }] }), { status: 200 });
    });
    const { generateJson } = await import("./gemini");
    await expect(generateJson({ system: "s", parts: [{ text: "x" }], schema: {} })).resolves.toEqual({ ok: true });
    expect(seen.map((u) => u.split("/models/")[1])).toEqual(["main:generateContent", "backup:generateContent"]);
    now.mockRestore();
    vi.unstubAllGlobals();
  });
});
