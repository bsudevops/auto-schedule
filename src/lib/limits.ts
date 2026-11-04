import "server-only";
import { redis } from "./redis";

/**
 * Counts an attempt in a fixed window and says whether it's over the limit.
 * If Redis is down we let the attempt through rather than block people.
 */
export async function overLimit(key: string, max: number, windowSec: number): Promise<boolean> {
  try {
    const n = await redis().incr(`limit:${key}`);
    if (n === 1) await redis().expire(`limit:${key}`, windowSec);
    return n > max;
  } catch {
    return false;
  }
}
