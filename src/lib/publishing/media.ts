/** Picks which stored file to send to a platform. Instagram rejects images outside 4:5 to 1.91:1, so those use a cropped variant. */
export function pickImageKey(
  platform: string,
  asset: { storageKey: string; width: number | null; height: number | null },
  variants: { preset: string; storageKey: string }[],
): string {
  if (platform !== "instagram" || !asset.width || !asset.height) return asset.storageKey;
  const ratio = asset.width / asset.height;
  const pick = (preset: string) => variants.find((v) => v.preset === preset)?.storageKey ?? asset.storageKey;
  if (ratio < 0.8) return pick("portrait");
  if (ratio > 1.91) return pick("landscape");
  return asset.storageKey;
}
