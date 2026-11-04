import type { Platform } from "@/db/schema";

export type PlatformInfo = { name: string; short: string; color: string; captionLimit: number; firstRelease: boolean };

export const PLATFORMS: Record<Platform, PlatformInfo> = {
  instagram: { name: "Instagram", short: "IG", color: "#D6336C", captionLimit: 2200, firstRelease: true },
  facebook: { name: "Facebook", short: "f", color: "#1877F2", captionLimit: 63206, firstRelease: true },
  linkedin: { name: "LinkedIn", short: "in", color: "#0A66C2", captionLimit: 3000, firstRelease: true },
  tiktok: { name: "TikTok", short: "TT", color: "#111827", captionLimit: 2200, firstRelease: true },
  youtube: { name: "YouTube", short: "YT", color: "#E11D2E", captionLimit: 5000, firstRelease: false },
  pinterest: { name: "Pinterest", short: "P", color: "#C8102E", captionLimit: 500, firstRelease: false },
  threads: { name: "Threads", short: "@", color: "#27272A", captionLimit: 500, firstRelease: false },
  bluesky: { name: "Bluesky", short: "bs", color: "#1185FE", captionLimit: 300, firstRelease: false },
  google_business: { name: "Google Business", short: "G", color: "#34A853", captionLimit: 1500, firstRelease: false },
  mastodon: { name: "Mastodon", short: "M", color: "#6364FF", captionLimit: 500, firstRelease: false },
  devto: { name: "DEV.to", short: "DEV", color: "#0A0A0A", captionLimit: 100000, firstRelease: false },
};
