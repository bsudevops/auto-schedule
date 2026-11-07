import type { Platform } from "@/db/schema";
import { facebookPublisher, instagramPublisher, metaProvider } from "./meta";
import { linkedinPagesProvider, linkedinProvider, linkedinPublisher } from "./linkedin";
import { tiktokProvider, tiktokPublisher } from "./tiktok";
import { threadsProvider, threadsPublisher } from "./threads";
import { googleBusinessProvider, googleBusinessPublisher, youtubeProvider, youtubePublisher } from "./google";
import { pinterestProvider, pinterestPublisher } from "./pinterest";
import { blueskyProvider, blueskyPublisher } from "./bluesky";
import { mastodonProvider, mastodonPublisher } from "./mastodon";
import { devtoProvider, devtoPublisher } from "./devto";
import type { Provider, ProviderAdapter, Publisher } from "./types";

export const PROVIDERS: Record<Provider, ProviderAdapter> = {
  meta: metaProvider,
  linkedin: linkedinProvider,
  linkedin_pages: linkedinPagesProvider,
  tiktok: tiktokProvider,
  threads: threadsProvider,
  youtube: youtubeProvider,
  google_business: googleBusinessProvider,
  pinterest: pinterestProvider,
  bluesky: blueskyProvider,
  mastodon: mastodonProvider,
  devto: devtoProvider,
};

export const PUBLISHERS: Partial<Record<Platform, Publisher>> = {
  facebook: facebookPublisher,
  instagram: instagramPublisher,
  linkedin: linkedinPublisher,
  tiktok: tiktokPublisher,
  threads: threadsPublisher,
  youtube: youtubePublisher,
  google_business: googleBusinessPublisher,
  pinterest: pinterestPublisher,
  bluesky: blueskyPublisher,
  mastodon: mastodonPublisher,
  devto: devtoPublisher,
};

export function providerFor(platform: Platform): ProviderAdapter | undefined {
  return Object.values(PROVIDERS).find((p) => p.platforms.includes(platform));
}

/** The provider that connected this channel: LinkedIn company pages may come from their own app. */
export function providerForChannel(c: { platform: Platform; meta?: unknown }): ProviderAdapter | undefined {
  const meta = (c.meta ?? {}) as { app?: string };
  if (c.platform === "linkedin" && meta.app === "pages") return PROVIDERS.linkedin_pages;
  return providerFor(c.platform);
}

export const isProvider = (s: string): s is Provider => s in PROVIDERS;

export const callbackUrl = (provider: Provider) => `${(process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "")}/api/channels/callback/${provider}`;

/** Per-channel publishing limits, kept below each platform's own caps. */
export const RATE_LIMITS: Partial<Record<Platform, { max: number; windowSec: number }>> = {
  instagram: { max: 25, windowSec: 86_400 },
  facebook: { max: 50, windowSec: 3_600 },
  linkedin: { max: 50, windowSec: 86_400 },
  tiktok: { max: 15, windowSec: 86_400 },
  threads: { max: 200, windowSec: 86_400 }, // Threads allows 250 posts a day
  youtube: { max: 6, windowSec: 86_400 }, // an upload costs 1,600 of the default 10,000 daily quota units
  google_business: { max: 20, windowSec: 86_400 },
  pinterest: { max: 50, windowSec: 86_400 },
  bluesky: { max: 100, windowSec: 3_600 },
  mastodon: { max: 60, windowSec: 3_600 },
  devto: { max: 10, windowSec: 86_400 },
};

export * from "./types";
