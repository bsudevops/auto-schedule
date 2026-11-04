import { redis } from "../redis";

/**
 * Fixed-window counter per channel. Returns 0 when the publish may go ahead,
 * or the number of seconds to wait before trying again.
 */
export async function takeSlot(channelId: string, limit: { max: number; windowSec: number }): Promise<number> {
  const window = Math.floor(Date.now() / 1000 / limit.windowSec);
  const key = `rl:publish:${channelId}:${window}`;
  const r = redis();
  const n = await r.incr(key);
  if (n === 1) await r.expire(key, limit.windowSec + 60);
  if (n <= limit.max) return 0;
  await r.decr(key);
  return limit.windowSec - (Math.floor(Date.now() / 1000) % limit.windowSec) + 5;
}

/** How many publishes this channel has used in the current window (for the Channels page). */
export async function slotsUsed(channelId: string, limit: { max: number; windowSec: number }): Promise<number> {
  const window = Math.floor(Date.now() / 1000 / limit.windowSec);
  return Number((await redis().get(`rl:publish:${channelId}:${window}`)) ?? 0);
}
