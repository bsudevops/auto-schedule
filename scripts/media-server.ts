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
    res.writeHead(200, {
      "Content-Type": type,
      "Content-Length": s.size,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": "public, max-age=3600",
      "Cross-Origin-Resource-Policy": "cross-origin",
    });
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404).end();
  }
}).listen(port, () => console.log(`Media files served on http://localhost:${port}`));
