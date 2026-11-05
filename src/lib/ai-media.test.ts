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
    expect(pickFallbacks(list, "gemini-3.8-flash")).toEqual(["gemini-3.8-flash-lite", "gemini-3.5-flash", "gemini-3.9-flash-preview"]);
  });

  it("puts Google's -latest Flash aliases first", () => {
    // The list a real key returned in November 2026.
    const list = ["gemini-2.5-flash", "gemini-2.5-flash-preview-tts", "gemini-flash-latest", "gemini-flash-lite-latest", "gemini-2.5-flash-lite", "gemini-2.5-flash-image", "gemini-3-flash-preview", "gemini-3.1-flash-lite-preview", "gemini-3.1-flash-lite", "gemini-3.1-flash-image", "gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-omni-flash-preview", "gemini-omni-1.1-flash", "gemini-3.6-flash", "gemini-3.7-flash", "gemini-3.8-flash", "gemini-3.8-flash-tts"];
    expect(pickFallbacks(list, "gemini-3.8-flash")).toEqual(["gemini-flash-lite-latest", "gemini-flash-latest", "gemini-3.5-flash-lite"]);
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

describe("generateJson hedging", () => {
  it("starts a backup model when the main one hangs, and uses whichever answers first", async () => {
    process.env.GEMINI_API_KEY = "k";
    process.env.GEMINI_MODEL = "main";
    process.env.GEMINI_FALLBACK_MODELS = "backup";
    let mainAborted = false;
    vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
      if (url.includes("/main:")) {
        // An overloaded model that never answers, until it is cancelled.
        return new Promise((_, reject) => init.signal!.addEventListener("abort", () => { mainAborted = true; reject(Object.assign(new Error("aborted"), { name: "AbortError" })); }));
      }
      return Promise.resolve(new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: '{"ok":"backup"}' }] } }] }), { status: 200 }));
    });
    const { generateJson } = await import("./gemini");
    const started = Date.now();
    await expect(generateJson({ system: "s", parts: [{ text: "x" }], schema: {}, hedgeMs: 30 })).resolves.toEqual({ ok: "backup" });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(mainAborted).toBe(true);
    vi.unstubAllGlobals();
  });

  it("gives up after the time budget when no model answers", async () => {
    process.env.GEMINI_FALLBACK_MODELS = "backup";
    vi.stubGlobal("fetch", (_: string, init: RequestInit) =>
      new Promise((_, reject) => init.signal!.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })))));
    const { generateJson } = await import("./gemini");
    await expect(generateJson({ system: "s", parts: [{ text: "x" }], schema: {}, hedgeMs: 10, budgetMs: 80 })).rejects.toThrow("took too long");
    vi.unstubAllGlobals();
  });
});
