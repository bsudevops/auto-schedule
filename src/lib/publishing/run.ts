import { and, asc, eq, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { channels, mediaAssets, mediaVariants, postMedia, postTargets, posts, publishLog } from "@/db/schema";
import { publicUrl } from "../media/storage";
import { notify, workspaceManagers } from "../notify";
import { emitEvent } from "../webhooks";
import { PLATFORMS } from "../platforms";
import { PUBLISHERS, RATE_LIMITS } from "./index";
import { pickImageKey } from "./media";
import { takeSlot } from "./rate-limit";
import { accessTokenFor, flagChannel } from "./tokens";
import { PublishError } from "./types";

export type Outcome =
  | { outcome: "published" | "failed" | "skipped" }
  | { outcome: "retry"; error: PublishError }
  | { outcome: "delay"; ms: number };

/**
 * Dry-run mode pretends every publish succeeds. It's for trying the product without platform apps.
 * A production build only honours it when the app runs on localhost (end-to-end tests), never on a real domain.
 */
export const dryRun = () => {
  if (process.env.PUBLISH_DRY_RUN !== "true") return false;
  if (process.env.NODE_ENV !== "production") return true;
  try {
    return ["localhost", "127.0.0.1"].includes(new URL(process.env.APP_URL ?? "").hostname);
  } catch {
    return false;
  }
};

/**
 * Publishes one post to one channel. Called by the worker for each job.
 * `attemptsMade` counts earlier attempts of this job; `maxAttempts` is the job's limit.
 */
export async function publishTarget(targetId: string, attemptsMade: number, maxAttempts: number): Promise<Outcome> {
  const [row] = await db
    .select({ target: postTargets, post: posts, channel: channels })
    .from(postTargets)
    .innerJoin(posts, eq(posts.id, postTargets.postId))
    .innerJoin(channels, eq(channels.id, postTargets.channelId))
    .where(eq(postTargets.id, targetId));
  if (!row || row.target.status === "published" || row.target.status === "failed" || row.post.status !== "publishing") return { outcome: "skipped" };
  const { target, post, channel } = row;

  await db.update(postTargets).set({ status: "publishing", attempts: sql`${postTargets.attempts} + 1` }).where(eq(postTargets.id, target.id));

  try {
    if (channel.status === "disconnected") throw new PublishError("The channel was disconnected.", "permanent");
    if (channel.status === "reconnect") throw new PublishError(`${PLATFORMS[channel.platform].name} needs reconnecting before it can publish.`, "auth");

    const limit = RATE_LIMITS[channel.platform];
    if (limit && !dryRun()) {
      const waitSec = await takeSlot(channel.id, limit);
      if (waitSec > 0) {
        await db.update(postTargets).set({ error: `Waiting for the ${PLATFORMS[channel.platform].name} posting limit to reset.` }).where(eq(postTargets.id, target.id));
        return { outcome: "delay", ms: waitSec * 1000 };
      }
    }

    const media = await loadMedia(post.id, channel.platform);
    const caption = target.captionOverride ?? post.caption;
    let result;
    if (dryRun()) {
      result = { externalId: `dry-run-${target.id}`, url: null, warnings: ["Dry run: nothing was sent to the platform."] };
    } else {
      const publisher = PUBLISHERS[channel.platform];
      if (!publisher) throw new PublishError(`Publishing to ${PLATFORMS[channel.platform].name} isn't available yet.`, "permanent");
      const accessToken = await accessTokenFor(channel);
      result = await publisher.publish({
        channel: { externalId: channel.externalId, handle: channel.handle, meta: channel.meta },
        accessToken,
        caption,
        firstComment: post.firstComment,
        media,
      });
    }

    const now = new Date();
    await db.update(postTargets).set({ status: "published", externalPostId: result.externalId, externalUrl: result.url, error: null, publishedAt: now }).where(eq(postTargets.id, target.id));
    await db.update(channels).set({ lastPublishedAt: now }).where(eq(channels.id, channel.id));
    await db.insert(publishLog).values({ targetId: target.id, ok: true, detail: { externalId: result.externalId, url: result.url, warnings: result.warnings, attempt: attemptsMade + 1 } });
    await settlePost(post.id);
    return { outcome: "published" };
  } catch (e) {
    const err = e instanceof PublishError ? e : new PublishError(`Unexpected error: ${(e as Error).message}`, "temporary");
    await db.insert(publishLog).values({ targetId: target.id, ok: false, detail: { kind: err.kind, message: err.message, attempt: attemptsMade + 1, platform: err.detail ?? null } });
    if (err.kind === "auth") await flagChannel(channel, "reconnect", err.message);

    const lastTry = attemptsMade + 1 >= maxAttempts;
    if (err.retryable && !lastTry) {
      await db.update(postTargets).set({ error: `${err.message} Retrying automatically.` }).where(eq(postTargets.id, target.id));
      return { outcome: "retry", error: err };
    }
    await db.update(postTargets).set({ status: "failed", error: err.message }).where(eq(postTargets.id, target.id));
    await settlePost(post.id);
    return { outcome: "failed" };
  }
}

async function loadMedia(postId: string, platform: keyof typeof PLATFORMS) {
  const rows = await db
    .select({ asset: mediaAssets })
    .from(postMedia)
    .innerJoin(mediaAssets, eq(mediaAssets.id, postMedia.assetId))
    .where(eq(postMedia.postId, postId))
    .orderBy(asc(postMedia.position));
  const ids = rows.map((r) => r.asset.id);
  const variants = ids.length ? await db.select().from(mediaVariants).where(inArray(mediaVariants.assetId, ids)) : [];
  return rows.map(({ asset }) => ({
    kind: asset.kind,
    mimeType: asset.mimeType,
    sizeBytes: asset.sizeBytes,
    altText: asset.altText,
    url: publicUrl(asset.kind === "image" ? pickImageKey(platform, asset, variants.filter((v) => v.assetId === asset.id)) : asset.storageKey),
  }));
}

/** The post's overall status, from its targets' statuses. */
export function postStatusFrom(statuses: string[]): "published" | "failed" | "partially_failed" | "publishing" {
  if (!statuses.length) return "failed";
  if (statuses.some((s) => s === "pending" || s === "publishing")) return "publishing";
  const ok = statuses.filter((s) => s === "published").length;
  if (ok === statuses.length) return "published";
  return ok === 0 ? "failed" : "partially_failed";
}

/** Once every target has finished, moves the post to its final status and notifies people. Only one caller wins the change. */
export async function settlePost(postId: string) {
  const targets = await db
    .select({ status: postTargets.status, error: postTargets.error, channelId: postTargets.channelId, url: postTargets.externalUrl, platform: channels.platform })
    .from(postTargets)
    .innerJoin(channels, eq(channels.id, postTargets.channelId))
    .where(eq(postTargets.postId, postId));
  const status = postStatusFrom(targets.map((t) => t.status));
  if (status === "publishing") return;
  const anyPublished = targets.some((t) => t.status === "published");
  const [post] = await db
    .update(posts)
    .set({ status, publishedAt: anyPublished ? new Date() : null })
    .where(and(eq(posts.id, postId), eq(posts.status, "publishing")))
    .returning();
  if (!post) return;

  const title = post.caption.split("\n")[0]!.slice(0, 60) || "Untitled post";
  await emitEvent(post.workspaceId, status === "published" ? "post.published" : "post.failed", {
    postId: post.id,
    status,
    caption: post.caption,
    channels: targets.map((t) => ({ channelId: t.channelId, platform: t.platform, status: t.status, url: t.url, error: t.error })),
  });
  const href = `/w/${post.workspaceId}/posts/${post.id}`;
  if (status === "published") {
    if (post.authorId) await notify({ userIds: [post.authorId], workspaceId: post.workspaceId, type: "post_published", payload: { title: `Published: “${title}”`, href } });
    return;
  }
  const failed = targets.filter((t) => t.status === "failed");
  const recipients = [...(await workspaceManagers(post.workspaceId)), ...(post.authorId ? [post.authorId] : [])];
  await notify({
    userIds: recipients,
    workspaceId: post.workspaceId,
    type: "post_failed",
    payload: {
      title: status === "failed" ? `“${title}” failed to publish` : `“${title}” failed on ${failed.length} channel${failed.length === 1 ? "" : "s"}`,
      body: failed.map((t) => t.error).filter(Boolean).join("\n"),
      href,
    },
  });
}

/* ----------------------------- Scheduling ----------------------------- */

/** Claims posts whose time has come. The update is atomic, so two workers never claim the same post. */
export async function claimDuePosts(limit = 100): Promise<string[]> {
  const rows = await db.execute<{ id: string }>(sql`
    update posts set status = 'publishing', updated_at = now()
    where id in (
      select p.id from posts p
      join workspaces w on w.id = p.workspace_id
      join organizations o on o.id = w.org_id
      where p.status = 'scheduled' and p.scheduled_at <= now() and o.deletion_requested_at is null and w.archived_at is null
      order by p.scheduled_at limit ${limit} for update of p skip locked
    )
    returning id`);
  const ids = [...rows].map((r) => r.id);
  for (const id of ids) await settlePost(id); // posts without any channel fail straight away
  return ids;
}

/** Targets that should have a job: pending targets of publishing posts, plus ones stuck mid-publish for 45 minutes. */
export async function targetsToQueue(): Promise<{ id: string; stuck: boolean }[]> {
  const pending = await db
    .select({ id: postTargets.id })
    .from(postTargets)
    .innerJoin(posts, eq(posts.id, postTargets.postId))
    .where(and(eq(posts.status, "publishing"), eq(postTargets.status, "pending")))
    .limit(500);
  const stuck = await db
    .select({ id: postTargets.id })
    .from(postTargets)
    .innerJoin(posts, eq(posts.id, postTargets.postId))
    .where(and(eq(posts.status, "publishing"), eq(postTargets.status, "publishing"), lt(postTargets.updatedAt, new Date(Date.now() - 45 * 60_000))))
    .limit(100);
  return [...pending.map((r) => ({ id: r.id, stuck: false })), ...stuck.map((r) => ({ id: r.id, stuck: true }))];
}

export async function resetStuckTarget(id: string) {
  await db.update(postTargets).set({ status: "pending" }).where(and(eq(postTargets.id, id), eq(postTargets.status, "publishing")));
}

export async function purgeOldRecords() {
  await db.execute(sql`delete from publish_log where created_at < now() - interval '90 days'`);
  await db.execute(sql`delete from pending_connections where expires_at < now()`);
  await db.execute(sql`delete from notifications where read_at is not null and created_at < now() - interval '180 days'`);
  await db.execute(sql`delete from webhook_deliveries where created_at < now() - interval '30 days'`);
}
