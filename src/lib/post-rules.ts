import type { Platform } from "@/db/schema";
import { PLATFORMS } from "./platforms";

export type RuleChannel = { id: string; platform: Platform; handle: string };
export type RuleMedia = { kind: "image" | "video" };

const MEDIA_RULES: Partial<Record<Platform, { min: number; max: number; videoOnly?: boolean; imagesOnly?: boolean; label: string }>> = {
  instagram: { min: 1, max: 10, label: "Instagram posts need 1 to 10 photos or videos." },
  tiktok: { min: 1, max: 1, videoOnly: true, label: "TikTok posts need exactly one video." },
  pinterest: { min: 1, max: 1, label: "Pinterest pins need one image or video." },
  youtube: { min: 1, max: 1, videoOnly: true, label: "YouTube posts need exactly one video." },
  threads: { min: 0, max: 20, label: "Threads posts can have up to 20 photos or videos." },
  bluesky: { min: 0, max: 4, imagesOnly: true, label: "Bluesky posts can have up to 4 photos (no video yet)." },
  mastodon: { min: 0, max: 4, label: "Mastodon posts can have up to 4 photos or videos." },
  google_business: { min: 0, max: 1, imagesOnly: true, label: "Google Business Profile posts can have one photo." },
  devto: { min: 0, max: 10, imagesOnly: true, label: "DEV articles take images only." },
};

/**
 * Checks a post against each channel's limits before it can be scheduled.
 * Returns plain-language problems, empty when the post is ready.
 */
export function checkPost(channels: RuleChannel[], caption: string, overrides: Record<string, string>, media: RuleMedia[]): string[] {
  const problems: string[] = [];
  if (!channels.length) problems.push("Pick at least one channel.");
  for (const ch of channels) {
    const info = PLATFORMS[ch.platform];
    const text = overrides[ch.id] ?? caption;
    if (text.length > info.captionLimit) problems.push(`The ${info.name} caption is ${text.length - info.captionLimit} characters too long.`);
    if (!text.trim() && !media.length) problems.push(`Add a caption or media for ${info.name}.`);
    const rule = MEDIA_RULES[ch.platform];
    if (rule) {
      const usable = rule.videoOnly ? media.filter((m) => m.kind === "video") : media;
      if (usable.length < rule.min || media.length > rule.max || (rule.videoOnly && usable.length !== media.length) || (rule.imagesOnly && media.some((m) => m.kind === "video")))
        problems.push(rule.label);
    }
    if (ch.platform === "google_business" && !text.trim()) problems.push("Google Business Profile posts need text.");
    if (ch.platform === "devto" && !text.split("\n").some((l) => l.trim())) problems.push("DEV articles need a title on the first line.");
  }
  return [...new Set(problems)];
}
