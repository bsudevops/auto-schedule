import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";

/**
 * Outgoing requests to URLs that customers type in (webhooks). Blocks private, loopback, link-local and
 * cloud-metadata addresses, checks the address actually connected to (so DNS tricks don't work),
 * never follows redirects and caps time and response size.
 */

const V4_BLOCKED: [string, number][] = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
];

const v4ToInt = (ip: string) => ip.split(".").reduce((a, o) => (a << 8) + Number(o), 0) >>> 0;
function inV4(ip: string, base: string, bits: number) {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (v4ToInt(ip) & mask) === (v4ToInt(base) & mask);
}

function expandV6(ip: string): number[] | null {
  let s = ip.toLowerCase().split("%")[0]!;
  const v4 = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const n = v4ToInt(v4[1]!);
    s = s.slice(0, -v4[1]!.length) + `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const [head, tail] = s.split("::");
  const h = head ? head.split(":") : [];
  const t = tail !== undefined ? (tail ? tail.split(":") : []) : null;
  const parts = t === null ? h : [...h, ...Array(8 - h.length - t.length).fill("0"), ...t];
  if (parts.length !== 8) return null;
  return parts.map((p) => parseInt(p || "0", 16));
}

export function isPublicAddress(ip: string): boolean {
  if (net.isIPv4(ip)) return !V4_BLOCKED.some(([b, n]) => inV4(ip, b, n));
  if (!net.isIPv6(ip)) return false;
  const w = expandV6(ip);
  if (!w) return false;
  const v4From = (a: number, b: number) => `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`;
  if (w.slice(0, 5).every((x) => x === 0) && w[5] === 0xffff) return isPublicAddress(v4From(w[6]!, w[7]!)); // ::ffff:a.b.c.d
  if (w[0] === 0x64 && w[1] === 0xff9b) return isPublicAddress(v4From(w[6]!, w[7]!)); // NAT64
  if (w.every((x) => x === 0)) return false; // ::
  if (w.slice(0, 7).every((x) => x === 0) && w[7] === 1) return false; // ::1
  if ((w[0]! & 0xfe00) === 0xfc00) return false; // unique local
  if ((w[0]! & 0xffc0) === 0xfe80) return false; // link-local
  if ((w[0]! & 0xff00) === 0xff00) return false; // multicast
  if (w[0] === 0x2001 && w[1] === 0x0db8) return false; // documentation
  if (w[0] === 0x2002) return isPublicAddress(v4From(w[1]!, w[2]!)); // 6to4
  return true;
}

/** Private targets are allowed only for local development, and never in production. */
const allowPrivate = () => process.env.WEBHOOK_ALLOW_PRIVATE === "true" && process.env.NODE_ENV !== "production";

export function checkWebhookUrl(raw: string): { ok: true; url: URL } | { ok: false; error: string } {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, error: "Enter a full URL, starting with https://." };
  }
  if (url.protocol !== "https:" && !(allowPrivate() && url.protocol === "http:")) return { ok: false, error: "Webhook URLs must use https://." };
  if (url.username || url.password) return { ok: false, error: "Put credentials in a header on your side, not in the URL." };
  if (url.href.length > 2000) return { ok: false, error: "That URL is too long." };
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host) && !isPublicAddress(host) && !allowPrivate()) return { ok: false, error: "That address is on a private network. Use a public URL." };
  if (/^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(host) && !allowPrivate()) return { ok: false, error: "That address is on a private network. Use a public URL." };
  return { ok: true, url };
}

type LookupCb = (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void;

function guardedLookup(hostname: string, options: dns.LookupOptions, cb: LookupCb) {
  dns.lookup(hostname, { all: true }, (err, addresses) => {
    if (err) return cb(err, "");
    const bad = addresses.find((a) => !isPublicAddress(a.address));
    if (bad && !allowPrivate()) return cb(Object.assign(new Error(`Blocked private address ${bad.address}`), { code: "EBLOCKED" }), "");
    if (options.all) return cb(null, addresses);
    cb(null, addresses[0]!.address, addresses[0]!.family);
  });
}

export type SafeResponse = { status: number; body: string };

export async function safePost(raw: string, body: string, headers: Record<string, string>, timeoutMs = 10_000): Promise<SafeResponse> {
  const checked = checkWebhookUrl(raw);
  if (!checked.ok) throw new Error(checked.error);
  const url = checked.url;
  const lib = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body).toString(), "User-Agent": "WebhookSender/1.0", ...headers },
        lookup: guardedLookup as unknown as typeof dns.lookup,
        timeout: timeoutMs,
      },
      (res) => {
        let size = 0;
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size <= 4096) chunks.push(c);
          else res.destroy();
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8").slice(0, 1000) }));
        res.on("close", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8").slice(0, 1000) }));
      },
    );
    req.on("timeout", () => req.destroy(new Error(`No response within ${timeoutMs / 1000} seconds`)));
    req.on("error", reject);
    req.end(body);
  });
}

export type SafeRequestInit = { method?: string; headers?: Record<string, string>; body?: string | Buffer; timeoutMs?: number; maxBytes?: number };

/**
 * A general request to a host a customer chose (a Mastodon server): https only, public addresses only
 * (checked on the address actually connected to), no redirects, capped time and size.
 */
export async function safeRequest(raw: string, init: SafeRequestInit = {}): Promise<{ status: number; headers: Record<string, string>; text: string }> {
  const checked = checkWebhookUrl(raw);
  if (!checked.ok) throw new Error(checked.error);
  const url = checked.url;
  const lib = url.protocol === "https:" ? https : http;
  const { method = "GET", headers = {}, body, timeoutMs = 30_000, maxBytes = 2 * 1024 * 1024 } = init;
  return new Promise((resolve, reject) => {
    const req = lib.request(
      url,
      {
        method,
        headers: { "User-Agent": "BSU-Scheduler/1.0", ...(body !== undefined ? { "Content-Length": Buffer.byteLength(body).toString() } : {}), ...headers },
        lookup: guardedLookup as unknown as typeof dns.lookup,
        timeout: timeoutMs,
      },
      (res) => {
        let size = 0;
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > maxBytes) return res.destroy(new Error("The response was too large."));
          chunks.push(c);
        });
        res.on("end", () => {
          const h: Record<string, string> = {};
          for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) h[k] = Array.isArray(v) ? v.join(", ") : v;
          resolve({ status: res.statusCode ?? 0, headers: h, text: Buffer.concat(chunks).toString("utf8") });
        });
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error(`No response within ${timeoutMs / 1000} seconds`)));
    req.on("error", reject);
    req.end(body);
  });
}
