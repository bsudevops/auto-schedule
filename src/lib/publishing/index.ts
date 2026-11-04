import type { Platform } from "@/db/schema";
import { facebookPublisher, instagramPublisher, metaProvider } from "./meta";
import { linkedinProvider, linkedinPublisher } from "./linkedin";
import { tiktokProvider, tiktokPublisher } from "./tiktok";
import type { Provider, ProviderAdapter, Publisher } from "./types";

export const PROVIDERS: Record<Provider, ProviderAdapter> = { meta: metaProvider, linkedin: linkedinProvider, tiktok: tiktokProvider };

export const PUBLISHERS: Partial<Record<Platform, Publisher>> = {
  facebook: facebookPublisher,
  instagram: instagramPublisher,
  linkedin: linkedinPublisher,
  tiktok: tiktokPublisher,
};

export function providerFor(platform: Platform): ProviderAdapter | undefined {
  return Object.values(PROVIDERS).find((p) => p.platforms.includes(platform));
}

export const isProvider = (s: string): s is Provider => s in PROVIDERS;

export const callbackUrl = (provider: Provider) => `${(process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "")}/api/channels/callback/${provider}`;

/** Per-channel publishing limits, kept below each platform's own caps. */
export const RATE_LIMITS: Partial<Record<Platform, { max: number; windowSec: number }>> = {
  instagram: { max: 25, windowSec: 86_400 },
  facebook: { max: 50, windowSec: 3_600 },
  linkedin: { max: 50, windowSec: 86_400 },
  tiktok: { max: 15, windowSec: 86_400 },
};

export * from "./types";
