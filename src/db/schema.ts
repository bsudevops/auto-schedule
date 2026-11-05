import { relations, sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

/**
 * Mastodon has no central app registry: we register an app on each server the first time someone
 * connects from it, and reuse it after that. The secret is encrypted.
 */
export const mastodonApps = pgTable(
  "mastodon_apps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    instance: text("instance").notNull(),
    redirectUri: text("redirect_uri").notNull(),
    clientId: text("client_id").notNull(),
    clientSecretEnc: text("client_secret_enc").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("mastodon_apps_instance_redirect_uq").on(t.instance, t.redirectUri)],
);

/* ------------------------------------------------------------------ */
/* Auth tables (shape required by Better Auth)                         */
/* ------------------------------------------------------------------ */

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  // Deactivated users lose sessions and API keys immediately (see lib/session.ts).
  deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  token: text("token").notNull().unique(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  password: text("password"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/* ------------------------------------------------------------------ */
/* Organizations, workspaces, members                                  */
/* ------------------------------------------------------------------ */

export const orgRole = pgEnum("org_role", ["owner", "admin", "member"]);
export const workspaceRole = pgEnum("workspace_role", ["owner", "manager", "editor", "contributor", "viewer"]);

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  // Set when deletion is requested; data is purged 14 days later.
  deletionRequestedAt: timestamp("deletion_requested_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const orgMembers = pgTable(
  "org_members",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: orgRole("role").notNull().default("member"),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.userId] })],
);

export const workspaces = pgTable(
  "workspaces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color").notNull().default("#2B86F5"),
    timezone: text("timezone").notNull().default("UTC"),
    iconKey: text("icon_key"),
    defaultHashtags: text("default_hashtags").notNull().default(""),
    defaultFirstComment: text("default_first_comment").notNull().default(""),
    // One-click replies shown in the inbox.
    savedReplies: text("saved_replies")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("workspaces_org_idx").on(t.orgId)],
);

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: workspaceRole("role").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] }), index("workspace_members_user_idx").on(t.userId)],
);

export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: workspaceRole("role").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    invitedBy: text("invited_by").references(() => user.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("invitations_workspace_idx").on(t.workspaceId)],
);

/* ------------------------------------------------------------------ */
/* Channels (connected social accounts)                                */
/* ------------------------------------------------------------------ */

export const platform = pgEnum("platform", [
  "instagram",
  "facebook",
  "linkedin",
  "tiktok",
  "youtube",
  "pinterest",
  "threads",
  "bluesky",
  "google_business",
  "mastodon",
  "devto",
]);
export const channelStatus = pgEnum("channel_status", ["connected", "expiring", "reconnect", "disconnected"]);

export const channels = pgTable(
  "channels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    platform: platform("platform").notNull(),
    externalId: text("external_id").notNull(),
    handle: text("handle").notNull(),
    displayName: text("display_name").notNull(),
    avatarUrl: text("avatar_url"),
    // Encrypted with lib/crypto.ts (AES-256-GCM). Never stored in plain text.
    accessTokenEnc: text("access_token_enc"),
    refreshTokenEnc: text("refresh_token_enc"),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    status: channelStatus("status").notNull().default("connected"),
    lastError: text("last_error"),
    followers: integer("followers"),
    // Platform-specific details needed to publish, such as the LinkedIn author URN or the Facebook Page behind an Instagram account.
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    lastPublishedAt: timestamp("last_published_at", { withTimezone: true }),
    connectedBy: text("connected_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("channels_ws_platform_ext_uq").on(t.workspaceId, t.platform, t.externalId)],
);

/**
 * Accounts returned by a platform after OAuth, waiting for the user to pick which ones to add.
 * The payload (which includes tokens) is encrypted and the row expires after 15 minutes.
 */
export const pendingConnections = pgTable("pending_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  payloadEnc: text("payload_enc").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

/* ------------------------------------------------------------------ */
/* Media                                                               */
/* ------------------------------------------------------------------ */

export const mediaKind = pgEnum("media_kind", ["image", "video"]);

export const mediaFolders = pgTable(
  "media_folders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id"),
    name: text("name").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("media_folders_ws_idx").on(t.workspaceId)],
);

export const mediaAssets = pgTable(
  "media_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    folderId: uuid("folder_id").references(() => mediaFolders.id, { onDelete: "set null" }),
    // Server-chosen storage key and extension. The original filename is display-only.
    storageKey: text("storage_key").notNull().unique(),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    kind: mediaKind("kind").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    width: integer("width"),
    height: integer("height"),
    durationMs: integer("duration_ms"),
    altText: text("alt_text").notNull().default(""),
    uploadedBy: text("uploaded_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("media_assets_ws_idx").on(t.workspaceId, t.createdAt)],
);

export const mediaVariants = pgTable("media_variants", {
  id: uuid("id").primaryKey().defaultRandom(),
  assetId: uuid("asset_id")
    .notNull()
    .references(() => mediaAssets.id, { onDelete: "cascade" }),
  preset: text("preset").notNull(), // e.g. "instagram_portrait", "facebook_landscape"
  storageKey: text("storage_key").notNull().unique(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
});

/* ------------------------------------------------------------------ */
/* Posts                                                               */
/* ------------------------------------------------------------------ */

export const postStatus = pgEnum("post_status", [
  "draft",
  "scheduled",
  "publishing",
  "published",
  "partially_failed",
  "failed",
]);
export const targetStatus = pgEnum("target_status", ["pending", "publishing", "published", "failed"]);

export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color").notNull().default("#2B86F5"),
  },
  (t) => [uniqueIndex("categories_ws_name_uq").on(t.workspaceId, t.name)],
);

export const queues = pgTable("queues", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  createdAt: createdAt(),
});

export const queueSlots = pgTable("queue_slots", {
  id: uuid("id").primaryKey().defaultRandom(),
  queueId: uuid("queue_id")
    .notNull()
    .references(() => queues.id, { onDelete: "cascade" }),
  weekday: smallint("weekday").notNull(), // 0 = Sunday
  minuteOfDay: smallint("minute_of_day").notNull(), // in the workspace time zone
});

export const queueChannels = pgTable(
  "queue_channels",
  {
    queueId: uuid("queue_id")
      .notNull()
      .references(() => queues.id, { onDelete: "cascade" }),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.queueId, t.channelId] })],
);

export const posts = pgTable(
  "posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    authorId: text("author_id").references(() => user.id, { onDelete: "set null" }),
    caption: text("caption").notNull().default(""),
    firstComment: text("first_comment").notNull().default(""),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
    tags: text("tags")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    status: postStatus("status").notNull().default("draft"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    queueId: uuid("queue_id").references(() => queues.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("posts_ws_sched_idx").on(t.workspaceId, t.scheduledAt), index("posts_ws_status_idx").on(t.workspaceId, t.status)],
);

/** One post on one channel. Each target publishes as its own job. */
export const postTargets = pgTable(
  "post_targets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    captionOverride: text("caption_override"),
    status: targetStatus("status").notNull().default("pending"),
    externalPostId: text("external_post_id"),
    externalUrl: text("external_url"),
    error: text("error"),
    attempts: smallint("attempts").notNull().default(0),
    // Cron mode only: the target isn't tried again before this time (retry back-off, rate-limit wait, or a claim in progress).
    retryAt: timestamp("retry_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("post_targets_post_channel_uq").on(t.postId, t.channelId)],
);

export const postMedia = pgTable(
  "post_media",
  {
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => mediaAssets.id, { onDelete: "cascade" }),
    position: smallint("position").notNull(),
  },
  (t) => [primaryKey({ columns: [t.postId, t.assetId] })],
);

/** Kept for 90 days. */
export const publishLog = pgTable(
  "publish_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    targetId: uuid("target_id")
      .notNull()
      .references(() => postTargets.id, { onDelete: "cascade" }),
    ok: boolean("ok").notNull(),
    detail: jsonb("detail"),
    createdAt: createdAt(),
  },
  (t) => [index("publish_log_created_idx").on(t.createdAt)],
);

/* ------------------------------------------------------------------ */
/* Ideas                                                               */
/* ------------------------------------------------------------------ */

export const ideaColumn = pgEnum("idea_column", ["idea", "research", "writing", "ready"]);

export const ideas = pgTable(
  "ideas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    notes: text("notes").notNull().default(""),
    column: ideaColumn("column").notNull().default("idea"),
    position: integer("position").notNull().default(0),
    tags: text("tags")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("ideas_ws_col_idx").on(t.workspaceId, t.column, t.position)],
);

/** What the team did in a workspace, newest first on the overview. Kept for 180 days. */
export const activityLog = pgTable(
  "activity_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    actorId: text("actor_id").references(() => user.id, { onDelete: "set null" }),
    verb: text("verb").notNull(),
    summary: text("summary").notNull(),
    href: text("href"),
    createdAt: createdAt(),
  },
  (t) => [index("activity_ws_created_idx").on(t.workspaceId, t.createdAt)],
);

/** Named groups of hashtags people insert into captions with one click. */
export const hashtagSets = pgTable(
  "hashtag_sets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    tags: text("tags")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("hashtag_sets_ws_name_uq").on(t.workspaceId, t.name)],
);

/* ------------------------------------------------------------------ */
/* Inbox                                                               */
/* ------------------------------------------------------------------ */

export const inboxKind = pgEnum("inbox_kind", ["comment", "mention", "message", "review"]);
export const sentiment = pgEnum("sentiment", ["positive", "neutral", "negative"]);

export const inboxThreads = pgTable(
  "inbox_threads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    kind: inboxKind("kind").notNull(),
    externalId: text("external_id").notNull(),
    subject: text("subject").notNull().default(""),
    authorName: text("author_name").notNull(),
    sentiment: sentiment("sentiment").notNull().default("neutral"),
    assignedTo: text("assigned_to").references(() => user.id, { onDelete: "set null" }),
    // The published post the conversation is on, when there is one.
    postTargetId: uuid("post_target_id").references(() => postTargets.id, { onDelete: "set null" }),
    // Platform IDs needed to reply, such as the LinkedIn post URN.
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    unread: boolean("unread").notNull().default(true),
    doneAt: timestamp("done_at", { withTimezone: true }),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("inbox_threads_channel_ext_uq").on(t.channelId, t.externalId),
    index("inbox_threads_ws_last_idx").on(t.workspaceId, t.lastMessageAt),
  ],
);

export const inboxMessages = pgTable(
  "inbox_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => inboxThreads.id, { onDelete: "cascade" }),
    fromUs: boolean("from_us").notNull(),
    sentBy: text("sent_by").references(() => user.id, { onDelete: "set null" }),
    authorName: text("author_name"),
    body: text("body").notNull(),
    externalId: text("external_id"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("inbox_messages_thread_ext_uq").on(t.threadId, t.externalId), index("inbox_messages_thread_idx").on(t.threadId, t.createdAt)],
);

/* ------------------------------------------------------------------ */
/* Analytics                                                           */
/* ------------------------------------------------------------------ */

/** One row per channel per day, in the workspace's time zone. Figures a platform doesn't offer stay null. */
export const channelMetricsDaily = pgTable(
  "channel_metrics_daily",
  {
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
    followers: integer("followers"),
    impressions: integer("impressions"),
    reach: integer("reach"),
    engagements: integer("engagements"),
    videoViews: integer("video_views"),
    linkClicks: integer("link_clicks"),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.channelId, t.day] })],
);

/** Latest totals for one published post on one channel. */
export const postMetrics = pgTable("post_metrics", {
  targetId: uuid("target_id")
    .primaryKey()
    .references(() => postTargets.id, { onDelete: "cascade" }),
  impressions: integer("impressions"),
  reach: integer("reach"),
  likes: integer("likes"),
  comments: integer("comments"),
  shares: integer("shares"),
  saves: integer("saves"),
  videoViews: integer("video_views"),
  clicks: integer("clicks"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ------------------------------------------------------------------ */
/* Notifications and API keys                                          */
/* ------------------------------------------------------------------ */

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull().default({}),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_user_idx").on(t.userId, t.createdAt)],
);

export const notificationPrefs = pgTable(
  "notification_prefs",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    inApp: boolean("in_app").notNull().default(true),
    email: boolean("email").notNull().default(true),
    webhook: boolean("webhook").notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.userId, t.type] })],
);

export const apiKeys = pgTable("api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  prefix: text("prefix").notNull(),
  // SHA-256 of the full key. The key itself is shown once and never stored.
  keyHash: text("key_hash").notNull().unique(),
  scopes: text("scopes").array().notNull(),
  createdBy: text("created_by")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  // Set for short-lived access tokens issued to a connected app (OAuth). Those are listed under "Connected AI apps", not here.
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  oauthClientId: text("oauth_client_id").references(() => oauthClients.id, { onDelete: "cascade" }),
  createdAt: createdAt(),
});

/** Apps such as Claude that registered themselves to sign people in (OAuth dynamic client registration). */
export const oauthClients = pgTable("oauth_clients", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  redirectUris: text("redirect_uris").array().notNull(),
  // SHA-256 of the client secret, or null for public clients that rely on PKCE alone.
  secretHash: text("secret_hash"),
  createdAt: createdAt(),
});

/** One-time sign-in codes, valid for 10 minutes. Only the hash is stored. */
export const oauthCodes = pgTable("oauth_codes", {
  codeHash: text("code_hash").primaryKey(),
  clientId: text("client_id")
    .notNull()
    .references(() => oauthClients.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  scopes: text("scopes").array().notNull(),
  redirectUri: text("redirect_uri").notNull(),
  codeChallenge: text("code_challenge").notNull(),
  resource: text("resource"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: createdAt(),
});

/** A person's approval for a connected app to use one workspace. Holds the current refresh token, rotated on every use. */
export const oauthGrants = pgTable("oauth_grants", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: text("client_id")
    .notNull()
    .references(() => oauthClients.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  scopes: text("scopes").array().notNull(),
  refreshHash: text("refresh_hash").notNull().unique(),
  refreshExpiresAt: timestamp("refresh_expires_at", { withTimezone: true }).notNull(),
  accessKeyId: uuid("access_key_id").references(() => apiKeys.id, { onDelete: "set null" }),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: createdAt(),
});

/** Outgoing webhooks. The signing secret is encrypted; the full value is shown once when created. */
export const webhooks = pgTable(
  "webhooks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    secretEnc: text("secret_enc").notNull(),
    events: text("events").array().notNull(),
    active: boolean("active").notNull().default(true),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    lastDeliveryAt: timestamp("last_delivery_at", { withTimezone: true }),
    lastStatus: text("last_status"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("webhooks_ws_idx").on(t.workspaceId)],
);

/** Kept for 30 days. */
export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    webhookId: uuid("webhook_id")
      .notNull()
      .references(() => webhooks.id, { onDelete: "cascade" }),
    event: text("event").notNull(),
    payload: jsonb("payload").notNull(),
    status: text("status").notNull().default("pending"), // pending | delivered | failed
    responseCode: integer("response_code"),
    error: text("error"),
    attempts: smallint("attempts").notNull().default(0),
    // Cron mode only: don't try again before this time.
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    createdAt: createdAt(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  },
  (t) => [index("webhook_deliveries_hook_idx").on(t.webhookId, t.createdAt)],
);

/* ------------------------------------------------------------------ */
/* Relations                                                           */
/* ------------------------------------------------------------------ */

export const workspacesRelations = relations(workspaces, ({ one, many }) => ({
  org: one(organizations, { fields: [workspaces.orgId], references: [organizations.id] }),
  members: many(workspaceMembers),
  channels: many(channels),
}));

export const workspaceMembersRelations = relations(workspaceMembers, ({ one }) => ({
  workspace: one(workspaces, { fields: [workspaceMembers.workspaceId], references: [workspaces.id] }),
  user: one(user, { fields: [workspaceMembers.userId], references: [user.id] }),
}));

export const channelsRelations = relations(channels, ({ one }) => ({
  workspace: one(workspaces, { fields: [channels.workspaceId], references: [workspaces.id] }),
}));

export const postsRelations = relations(posts, ({ one, many }) => ({
  author: one(user, { fields: [posts.authorId], references: [user.id] }),
  targets: many(postTargets),
  media: many(postMedia),
}));

export const postTargetsRelations = relations(postTargets, ({ one }) => ({
  post: one(posts, { fields: [postTargets.postId], references: [posts.id] }),
  channel: one(channels, { fields: [postTargets.channelId], references: [channels.id] }),
}));

export const postMediaRelations = relations(postMedia, ({ one }) => ({
  post: one(posts, { fields: [postMedia.postId], references: [posts.id] }),
  asset: one(mediaAssets, { fields: [postMedia.assetId], references: [mediaAssets.id] }),
}));

export type WorkspaceRole = (typeof workspaceRole.enumValues)[number];
export type Platform = (typeof platform.enumValues)[number];
