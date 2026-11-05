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

export type Provider = "meta" | "linkedin" | "tiktok" | "threads" | "youtube" | "google_business" | "pinterest" | "bluesky" | "mastodon" | "devto";

/** Extra input a connection needs before the platform's sign-in, such as a Mastodon server. Travels inside the encrypted state cookie. */
export type ConnectContext = Record<string, string>;

/** A field on a form-based connection (an app password or API key instead of signing in on the platform's site). */
export type CredentialField = { name: string; label: string; type: "text" | "password" | "url"; placeholder?: string; help?: string };

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
  /** The environment variables this provider needs. Empty when each customer brings their own credentials. */
  envVars: string[];
  configured(): boolean;
  /**
   * "oauth": the user signs in on the platform's site (the default).
   * "credentials": the user pastes an app password or API key into a form; no server setup needed.
   */
  connect?: "oauth" | "credentials";
  /** OAuth providers that need input before redirecting (a Mastodon server). */
  contextFields?: CredentialField[];
  /** Form fields for credential providers. */
  fields?: CredentialField[];
  /** Checks typed context (a server address) and returns it normalised, or an error to show. */
  prepareContext?(input: Record<string, string>, redirectUri: string): Promise<{ ok: true; ctx: ConnectContext } | { ok: false; error: string }>;
  authorizeUrl(state: string, redirectUri: string, ctx?: ConnectContext): string | Promise<string>;
  exchangeCode(code: string, redirectUri: string, ctx?: ConnectContext): Promise<ConnectedAccount[]>;
  /** Credential providers: checks the pasted credentials with the platform and returns the account. */
  connectWithCredentials?(input: Record<string, string>): Promise<ConnectedAccount[]>;
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
  /** This channel's platform settings for the post, such as YouTube's title and visibility. */
  options?: Record<string, unknown>;
  /** A separate image, such as a YouTube thumbnail chosen in the post's settings. */
  thumbnail?: PublishMedia | null;
};

export type PublishResult = { externalId: string; url: string | null; warnings: string[] };

export interface Publisher {
  publish(input: PublishInput): Promise<PublishResult>;
}
