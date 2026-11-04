import { PublishError } from "./types";

export type HttpResponse = { status: number; headers: Headers; body: unknown; text: string };

/** Fetch with a timeout. Network failures and timeouts become temporary PublishErrors. Never throws for HTTP status codes. */
export async function http(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<HttpResponse> {
  const { timeoutMs = 30_000, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(url, { ...rest, redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    throw new PublishError(`Couldn't reach ${new URL(url).host}: ${(e as Error).message}`, "temporary");
  }
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  return { status: res.status, headers: res.headers, body, text };
}

export const form = (data: Record<string, string>) => new URLSearchParams(data);

/** Generic classification by HTTP status, used when a platform gives no better signal. */
export function kindForStatus(status: number) {
  if (status === 401) return "auth" as const;
  if (status === 429) return "rate" as const;
  if (status >= 500) return "temporary" as const;
  return "permanent" as const;
}

let sleepImpl = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export const sleep = (ms: number) => sleepImpl(ms);
/** Tests replace sleep so polling loops run instantly. */
export function setSleepForTests(fn: (ms: number) => Promise<void>) {
  sleepImpl = fn;
}

/** Polls `check` until it returns a value, or gives up after `attempts` tries. */
export async function poll<T>(check: () => Promise<T | undefined>, { attempts, intervalMs, what }: { attempts: number; intervalMs: number; what: string }): Promise<T> {
  for (let i = 0; i < attempts; i++) {
    const v = await check();
    if (v !== undefined) return v;
    await sleep(intervalMs);
  }
  throw new PublishError(`${what} is still processing. We'll try again shortly.`, "temporary");
}

export const env = (name: string) => process.env[name]?.trim() || "";
