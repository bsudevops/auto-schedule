import { vi } from "vitest";

type Route = { method?: string; match: string | RegExp; status?: number; body?: unknown; headers?: Record<string, string> };
export type Call = { method: string; url: string; body: string };

/** Replaces global fetch with a scripted list of responses, matched in order. Records every call. */
export function mockFetch(routes: Route[]) {
  const calls: Call[] = [];
  const queue = [...routes];
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const body = init?.body instanceof URLSearchParams ? init.body.toString() : typeof init?.body === "string" ? init.body : "";
    calls.push({ method, url, body });
    const i = queue.findIndex((r) => (r.method ?? "GET") === method && (typeof r.match === "string" ? url.includes(r.match) : r.match.test(url)));
    if (i < 0) throw new Error(`Unexpected fetch: ${method} ${url}`);
    const r = queue.splice(i, 1)[0]!;
    const text = r.body === undefined ? "" : typeof r.body === "string" ? r.body : JSON.stringify(r.body);
    return new Response(text, { status: r.status ?? 200, headers: r.headers });
  });
  vi.stubGlobal("fetch", fn);
  return { calls, remaining: () => queue.length };
}
