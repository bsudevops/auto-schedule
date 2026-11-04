import { isIP } from "node:net";

/** Parses TRUSTED_PROXIES: comma-separated IPv4 addresses or IPv4 CIDRs. */
export function parseTrusted(list: string | undefined): Array<[number, number]> {
  return (list ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .flatMap((entry) => {
      const [ip, bits = "32"] = entry.split("/");
      const n = ipv4ToInt(ip ?? "");
      const b = Number(bits);
      if (n === null || !(b >= 0 && b <= 32)) return [];
      const mask = b === 0 ? 0 : (~0 << (32 - b)) >>> 0;
      return [[(n & mask) >>> 0, mask] as [number, number]];
    });
}

function ipv4ToInt(ip: string): number | null {
  if (isIP(ip) !== 4) return null;
  return ip.split(".").reduce((acc, o) => ((acc << 8) + Number(o)) >>> 0, 0);
}

function isTrusted(ip: string, trusted: Array<[number, number]>): boolean {
  const n = ipv4ToInt(ip);
  return n !== null && trusted.some(([net, mask]) => ((n & mask) >>> 0) === net);
}

/**
 * The real client IP. X-Forwarded-For is read right to left, skipping only proxies we trust,
 * so a client cannot pick its own IP by sending a fake header.
 */
export function clientIp(remoteAddr: string, forwardedFor: string | null, trustedList = process.env.TRUSTED_PROXIES): string {
  const trusted = parseTrusted(trustedList);
  if (!trusted.length || !isTrusted(remoteAddr, trusted)) return remoteAddr;
  const hops = (forwardedFor ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  for (let i = hops.length - 1; i >= 0; i--) {
    const hop = hops[i]!;
    if (!isTrusted(hop, trusted)) return hop;
  }
  return hops[0] ?? remoteAddr;
}
