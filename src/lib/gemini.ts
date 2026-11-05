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

export class GeminiError extends Error {}

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

async function call(url: string, init: RequestInit, what: string) {
  // Google answers 500 and 503 ("the model is overloaded") now and then; two quick retries usually get through.
  for (let attempt = 1; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, { ...init, headers: { "x-goog-api-key": key(), ...(init.headers ?? {}) }, signal: init.signal ?? AbortSignal.timeout(120_000) });
    } catch (e) {
      console.error(`Gemini ${what} failed`, e);
      throw new GeminiError(`Couldn't reach Gemini (${(e as Error).name === "TimeoutError" ? "it took too long" : "network error"}). Try again.`);
    }
    if (res.ok) return res;
    const body = await res.text().catch(() => "");
    const retryable = (res.status === 500 || res.status === 503) && (what === "generate" || init.method === "GET");
    if (retryable && attempt < 3) {
      await new Promise((r) => setTimeout(r, 1500 * attempt));
      continue;
    }
    const msg = googleMessage(body);
    console.error(`Gemini ${what} failed`, res.status, body.slice(0, 500));
    if (res.status === 400 && /API key not valid|API_KEY_INVALID/i.test(body)) throw new GeminiError("The Gemini API key on the server was rejected.");
    if (res.status === 401 || res.status === 403) throw new GeminiError(`The Gemini API key on the server was refused${msg ? `: ${msg}` : "."}`);
    if (res.status === 429) throw new GeminiError("Gemini is busy or the free quota is used up. Try again in a minute.");
    if (res.status === 413) throw new GeminiError("That file is too big for Gemini.");
    if (res.status === 503) throw new GeminiError("Gemini is overloaded right now. Try again in a minute.");
    throw new GeminiError(`Gemini couldn't do it (${what}, ${res.status})${msg ? `: ${msg}` : "."}`);
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
  const until = Date.now() + 180_000;
  while (file.state === "PROCESSING") {
    if (Date.now() > until) throw new GeminiError("Gemini took too long to read the video. Try a shorter one.");
    await new Promise((r) => setTimeout(r, 2000));
    file = (await (await call(`${API}/v1beta/${file.name}`, { method: "GET" }, "file status")).json()) as typeof file;
  }
  if (file.state === "FAILED") throw new GeminiError("Gemini couldn't read that video.");
  return { name: file.name, uri: file.uri, mimeType: file.mimeType ?? mimeType };
}

/** Removes an uploaded file; Gemini also deletes them by itself after 48 hours. */
export async function deleteFile(name: string) {
  await call(`${API}/v1beta/${name}`, { method: "DELETE" }, "file delete").catch(() => {});
}

/** One generateContent call that must return JSON matching `schema` (an OpenAPI-style schema). */
export async function generateJson(input: { system: string; parts: GeminiPart[]; schema: Record<string, unknown> }): Promise<unknown> {
  const res = await call(`${API}/v1beta/models/${encodeURIComponent(geminiModel())}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: input.system }] },
      contents: [{ role: "user", parts: input.parts }],
      generationConfig: { responseMimeType: "application/json", responseSchema: input.schema, temperature: 0.9 },
    }),
  }, "generate");
  const data = (await res.json()) as {
    promptFeedback?: { blockReason?: string };
    candidates?: { finishReason?: string; content?: { parts?: { text?: string }[] } }[];
  };
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
