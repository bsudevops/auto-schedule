// A stand-in for the Gemini API in end-to-end tests: answers uploads and generateContent with canned data.
import { createServer } from "node:http";

const PORT = Number(process.env.MOCK_GEMINI_PORT ?? 3999);
let last = null;
let busy = false; // POST /__busy makes the main model answer 503, like Google under high demand
let uploads = 0;

createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  const json = (code, data, headers = {}) => { res.writeHead(code, { "content-type": "application/json", ...headers }); res.end(JSON.stringify(data)); };
  if (req.headers["x-goog-api-key"] !== "e2e-gemini-key") return json(403, { error: { message: "API key not valid" } });
  const url = req.url ?? "";
  if (url === "/__last") return json(200, { ...(last ?? {}), uploads });
  if (url === "/__busy") { busy = req.method === "POST"; return json(200, { busy }); }
  if (url.startsWith("/v1beta/models?")) {
    return json(200, { models: ["gemini-3.8-flash", "gemini-3.8-flash-lite", "gemini-3.8-flash-image", "text-embedding-004"].map((n) => ({ name: `models/${n}`, supportedGenerationMethods: n.startsWith("text") ? ["embedContent"] : ["generateContent"] })) });
  }
  if (url.startsWith("/upload/v1beta/files")) {
    if (req.headers["x-goog-upload-command"] === "start") return json(200, {}, { "x-goog-upload-url": `http://localhost:${PORT}/upload/v1beta/files?session=1` });
    uploads++;
    return json(200, { file: { name: "files/e2e1", uri: `http://localhost:${PORT}/v1beta/files/e2e1`, state: "ACTIVE", mimeType: req.headers["x-goog-upload-header-content-type"] ?? "video/mp4", bytes: body.length } });
  }
  if (url.startsWith("/v1beta/files/")) return json(200, req.method === "DELETE" ? {} : { name: "files/e2e1", uri: "x", state: "ACTIVE" });
  if (url.includes(":generateContent")) {
    const model = decodeURIComponent(url.match(/models\/([^:]+):/)?.[1] ?? "");
    if (busy && model === "gemini-3.8-flash") return json(503, { error: { code: 503, message: "This model is currently experiencing high demand.", status: "UNAVAILABLE" } });
    const parsed = JSON.parse(body.toString());
    const parts = parsed.contents[0].parts;
    last = { model, config: parsed.generationConfig, kinds: parts.map((p) => Object.keys(p)[0]), text: parts.at(-1).text };
    const wantTitle = /Also write 3 YouTube titles/.test(last.text);
    const answer = {
      captions: ["Fresh from the roaster: our cold brew is back for the season.", "Slow-steeped for 18 hours, poured over ice."],
      titles: wantTitle ? ["How we make cold brew, start to finish"] : [],
      hashtags: ["coldbrew", "#coffee"],
    };
    return json(200, { candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(answer) }] } }] });
  }
  json(404, {});
}).listen(PORT, () => console.log(`Mock Gemini on ${PORT}`));
