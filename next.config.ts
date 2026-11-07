import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";
const mediaOrigin = new URL(process.env.MEDIA_PUBLIC_URL || "http://localhost:3001").origin;
// With S3 storage the browser uploads straight to the bucket, so the page may connect to it.
const uploadOrigin =
  process.env.STORAGE_BACKEND === "s3"
    ? new URL(process.env.S3_ENDPOINT_URL || `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.S3_REGION || "us-east-1"}.amazonaws.com`).origin
    : "";

// Google Drive picker (only when it's set up): Google's sign-in and Picker scripts, the Picker's frame and Drive thumbnails.
const drive = Boolean(process.env.GOOGLE_DRIVE_API_KEY?.trim());
const driveScripts = drive ? " https://accounts.google.com https://apis.google.com" : "";
const driveFrames = drive ? " https://accounts.google.com https://docs.google.com https://drive.google.com https://content.googleapis.com" : "";
const driveImages = drive ? " https://*.googleusercontent.com https://ssl.gstatic.com https://www.gstatic.com" : "";
const driveConnect = drive ? " https://accounts.google.com https://www.googleapis.com https://content.googleapis.com" : "";

// Strict CSP. Uploaded media is served from a separate storage origin, never from the app origin.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}${driveScripts}`,
  `style-src 'self' 'unsafe-inline'${drive ? " https://accounts.google.com" : ""}`,
  "font-src 'self'",
  `img-src 'self' data: blob: ${mediaOrigin} https://images.pexels.com${driveImages}`.trim(),
  `media-src 'self' blob: ${mediaOrigin}`.trim(),
  `connect-src 'self' ${uploadOrigin}${driveConnect}`.trim(),
  `frame-src 'self'${driveFrames}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const config: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["bullmq", "ioredis"],
  // Room for a brand logo upload (the browser shrinks it first; the server caps it at 2 MB).
  experimental: { serverActions: { bodySizeLimit: "3mb" } },
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
