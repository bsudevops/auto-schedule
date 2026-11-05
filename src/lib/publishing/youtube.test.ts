import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultYoutubeOptions, isShort, youtubeOptions } from "../youtube-options";
import { youtubePublisher } from "./google";
import { mockFetch } from "./test-fetch";

vi.mock("@/db", () => ({ db: {} }));
afterEach(() => vi.unstubAllGlobals());

const vid = { kind: "video" as const, url: "https://media.example.com/v.mp4", mimeType: "video/mp4", sizeBytes: 5, altText: "" };
const thumb = { kind: "image" as const, url: "https://media.example.com/t.jpg", mimeType: "image/jpeg", sizeBytes: 900, altText: "" };
const channel = { externalId: "UC1", handle: "wexley", meta: {} };

function uploadRoutes() {
  return [
    { method: "POST", match: "/upload/youtube/v3/videos?", headers: { location: "https://upload.example.com/session1" } },
    { match: "media.example.com/v.mp4", body: "vbytes" },
    { method: "PUT", match: "upload.example.com/session1", body: { id: "vid1", status: { uploadStatus: "uploaded" } } },
  ];
}

describe("YouTube options", () => {
  it("fills defaults and checks limits", () => {
    expect(defaultYoutubeOptions()).toMatchObject({ visibility: "public", madeForKids: false, categoryId: "22", notifySubscribers: true });
    expect(youtubeOptions.safeParse({ title: "x".repeat(101) }).success).toBe(false);
    expect(youtubeOptions.safeParse({ title: "a <b>" }).success).toBe(false);
    expect(youtubeOptions.safeParse({ tags: Array.from({ length: 60 }, (_, i) => `tag-number-${i}`) }).success).toBe(false);
    expect(youtubeOptions.safeParse({ categoryId: "999" }).success).toBe(false);
  });

  it("spots Shorts", () => {
    expect(isShort({ width: 1080, height: 1920, durationMs: 59_000 })).toBe(true);
    expect(isShort({ width: 1920, height: 1080, durationMs: 59_000 })).toBe(false);
    expect(isShort({ width: 1080, height: 1920, durationMs: 200_000 })).toBe(false);
  });
});

describe("YouTube publisher", () => {
  it("sends the video details, then sets the thumbnail and playlist", async () => {
    const f = mockFetch([
      ...uploadRoutes(),
      { match: "media.example.com/t.jpg", body: "img" },
      { method: "POST", match: "/thumbnails/set?", body: {} },
      { method: "POST", match: "/playlistItems?", body: { id: "pi1" } },
    ]);
    const options = {
      title: "Launch day", visibility: "unlisted", madeForKids: true, tags: ["coffee", "launch"], categoryId: "26", playlistId: "PL1",
      notifySubscribers: false, embeddable: false, showLikes: false, license: "creativeCommon", paidPromotion: true, alteredContent: true, language: "ml", recordingDate: "2026-11-01",
    };
    const r = await youtubePublisher.publish({ channel, accessToken: "tok", caption: "Our new <menu>\nDetails", firstComment: "", media: [vid], options, thumbnail: thumb });
    expect(r).toEqual({ externalId: "vid1", url: "https://www.youtube.com/watch?v=vid1", warnings: [] });

    const init = f.calls[0]!;
    expect(init.url).toContain("notifySubscribers=false");
    expect(decodeURIComponent(init.url)).toContain("part=snippet,status,paidProductPlacementDetails,recordingDetails");
    const body = JSON.parse(init.body);
    expect(body.snippet).toEqual({ title: "Launch day", description: "Our new menu\nDetails", categoryId: "26", tags: ["coffee", "launch"], defaultLanguage: "ml", defaultAudioLanguage: "ml" });
    expect(body.status).toEqual({ privacyStatus: "unlisted", selfDeclaredMadeForKids: true, license: "creativeCommon", embeddable: false, publicStatsViewable: false, containsSyntheticMedia: true });
    expect(body.paidProductPlacementDetails).toEqual({ hasPaidProductPlacement: true });
    expect(body.recordingDetails).toEqual({ recordingDate: "2026-11-01T00:00:00Z" });
    expect(f.calls.find((c) => c.url.includes("thumbnails/set"))!.url).toContain("videoId=vid1");
    expect(JSON.parse(f.calls.find((c) => c.url.includes("playlistItems"))!.body)).toEqual({ snippet: { playlistId: "PL1", resourceId: { kind: "youtube#video", videoId: "vid1" } } });
  });

  it("uses the caption's first line and defaults when nothing is set", async () => {
    const f = mockFetch(uploadRoutes());
    await youtubePublisher.publish({ channel, accessToken: "tok", caption: "Fresh roast\nmore", firstComment: "", media: [vid] });
    const body = JSON.parse(f.calls[0]!.body);
    expect(body.snippet).toEqual({ title: "Fresh roast", description: "Fresh roast\nmore", categoryId: "22" });
    expect(body.status.privacyStatus).toBe("public");
    expect(body.status.selfDeclaredMadeForKids).toBe(false);
    expect(f.calls).toHaveLength(3);
  });

  it("still publishes when the thumbnail or playlist fails, with warnings", async () => {
    mockFetch([
      ...uploadRoutes(),
      { match: "media.example.com/t.jpg", body: "img" },
      { method: "POST", match: "/thumbnails/set?", status: 403, body: { error: { code: 403, message: "The authenticated user doesn't have permissions to upload and set custom video thumbnails.", errors: [{ reason: "forbidden" }] } } },
      { method: "POST", match: "/playlistItems?", status: 404, body: { error: { code: 404, message: "Playlist not found." } } },
    ]);
    const r = await youtubePublisher.publish({ channel, accessToken: "tok", caption: "x", firstComment: "", media: [vid], options: { playlistId: "PLgone" }, thumbnail: thumb });
    expect(r.externalId).toBe("vid1");
    expect(r.warnings).toHaveLength(2);
    expect(r.warnings[0]).toContain("verified YouTube channel");
    expect(r.warnings[1]).toContain("Playlist not found");
  });

  it("skips a thumbnail that's too big", async () => {
    const f = mockFetch(uploadRoutes());
    const r = await youtubePublisher.publish({ channel, accessToken: "tok", caption: "x", firstComment: "", media: [vid], thumbnail: { ...thumb, sizeBytes: 3 * 1024 * 1024 } });
    expect(r.warnings).toEqual(["The thumbnail wasn't set: YouTube thumbnails must be 2 MB or smaller."]);
    expect(f.calls).toHaveLength(3);
  });

  it("keeps the server-wide private override and says so", async () => {
    vi.stubEnv("YOUTUBE_PRIVACY_STATUS", "private");
    const f = mockFetch(uploadRoutes());
    const r = await youtubePublisher.publish({ channel, accessToken: "tok", caption: "x", firstComment: "", media: [vid], options: { visibility: "public" } });
    expect(JSON.parse(f.calls[0]!.body).status.privacyStatus).toBe("private");
    expect(r.warnings[0]).toContain("Uploaded as private");
    vi.unstubAllEnvs();
  });
});
