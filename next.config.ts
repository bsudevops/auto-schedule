import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";
const mediaOrigin = new URL(process.env.MEDIA_PUBLIC_URL || "http://localhost:3001").origin;

// Strict CSP. Uploaded media is served from a separate storage origin, never from the app origin.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  `img-src 'self' data: blob: ${mediaOrigin}`.trim(),
  `media-src 'self' blob: ${mediaOrigin}`.trim(),
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const config: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["bullmq", "ioredis"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          ...(isDev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]),
        ],
      },
    ];
  },
};

export default config;
