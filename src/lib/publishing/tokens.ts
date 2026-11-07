import { eq } from "drizzle-orm";
import { db } from "@/db";
import { channels } from "@/db/schema";
import { decryptSecret, encryptSecret } from "../crypto";
import { PLATFORMS } from "../platforms";
import { notify, workspaceManagers } from "../notify";
import { emitEvent } from "../webhooks";
import { providerForChannel } from "./index";
import { PublishError } from "./types";

type Channel = typeof channels.$inferSelect;

const HOUR = 3_600_000;
/** Refresh this long before expiry. TikTok access tokens only live 24 hours. */
const refreshLead = (c: Channel) => (c.platform === "tiktok" ? 6 * HOUR : 7 * 24 * HOUR);
const WARN_LEAD = 7 * 24 * HOUR;

/** Marks a channel as needing attention and tells the workspace's managers, once per change of state. */
export async function flagChannel(c: Channel, status: "expiring" | "reconnect", message: string) {
  if (c.status === status) {
    await db.update(channels).set({ lastError: message }).where(eq(channels.id, c.id));
    return;
  }
  await db.update(channels).set({ status, lastError: message }).where(eq(channels.id, c.id));
  const name = PLATFORMS[c.platform].name;
  await emitEvent(c.workspaceId, "channel.needs_attention", { channelId: c.id, platform: c.platform, handle: c.handle, status, message });
  await notify({
    userIds: await workspaceManagers(c.workspaceId),
    workspaceId: c.workspaceId,
    type: "channel_attention",
    payload: {
      title: status === "reconnect" ? `${name} (${c.handle}) needs reconnecting` : `${name} (${c.handle}) expires soon`,
      body: message,
      href: `/w/${c.workspaceId}/channels`,
    },
  });
}

async function refreshChannel(c: Channel): Promise<Channel> {
  const provider = providerForChannel(c);
  if (!provider?.refresh || !c.refreshTokenEnc) return c;
  const t = await provider.refresh(decryptSecret(c.refreshTokenEnc));
  const [updated] = await db
    .update(channels)
    .set({
      accessTokenEnc: encryptSecret(t.accessToken),
      refreshTokenEnc: t.refreshToken ? encryptSecret(t.refreshToken) : c.refreshTokenEnc,
      tokenExpiresAt: t.expiresAt,
      status: "connected",
      lastError: null,
    })
    .where(eq(channels.id, c.id))
    .returning();
  return updated!;
}

/** Returns a usable access token for publishing, refreshing it first when it's about to expire. */
export async function accessTokenFor(c: Channel): Promise<string> {
  if (!c.accessTokenEnc) throw new PublishError("This channel has no access token. Reconnect it.", "auth");
  if (c.tokenExpiresAt && c.tokenExpiresAt.getTime() < Date.now() + 5 * 60_000) {
    if (!c.refreshTokenEnc) throw new PublishError("The access token expired. Reconnect the channel.", "auth");
    c = await refreshChannel(c);
  }
  return decryptSecret(c.accessTokenEnc!);
}

/** Hourly: refresh tokens that are close to expiring and flag channels that will need a person to reconnect them. */
export async function refreshExpiringTokens(now = Date.now()) {
  const rows = await db.select().from(channels);
  let refreshed = 0;
  for (const c of rows) {
    if (c.status === "disconnected" || c.status === "reconnect" || !c.tokenExpiresAt) continue;
    const left = c.tokenExpiresAt.getTime() - now;
    try {
      if (c.refreshTokenEnc && providerForChannel(c)?.refresh && left < refreshLead(c)) {
        await refreshChannel(c);
        refreshed++;
      } else if (left <= 0) {
        await flagChannel(c, "reconnect", "The access token expired. Reconnect the channel to keep publishing.");
      } else if (left < WARN_LEAD && !c.refreshTokenEnc) {
        const days = Math.max(1, Math.round(left / (24 * HOUR)));
        await flagChannel(c, "expiring", `The connection expires in ${days} day${days === 1 ? "" : "s"}. Reconnect to renew it.`);
      }
    } catch (e) {
      if (e instanceof PublishError && e.kind === "auth") await flagChannel(c, "reconnect", e.message);
      else console.error(`Token refresh failed for channel ${c.id}`, e);
    }
  }
  return refreshed;
}
