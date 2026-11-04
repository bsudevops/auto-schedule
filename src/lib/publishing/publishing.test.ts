import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setSleepForTests } from "./http";
import { facebookPublisher, instagramPublisher, metaProvider } from "./meta";
import { linkedinPublisher, toLittleText } from "./linkedin";
import { pickPrivacy, tiktokPublisher } from "./tiktok";
import { pickImageKey } from "./media";
import { postStatusFrom } from "./run";
import { mockFetch } from "./test-fetch";
import { PublishError } from "./types";

vi.mock("@/db", () => ({ db: {} }));

const img = (url = "https://media.example.com/a.jpg") => ({ kind: "image" as const, url, mimeType: "image/jpeg", sizeBytes: 1000, altText: "A latte" });
const vid = (url = "https://media.example.com/v.mp4") => ({ kind: "video" as const, url, mimeType: "video/mp4", sizeBytes: 5000, altText: "" });
const ch = (externalId: string, meta: Record<string, unknown> = {}) => ({ externalId, handle: "harborcoffee", meta });

beforeEach(() => {
  setSleepForTests(async () => {});
  process.env.META_APP_ID = "app";
  process.env.META_APP_SECRET = "secret";
});
afterEach(() => vi.unstubAllGlobals());

describe("Meta OAuth", () => {
  it("returns each Page plus its linked Instagram account, sharing the Page token", async () => {
    mockFetch([
      { match: "oauth/access_token?", body: { access_token: "short" } },
      { match: "fb_exchange_token", body: { access_token: "long" } },
      {
        match: "me/accounts",
        body: {
          data: [
            { id: "p1", name: "Harbor Coffee", access_token: "page-token", followers_count: 900, instagram_business_account: { id: "ig1", username: "harborcoffee", followers_count: 1800 } },
            { id: "p2", name: "Side Page", access_token: "page-2" },
          ],
        },
      },
    ]);
    const accts = await metaProvider.exchangeCode("code", "https://app/cb");
    expect(accts.map((a) => `${a.platform}:${a.externalId}`)).toEqual(["facebook:p1", "instagram:ig1", "facebook:p2"]);
    expect(accts[1]).toMatchObject({ accessToken: "page-token", handle: "harborcoffee", followers: 1800, meta: { pageId: "p1" } });
  });

  it("asks for the publishing scopes and passes the state through", () => {
    const u = new URL(metaProvider.authorizeUrl("st4te", "https://app/cb"));
    expect(u.searchParams.get("state")).toBe("st4te");
    expect(u.searchParams.get("scope")).toContain("instagram_content_publish");
  });
});

describe("Instagram publishing", () => {
  it("creates a container, waits for it, publishes, then adds the first comment", async () => {
    const f = mockFetch([
      { method: "POST", match: /\/ig1\/media$/, body: { id: "c1" } },
      { match: "/c1?", body: { status_code: "IN_PROGRESS" } },
      { match: "/c1?", body: { status_code: "FINISHED" } },
      { method: "POST", match: /media_publish$/, body: { id: "m1" } },
      { match: "/m1?", body: { permalink: "https://instagram.com/p/xyz" } },
      { method: "POST", match: /\/m1\/comments$/, body: { id: "cm" } },
    ]);
    const r = await instagramPublisher.publish({ channel: ch("ig1"), accessToken: "t", caption: "Hello", firstComment: "Link in bio", media: [img()] });
    expect(r).toEqual({ externalId: "m1", url: "https://instagram.com/p/xyz", warnings: [] });
    const create = f.calls.find((c) => c.url.endsWith("/ig1/media"))!;
    expect(new URLSearchParams(create.body).get("image_url")).toBe("https://media.example.com/a.jpg");
    expect(new URLSearchParams(create.body).get("appsecret_proof")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("builds a carousel from several items", async () => {
    const f = mockFetch([
      { method: "POST", match: /\/ig1\/media$/, body: { id: "k1" } },
      { method: "POST", match: /\/ig1\/media$/, body: { id: "k2" } },
      { match: "/k1?", body: { status_code: "FINISHED" } },
      { match: "/k2?", body: { status_code: "FINISHED" } },
      { method: "POST", match: /\/ig1\/media$/, body: { id: "car" } },
      { match: "/car?", body: { status_code: "FINISHED" } },
      { method: "POST", match: /media_publish$/, body: { id: "m2" } },
      { match: "/m2?", body: {} },
    ]);
    await instagramPublisher.publish({ channel: ch("ig1"), accessToken: "t", caption: "Two", firstComment: "", media: [img(), vid()] });
    const bodies = f.calls.filter((c) => c.url.endsWith("/ig1/media")).map((c) => new URLSearchParams(c.body));
    expect(bodies[1]!.get("media_type")).toBe("VIDEO");
    expect(bodies[1]!.get("is_carousel_item")).toBe("true");
    expect(bodies[2]!.get("media_type")).toBe("CAROUSEL");
    expect(bodies[2]!.get("children")).toBe("k1,k2");
  });

  it("fails permanently when Instagram can't process the media", async () => {
    mockFetch([
      { method: "POST", match: /\/ig1\/media$/, body: { id: "c1" } },
      { match: "/c1?", body: { status_code: "ERROR", status: "Unsupported format" } },
    ]);
    const e = await instagramPublisher.publish({ channel: ch("ig1"), accessToken: "t", caption: "", firstComment: "", media: [img()] }).catch((x) => x);
    expect(e).toBeInstanceOf(PublishError);
    expect(e.kind).toBe("permanent");
  });

  it("treats an expired token as needing a reconnect", async () => {
    mockFetch([{ method: "POST", match: /\/ig1\/media$/, status: 400, body: { error: { code: 190, message: "Session expired" } } }]);
    const e = await instagramPublisher.publish({ channel: ch("ig1"), accessToken: "t", caption: "", firstComment: "", media: [img()] }).catch((x) => x);
    expect(e.kind).toBe("auth");
  });

  it("treats Meta's rate limit codes as retryable", async () => {
    mockFetch([{ method: "POST", match: /\/ig1\/media$/, status: 400, body: { error: { code: 4, message: "Too many calls" } } }]);
    const e = await instagramPublisher.publish({ channel: ch("ig1"), accessToken: "t", caption: "", firstComment: "", media: [img()] }).catch((x) => x);
    expect(e.kind).toBe("rate");
    expect(e.retryable).toBe(true);
  });
});

describe("Facebook publishing", () => {
  it("posts text to the Page feed", async () => {
    mockFetch([{ method: "POST", match: /\/p1\/feed$/, body: { id: "p1_99" } }]);
    const r = await facebookPublisher.publish({ channel: ch("p1"), accessToken: "t", caption: "Hi", firstComment: "", media: [] });
    expect(r.url).toBe("https://www.facebook.com/p1_99");
  });

  it("uploads several photos unpublished, then attaches them to one feed post", async () => {
    const f = mockFetch([
      { method: "POST", match: /\/p1\/photos$/, body: { id: "ph1" } },
      { method: "POST", match: /\/p1\/photos$/, body: { id: "ph2" } },
      { method: "POST", match: /\/p1\/feed$/, body: { id: "p1_5" } },
    ]);
    await facebookPublisher.publish({ channel: ch("p1"), accessToken: "t", caption: "Two pics", firstComment: "", media: [img(), img("https://media.example.com/b.jpg")] });
    expect(new URLSearchParams(f.calls[0]!.body).get("published")).toBe("false");
    const feed = new URLSearchParams(f.calls[2]!.body);
    expect(feed.get("attached_media[1]")).toBe(JSON.stringify({ media_fbid: "ph2" }));
  });

  it("keeps the post when only the first comment fails", async () => {
    mockFetch([
      { method: "POST", match: /\/p1\/feed$/, body: { id: "p1_7" } },
      { method: "POST", match: /\/p1_7\/comments$/, status: 400, body: { error: { code: 100, message: "Bad" } } },
    ]);
    const r = await facebookPublisher.publish({ channel: ch("p1"), accessToken: "t", caption: "Hi", firstComment: "First!", media: [] });
    expect(r.externalId).toBe("p1_7");
    expect(r.warnings[0]).toContain("first comment failed");
  });
});

describe("LinkedIn", () => {
  it("escapes reserved characters and keeps hashtags clickable", () => {
    expect(toLittleText("Hi (all) #Coffee_Time and a_b")).toBe("Hi \\(all\\) {hashtag|\\#|Coffee_Time} and a\\_b");
    expect(toLittleText("issue#5")).toBe("issue\\#5");
  });

  it("uploads an image, creates the post and reads its URN from the header", async () => {
    const f = mockFetch([
      { method: "POST", match: "images?action=initializeUpload", body: { value: { uploadUrl: "https://upload.example/x", image: "urn:li:image:1" } } },
      { match: "media.example.com/a.jpg", body: "bytes" },
      { method: "PUT", match: "upload.example/x", status: 201 },
      { method: "POST", match: "/rest/posts", status: 201, headers: { "x-restli-id": "urn:li:share:42" } },
    ]);
    const r = await linkedinPublisher.publish({ channel: ch("person:abc", { author: "urn:li:person:abc" }), accessToken: "t", caption: "Hello #team", firstComment: "", media: [img()] });
    expect(r.externalId).toBe("urn:li:share:42");
    expect(r.url).toBe("https://www.linkedin.com/feed/update/urn:li:share:42/");
    const post = JSON.parse(f.calls.at(-1)!.body);
    expect(post).toMatchObject({ author: "urn:li:person:abc", commentary: "Hello {hashtag|\\#|team}", content: { media: { id: "urn:li:image:1", altText: "A latte" } } });
  });

  it("asks for a reconnect when the channel has no author", async () => {
    const e = await linkedinPublisher.publish({ channel: ch("x"), accessToken: "t", caption: "", firstComment: "", media: [] }).catch((x) => x);
    expect(e.kind).toBe("auth");
  });
});

describe("TikTok", () => {
  it("picks the preferred privacy level, falling back to the most public allowed", () => {
    expect(pickPrivacy(["SELF_ONLY", "PUBLIC_TO_EVERYONE"], "PUBLIC_TO_EVERYONE")).toBe("PUBLIC_TO_EVERYONE");
    expect(pickPrivacy(["SELF_ONLY"], "PUBLIC_TO_EVERYONE")).toBe("SELF_ONLY");
  });

  it("queries the creator, sends the video by URL and polls until it's live", async () => {
    const ok = { error: { code: "ok" } };
    const f = mockFetch([
      { method: "POST", match: "creator_info/query", body: { ...ok, data: { privacy_level_options: ["SELF_ONLY"] } } },
      { method: "POST", match: "video/init", body: { ...ok, data: { publish_id: "pub1" } } },
      { method: "POST", match: "status/fetch", body: { ...ok, data: { status: "PROCESSING_DOWNLOAD" } } },
      { method: "POST", match: "status/fetch", body: { ...ok, data: { status: "PUBLISH_COMPLETE", publicaly_available_post_id: [7123] } } },
    ]);
    const r = await tiktokPublisher.publish({ channel: ch("open1"), accessToken: "t", caption: "Rainy day", firstComment: "", media: [vid()] });
    expect(r).toMatchObject({ externalId: "7123", url: "https://www.tiktok.com/@harborcoffee/video/7123" });
    expect(r.warnings[0]).toContain("private");
    expect(JSON.parse(f.calls[1]!.body).source_info).toEqual({ source: "PULL_FROM_URL", video_url: "https://media.example.com/v.mp4" });
  });

  it("needs exactly one video", async () => {
    const e = await tiktokPublisher.publish({ channel: ch("o"), accessToken: "t", caption: "", firstComment: "", media: [img()] }).catch((x) => x);
    expect(e.kind).toBe("permanent");
  });

  it("maps an invalid token to a reconnect", async () => {
    mockFetch([{ method: "POST", match: "creator_info/query", status: 401, body: { error: { code: "access_token_invalid", message: "bad" } } }]);
    const e = await tiktokPublisher.publish({ channel: ch("o"), accessToken: "t", caption: "", firstComment: "", media: [vid()] }).catch((x) => x);
    expect(e.kind).toBe("auth");
  });
});

describe("network failures", () => {
  it("become temporary errors so the job retries", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    const e = await facebookPublisher.publish({ channel: ch("p1"), accessToken: "t", caption: "Hi", firstComment: "", media: [] }).catch((x) => x);
    expect(e.kind).toBe("temporary");
  });
});

describe("helpers", () => {
  it("works out a post's overall status from its channels", () => {
    expect(postStatusFrom(["published", "published"])).toBe("published");
    expect(postStatusFrom(["published", "failed"])).toBe("partially_failed");
    expect(postStatusFrom(["failed"])).toBe("failed");
    expect(postStatusFrom(["published", "pending"])).toBe("publishing");
    expect(postStatusFrom([])).toBe("failed");
  });

  it("uses a cropped variant when an image is too tall or wide for Instagram", () => {
    const v = [{ preset: "portrait", storageKey: "p.jpg" }, { preset: "landscape", storageKey: "l.jpg" }];
    expect(pickImageKey("instagram", { storageKey: "o.jpg", width: 1000, height: 2000 }, v)).toBe("p.jpg");
    expect(pickImageKey("instagram", { storageKey: "o.jpg", width: 3000, height: 1000 }, v)).toBe("l.jpg");
    expect(pickImageKey("instagram", { storageKey: "o.jpg", width: 1080, height: 1080 }, v)).toBe("o.jpg");
    expect(pickImageKey("facebook", { storageKey: "o.jpg", width: 1000, height: 3000 }, v)).toBe("o.jpg");
  });
});
