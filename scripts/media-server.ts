/**
 * Development-only file server for uploaded media, on its own port (a separate origin from the app).
 * In production, serve the bucket from S3, R2 or a CDN domain instead.
 */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";

const root = path.resolve(process.env.STORAGE_DIR ?? "./storage");
const port = Number(new URL(process.env.MEDIA_PUBLIC_URL || "http://localhost:3001").port || 3001);
const TYPES: Record<string, string> = { ".jpg": "image/jpeg", ".png": "image/png", ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm" };

createServer(async (req, res) => {
  const rel = decodeURIComponent((req.url ?? "/").split("?")[0]!);
  const file = path.resolve(root, "." + rel);
  const type = TYPES[path.extname(file)];
  if (!file.startsWith(root + path.sep) || !type) return void res.writeHead(404).end();
  try {
    const s = await stat(file);
    const headers: Record<string, string | number> = {
      "Content-Type": type,
      "Accept-Ranges": "bytes",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": "public, max-age=3600",
      "Cross-Origin-Resource-Policy": "cross-origin",
      // Lets the composer read video frames into a canvas (crossOrigin="anonymous") to make thumbnails.
      "Access-Control-Allow-Origin": "*",
    };
    // Range requests, so browsers can seek in videos.
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
    if (range && (range[1] || range[2])) {
      let start = range[1] ? Number(range[1]) : Math.max(0, s.size - Number(range[2]));
      let end = range[1] && range[2] ? Math.min(Number(range[2]), s.size - 1) : s.size - 1;
      if (start >= s.size || start > end) return void res.writeHead(416, { "Content-Range": `bytes */${s.size}` }).end();
      start = Math.max(0, start);
      end = Math.max(start, end);
      res.writeHead(206, { ...headers, "Content-Range": `bytes ${start}-${end}/${s.size}`, "Content-Length": end - start + 1 });
      return void createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { ...headers, "Content-Length": s.size });
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404).end();
  }
}).listen(port, () => console.log(`Media files served on http://localhost:${port}`));
