import "server-only";

/**
 * A small client for the Gemini API (ai.google.dev), over plain REST so no extra package is needed.
 * Images go inline; videos go through the Files API first, because a request body is capped at 20 MB.
 * Optional: without GEMINI_API_KEY the media features are hidden.
 */
// GEMINI_BASE_URL is only for tests or a proxy; leave it empty to call Google directly.
const API = (process.env.GEMINI_BASE_URL?.trim() || "https://generativelanguage.googleapis.com").replace(/\/$/, "");

export const geminiConfigured = () => Boolean(process.env.GEMINI_API_KEY?.trim());
export const geminiModel = () => process.env.GEMINI_MODEL?.trim() || "gemini-3.8-flash";

export class GeminiError extends Error {
  constructor(message: string, readonly status = 0, readonly busy = false, readonly timedOut = false) {
    super(message);
  }
}

export type GeminiPart = { text: string } | { inline_data: { mime_type: string; data: string } } | { file_data: { mime_type: string; file_uri: string } };

const key = () => process.env.GEMINI_API_KEY!.trim();

/** Google's own error text, e.g. "Request contains an invalid argument." */
function googleMessage(body: string) {
  try {
    const m = (JSON.parse(body) as { error?: { message?: string } }).error?.message;
    return m ? m.replace(/\s+/g, " ").slice(0, 200) : "";
  } catch {
    return "";
  }
}

async function call(url: string, init: RequestInit, what: string, attempts = 3) {
  // Google answers 500 and 503 now and then; a quick retry usually gets through. generateJson passes 1 and
  // moves on to a backup model instead, because an overloaded model tends to stay overloaded for a while.
  for (let attempt = 1; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, { ...init, headers: { "x-goog-api-key": key(), ...(init.headers ?? {}) }, signal: init.signal ?? AbortSignal.timeout(120_000) });
    } catch (e) {
      // AbortError: generateJson cancelled this model because another one answered, or its time ran out.
      const timedOut = (e as Error).name === "TimeoutError" || (e as Error).name === "AbortError";
      if ((e as Error).name !== "AbortError") console.error(`Gemini ${what} failed`, e);
      throw new GeminiError(`Couldn't reach Gemini (${timedOut ? "it took too long" : "network error"}). Try again.`, 0, false, timedOut);
    }
    if (res.ok) return res;
    const body = await res.text().catch(() => "");
    const retryable = (res.status === 500 || res.status === 503) && (what === "generate" || init.method === "GET");
    if (retryable && attempt < attempts) {
      await new Promise((r) => setTimeout(r, 1500 * attempt));
      continue;
    }
    const msg = googleMessage(body);
    console.error(`Gemini ${what} failed`, res.status, body.slice(0, 500));
    const s = res.status;
    if (s === 400 && /API key not valid|API_KEY_INVALID/i.test(body)) throw new GeminiError("The Gemini API key on the server was rejected.", s);
    if (s === 401 || s === 403) throw new GeminiError(`The Gemini API key on the server was refused${msg ? `: ${msg}` : "."}`, s);
    if (s === 429) throw new GeminiError("Gemini is busy or the free quota is used up. Try again in a minute.", s, true);
    if (s === 413) throw new GeminiError("That file is too big for Gemini.", s);
    if (s === 503 || s === 500 || s === 504) throw new GeminiError("Gemini is overloaded right now. Try again in a minute.", s, true);
    // A model this key can't use (retired, or not yet available) is worth skipping too.
    if (s === 404 && what === "generate") throw new GeminiError(`Gemini couldn't do it (${what}, ${s})${msg ? `: ${msg}` : "."}`, s, true);
    throw new GeminiError(`Gemini couldn't do it (${what}, ${s})${msg ? `: ${msg}` : "."}`, s);
  }
}

/** Uploads a file through the Files API and waits until Gemini has processed it (videos take a few seconds). */
export async function uploadFile(data: Buffer, mimeType: string, displayName: string): Promise<{ name: string; uri: string; mimeType: string }> {
  const start = await call(`${API}/upload/v1beta/files`, {
    method: "POST",
    headers: {
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(data.length),
      "X-Goog-Upload-Header-Content-Type": mimeType,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ file: { display_name: displayName.slice(0, 120) } }),
  }, "upload start");
  const uploadUrl = start.headers.get("x-goog-upload-url");
  if (!uploadUrl) throw new GeminiError("Gemini didn't accept the upload. Try again.");
  const done = await call(uploadUrl, {
    method: "POST",
    headers: { "X-Goog-Upload-Command": "upload, finalize", "X-Goog-Upload-Offset": "0", "Content-Length": String(data.length) },
    body: new Uint8Array(data),
    signal: AbortSignal.timeout(600_000),
  }, "upload");
  let file = ((await done.json()) as { file: { name: string; uri: string; state?: string; mimeType?: string } }).file;
  const until = Date.now() + 120_000;
  while (file.state === "PROCESSING") {
    if (Date.now() > until) throw new GeminiError("Gemini took too long to read the video. Try a shorter one.");
    await new Promise((r) => setTimeout(r, 1500));
    file = (await (await call(`${API}/v1beta/${file.name}`, { method: "GET", signal: AbortSignal.timeout(15_000) }, "file status")).json()) as typeof file;
  }
  if (file.state === "FAILED") throw new GeminiError("Gemini couldn't read that video.");
  return { name: file.name, uri: file.uri, mimeType: file.mimeType ?? mimeType };
}

/** Whether a file uploaded earlier is still there and ready to use (it may have expired or been deleted). */
export async function fileReady(name: string): Promise<boolean> {
  try {
    const res = await call(`${API}/v1beta/${name}`, { method: "GET", signal: AbortSignal.timeout(8_000) }, "file status", 1);
    return ((await res.json()) as { state?: string }).state === "ACTIVE";
  } catch {
    return false;
  }
}

/** Removes an uploaded file; Gemini also deletes them by itself after 48 hours. */
export async function deleteFile(name: string) {
  await call(`${API}/v1beta/${name}`, { method: "DELETE" }, "file delete").catch(() => {});
}

type Generated = {
  promptFeedback?: { blockReason?: string };
  candidates?: { finishReason?: string; content?: { parts?: { text?: string }[] } }[];
};

let discovered: { at: number; models: string[] } | null = null;

/**
 * Picks backup models from the ones this key can use. Google's "-latest" Flash aliases come first because they
 * point at whatever Flash model Google is serving best right now; then other Flash models, lighter and newer first.
 */
export function pickFallbacks(available: string[], primary: string): string[] {
  const usable = available
    .map((n) => n.replace(/^models\//, ""))
    .filter((n) => /flash/i.test(n) && !/image|tts|audio|live|embed|thinking-exp|robotics|computer|omni/i.test(n) && n !== primary);
  const version = (n: string) => Number(n.match(/gemini-(\d+(?:\.\d+)?)/)?.[1] ?? 0);
  const score = (n: string) => {
    if (n === "gemini-flash-lite-latest") return -1000;
    if (n === "gemini-flash-latest") return -999;
    return (/preview|exp/i.test(n) ? 100 : 0) + (version(n) ? 0 : 50) - version(n) - (/lite/i.test(n) ? 0.5 : 0);
  };
  return [...new Set(usable)].sort((x, y) => score(x) - score(y)).slice(0, 3);
}

/** The model to use first, then backups for when it is overloaded: GEMINI_FALLBACK_MODELS, or found from the key's model list. */
export async function geminiModels(): Promise<string[]> {
  const primary = geminiModel();
  const set = process.env.GEMINI_FALLBACK_MODELS?.split(",").map((m) => m.trim()).filter(Boolean);
  if (set?.length) return [primary, ...set.filter((m) => m !== primary)];
  if (!discovered || Date.now() - discovered.at > 6 * 3600_000) {
    try {
      const res = await call(`${API}/v1beta/models?pageSize=200`, { method: "GET", signal: AbortSignal.timeout(10_000) }, "list models", 1);
      const list = ((await res.json()) as { models?: { name: string; supportedGenerationMethods?: string[] }[] }).models ?? [];
      discovered = { at: Date.now(), models: pickFallbacks(list.filter((m) => m.supportedGenerationMethods?.includes("generateContent")).map((m) => m.name), primary) };
    } catch {
      discovered = { at: Date.now() - 5.5 * 3600_000, models: [] }; // try the list again in 30 minutes
    }
  }
  return [primary, ...discovered.models.filter((m) => m !== primary)];
}

/** How long a model gets before the next one is started alongside it. */
export const HEDGE_MS = 12_000;

/**
 * One generateContent call that must return JSON matching `schema` (an OpenAPI-style schema).
 * Overloaded Gemini models often hang for a long time instead of failing, so this doesn't wait on one model:
 * it starts the main model, and if there's no answer within HEDGE_MS, or it fails as busy, it starts the next
 * one too. The first good answer wins and the rest are cancelled. Everything stops after `budgetMs`.
 */
export async function generateJson(input: { system: string; parts: GeminiPart[]; schema: Record<string, unknown>; video?: boolean; budgetMs?: number; hedgeMs?: number }): Promise<unknown> {
  const models = await geminiModels();
  const budget = Math.floor(input.budgetMs ?? 90_000);
  const hedge = input.hedgeMs ?? HEDGE_MS;
  const stop = new AbortController();
  const deadline = setTimeout(() => stop.abort(), budget);
  const errors: GeminiError[] = [];
  try {
    return await new Promise<unknown>((resolve, reject) => {
      let next = 0;
      let running = 0;
      let done = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = () => {
        if (done || running > 0 || next < models.length) return;
        done = true;
        if (errors.length && errors.every((e) => e.timedOut)) reject(new GeminiError("Gemini took too long to answer. Try again in a minute."));
        else reject(new GeminiError(models.length > 1 ? "Gemini is overloaded on every model right now. Try again in a minute." : "Gemini is overloaded right now. Try again in a minute."));
      };
      const launch = () => {
        clearTimeout(timer);
        if (done || next >= models.length || stop.signal.aborted) return finish();
        const m = models[next++]!;
        running++;
        generateWith(m, input, stop.signal, models.length === 1 ? 2 : 1).then(
          (data) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            stop.abort(); // cancel the models still working
            resolve(data);
          },
          (e) => {
            running--;
            if (done) return;
            if (!(e instanceof GeminiError) || (!e.busy && !e.timedOut)) {
              done = true;
              clearTimeout(timer);
              stop.abort();
              return reject(e);
            }
            console.warn(`Gemini ${m} is busy or slow, trying the next model:`, e.message);
            errors.push(e);
            if (stop.signal.aborted) { next = models.length; return finish(); }
            launch();
          },
        );
        if (next < models.length) timer = setTimeout(launch, hedge);
      };
      stop.signal.addEventListener("abort", () => {
        clearTimeout(timer);
        next = models.length;
      });
      launch();
    });
  } finally {
    clearTimeout(deadline);
  }
}

async function generateWith(model: string, input: { system: string; parts: GeminiPart[]; schema: Record<string, unknown>; video?: boolean }, signal: AbortSignal, attempts: number) {
  const config: Record<string, unknown> = { responseMimeType: "application/json", responseSchema: input.schema, temperature: 0.9 };
  // Low resolution reads a video with about a quarter of the tokens, which is plenty for a caption and much faster.
  if (input.video) config.mediaResolution = "MEDIA_RESOLUTION_LOW";
  // Captions don't need long reasoning; Gemini 3 models think a lot by default.
  if (/gemini-3/.test(model)) config.thinkingConfig = { thinkingLevel: "low" };
  const send = (generationConfig: Record<string, unknown>) =>
    call(`${API}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: input.system }] },
        contents: [{ role: "user", parts: input.parts }],
        generationConfig,
      }),
      signal,
    }, "generate", attempts);
  let res: Response;
  try {
    res = await send(config);
  } catch (e) {
    // An older model may not know these options; ask again without them.
    if (!(e instanceof GeminiError && e.status === 400 && /thinking|media_?resolution/i.test(e.message))) throw e;
    const plain = { ...config };
    delete plain.thinkingConfig;
    delete plain.mediaResolution;
    res = await send(plain);
  }
  const data = (await res.json()) as Generated;
  if (data.promptFeedback?.blockReason) throw new GeminiError("Gemini won't write about this media.");
  const c = data.candidates?.[0];
  if (!c) throw new GeminiError("Gemini returned nothing. Try again.");
  if (c.finishReason === "SAFETY" || c.finishReason === "PROHIBITED_CONTENT") throw new GeminiError("Gemini won't write about this media.");
  if (c.finishReason === "MAX_TOKENS") throw new GeminiError("Gemini ran out of room. Try again.");
  const text = (c.content?.parts ?? []).map((p) => p.text ?? "").join("");
  try {
    return JSON.parse(text);
  } catch {
    throw new GeminiError("Gemini returned something unexpected. Try again.");
  }
}
