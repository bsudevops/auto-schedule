import "server-only";
import { http } from "./publishing/http";

/**
 * Stock photo search through Pexels (free; needs PEXELS_API_KEY). The browser only ever sends a
 * photo ID back to import it: the server looks the photo up again and downloads it from Pexels' own
 * image host, so no address chosen by the browser is ever fetched.
 */
const API = "https://api.pexels.com/v1";
const IMAGE_HOST = "images.pexels.com";

export const stockConfigured = () => Boolean(process.env.PEXELS_API_KEY?.trim());

export class StockError extends Error {}

type PexelsPhoto = {
  id: number;
  width: number;
  height: number;
  url: string;
  photographer: string;
  photographer_url: string;
  alt?: string | null;
  src: { large2x: string; large: string; medium: string; tiny: string };
};

export type StockPhoto = { id: string; thumb: string; width: number; height: number; alt: string; photographer: string; photographerUrl: string; pageUrl: string };

const toPhoto = (p: PexelsPhoto): StockPhoto => ({
  id: String(p.id),
  thumb: p.src.medium,
  width: p.width,
  height: p.height,
  alt: p.alt ?? "",
  photographer: p.photographer,
  photographerUrl: p.photographer_url,
  pageUrl: p.url,
});

async function pexels<T>(path: string): Promise<T> {
  if (!stockConfigured()) throw new StockError("Stock photos aren't set up on this server.");
  const res = await http(`${API}${path}`, { headers: { Authorization: process.env.PEXELS_API_KEY!.trim() }, timeoutMs: 15_000 });
  if (res.status === 401 || res.status === 403) throw new StockError("The Pexels API key on the server was rejected.");
  if (res.status === 429) throw new StockError("Stock photo search is busy. Try again in a minute.");
  if (res.status === 404) throw new StockError("That photo is no longer on Pexels.");
  if (res.status >= 400) throw new StockError("Stock photo search didn't respond. Try again.");
  return res.body as T;
}

export async function searchStock(query: string, page = 1): Promise<{ photos: StockPhoto[]; hasMore: boolean }> {
  const q = query.trim().slice(0, 100);
  if (!q) return { photos: [], hasMore: false };
  const r = await pexels<{ photos: PexelsPhoto[]; next_page?: string }>(`/search?${new URLSearchParams({ query: q, per_page: "24", page: String(Math.min(Math.max(page, 1), 50)) })}`);
  return { photos: r.photos.map(toPhoto), hasMore: Boolean(r.next_page) };
}

/** Downloads one photo at a size that suits social posts (about 1880px on the long side). */
export async function downloadStock(id: string): Promise<{ data: Buffer; filename: string; alt: string; credit: string }> {
  if (!/^\d{1,12}$/.test(id)) throw new StockError("Unknown photo.");
  const p = await pexels<PexelsPhoto>(`/photos/${id}`);
  const url = new URL(p.src.large2x);
  if (url.protocol !== "https:" || url.hostname !== IMAGE_HOST) throw new StockError("Pexels returned an unexpected image address.");
  const res = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(60_000) }).catch(() => null);
  if (!res?.ok) throw new StockError("Couldn't download the photo from Pexels. Try again.");
  const data = Buffer.from(await res.arrayBuffer());
  return { data, filename: `pexels-${p.id}.jpg`, alt: p.alt ?? "", credit: `Photo by ${p.photographer} on Pexels` };
}
