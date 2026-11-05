import { z } from "zod";

/**
 * YouTube settings for one post, matching the fields on YouTube Studio's "Video details" page
 * that the YouTube Data API lets an app set. The description is the YouTube caption (its tab in the composer).
 */

/** YouTube's assignable video categories (videoCategories.list, the same ids in every region). */
export const YT_CATEGORIES: Record<string, string> = {
  "1": "Film & Animation",
  "2": "Autos & Vehicles",
  "10": "Music",
  "15": "Pets & Animals",
  "17": "Sports",
  "19": "Travel & Events",
  "20": "Gaming",
  "22": "People & Blogs",
  "23": "Comedy",
  "24": "Entertainment",
  "25": "News & Politics",
  "26": "Howto & Style",
  "27": "Education",
  "28": "Science & Technology",
  "29": "Nonprofits & Activism",
};

export const YT_LANGUAGES: Record<string, string> = {
  en: "English",
  hi: "Hindi",
  ml: "Malayalam",
  ta: "Tamil",
  te: "Telugu",
  kn: "Kannada",
  mr: "Marathi",
  bn: "Bengali",
  gu: "Gujarati",
  pa: "Punjabi",
  ur: "Urdu",
  ar: "Arabic",
  es: "Spanish",
  fr: "French",
  de: "German",
  pt: "Portuguese",
  ja: "Japanese",
  zh: "Chinese",
};

const noAngles = (s: string) => !/[<>]/.test(s);

export const youtubeOptions = z
  .object({
    title: z.string().trim().max(100, "The YouTube title can be up to 100 characters.").refine(noAngles, "YouTube titles can't contain < or >.").default(""),
    visibility: z.enum(["public", "unlisted", "private"]).default("public"),
    madeForKids: z.boolean().default(false),
    tags: z.array(z.string().trim().min(1).max(100)).max(100).default([]),
    categoryId: z.enum(Object.keys(YT_CATEGORIES) as [string, ...string[]]).default("22"),
    playlistId: z.string().trim().max(64).regex(/^[\w-]*$/).default(""),
    thumbnailAssetId: z.string().uuid().nullable().default(null),
    notifySubscribers: z.boolean().default(true),
    embeddable: z.boolean().default(true),
    showLikes: z.boolean().default(true),
    license: z.enum(["youtube", "creativeCommon"]).default("youtube"),
    paidPromotion: z.boolean().default(false),
    alteredContent: z.boolean().default(false),
    language: z.string().max(10).default(""),
    recordingDate: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/).default(""),
  })
  .refine((o) => o.tags.join(",").length <= 500, { message: "YouTube tags can be up to 500 characters in total.", path: ["tags"] });

export type YoutubeOptions = z.infer<typeof youtubeOptions>;
export const defaultYoutubeOptions = (): YoutubeOptions => youtubeOptions.parse({});

/** YouTube treats a vertical or square video of 3 minutes or less as a Short. */
export const isShort = (v: { width: number | null; height: number | null; durationMs: number | null }) =>
  !!v.width && !!v.height && v.height >= v.width && v.durationMs != null && v.durationMs <= 180_000;

/** The title used when none is set: the caption's first line, cut to 100 characters. */
export function youtubeTitle(caption: string): string {
  const first = (caption.split("\n").find((l) => l.trim()) ?? "").trim();
  const clean = first.replace(/[<>]/g, "");
  if (!clean) return "New video";
  return clean.length > 100 ? `${clean.slice(0, 99).trimEnd()}…` : clean;
}
