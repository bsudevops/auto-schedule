import type { Platform } from "@/db/schema";

export type PlatformInfo = { name: string; short: string; color: string; captionLimit: number };

export const PLATFORMS: Record<Platform, PlatformInfo> = {
  instagram: { name: "Instagram", short: "IG", color: "#E1306C", captionLimit: 2200 },
  facebook: { name: "Facebook", short: "f", color: "#1877F2", captionLimit: 63206 },
  linkedin: { name: "LinkedIn", short: "in", color: "#0A66C2", captionLimit: 3000 },
  tiktok: { name: "TikTok", short: "TT", color: "#000000", captionLimit: 2200 },
  youtube: { name: "YouTube", short: "YT", color: "#FF0000", captionLimit: 5000 },
  pinterest: { name: "Pinterest", short: "P", color: "#E60023", captionLimit: 500 },
  threads: { name: "Threads", short: "@", color: "#000000", captionLimit: 500 },
  bluesky: { name: "Bluesky", short: "bs", color: "#1185FE", captionLimit: 300 },
  google_business: { name: "Google Business", short: "G", color: "#4285F4", captionLimit: 1500 },
  mastodon: { name: "Mastodon", short: "M", color: "#6364FF", captionLimit: 500 },
  devto: { name: "DEV.to", short: "DEV", color: "#0A0A0A", captionLimit: 100000 },
};
