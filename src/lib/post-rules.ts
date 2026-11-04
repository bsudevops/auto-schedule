import type { Platform } from "@/db/schema";
import { PLATFORMS } from "./platforms";

export type RuleChannel = { id: string; platform: Platform; handle: string };
export type RuleMedia = { kind: "image" | "video" };

const MEDIA_RULES: Partial<Record<Platform, { min: number; max: number; videoOnly?: boolean; label: string }>> = {
  instagram: { min: 1, max: 10, label: "Instagram posts need 1 to 10 photos or videos." },
  tiktok: { min: 1, max: 1, videoOnly: true, label: "TikTok posts need exactly one video." },
  pinterest: { min: 1, max: 1, label: "Pinterest pins need one image or video." },
  youtube: { min: 1, max: 1, videoOnly: true, label: "YouTube posts need exactly one video." },
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
      if (usable.length < rule.min || media.length > rule.max || (rule.videoOnly && usable.length !== media.length)) problems.push(rule.label);
    }
  }
  return [...new Set(problems)];
}
