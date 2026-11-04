import type { Platform } from "@/db/schema";

/** What kind of failure happened, which decides whether the worker retries. */
export type FailureKind =
  | "auth" // token revoked or expired: the channel needs reconnecting, retrying won't help
  | "rate" // the platform asked us to slow down: retry later
  | "temporary" // network problem or platform outage: retry with backoff
  | "permanent"; // the platform rejected the content: retrying won't help

export class PublishError extends Error {
  constructor(
    message: string,
    readonly kind: FailureKind,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = "PublishError";
  }
  get retryable() {
    return this.kind === "rate" || this.kind === "temporary";
  }
}

export type Provider = "meta" | "linkedin" | "tiktok";

/** An account the platform returned after OAuth. Tokens stay server-side and are encrypted before storage. */
export type ConnectedAccount = {
  platform: Platform;
  externalId: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  followers: number | null;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null; // ISO
  meta: Record<string, unknown>;
};

export type TokenSet = { accessToken: string; refreshToken: string | null; expiresAt: Date | null };

export interface ProviderAdapter {
  id: Provider;
  name: string;
  platforms: Platform[];
  /** The environment variables this provider needs. */
  envVars: string[];
  configured(): boolean;
  authorizeUrl(state: string, redirectUri: string): string;
  exchangeCode(code: string, redirectUri: string): Promise<ConnectedAccount[]>;
  /** Exchanges a refresh token for a new access token. Providers whose tokens don't refresh leave this out. */
  refresh?(refreshToken: string): Promise<TokenSet>;
}

export type PublishMedia = { kind: "image" | "video"; url: string; mimeType: string; sizeBytes: number; altText: string };

export type PublishInput = {
  channel: { externalId: string; handle: string; meta: Record<string, unknown> };
  accessToken: string;
  caption: string;
  firstComment: string;
  media: PublishMedia[];
};

export type PublishResult = { externalId: string; url: string | null; warnings: string[] };

export interface Publisher {
  publish(input: PublishInput): Promise<PublishResult>;
}
