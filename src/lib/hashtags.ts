/** "#Launch, news  #launch" becomes ["#Launch", "#news"]: one # each, no duplicates, up to 30. */
export function cleanTags(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of raw.split(/[\s,]+/)) {
    const word = t.replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, "");
    if (!word || seen.has(word.toLowerCase())) continue;
    seen.add(word.toLowerCase());
    out.push(`#${word}`);
  }
  return out.slice(0, 30);
}

/** Hashtags already in a caption, for saving them as a set. */
export const tagsIn = (caption: string) => cleanTags([...caption.matchAll(/(^|\s)#([\p{L}\p{N}_]+)/gu)].map((m) => m[2]).join(" "));

/** Appends tags to a caption, skipping ones it already has. */
export function addTags(caption: string, tags: string[]): string {
  const have = new Set(tagsIn(caption).map((t) => t.toLowerCase()));
  const add = tags.filter((t) => !have.has(t.toLowerCase()));
  if (!add.length) return caption;
  const sep = !caption.trim() ? "" : /\n\s*$/.test(caption) ? "" : "\n\n";
  return `${caption.replace(/[ \t]+$/, "")}${sep}${add.join(" ")}`;
}
