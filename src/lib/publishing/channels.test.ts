import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkPost } from "../post-rules";
import { blueskyProvider, blueskyPublisher, buildFacets, graphemeCount, looksLikeAppPassword, normaliseHandle } from "./bluesky";
import { devtoProvider, devtoPublisher, toArticle } from "./devto";
import { ENGAGE } from "./engage";
import { googleBusinessPublisher, youtubeTitle } from "./google";
import { setSleepForTests } from "./http";
import { normaliseInstance } from "./mastodon";
import { firstLink, pinText, pinterestPublisher } from "./pinterest";
import { mockFetch } from "./test-fetch";
import { threadsPublisher } from "./threads";
import { PublishError } from "./types";

vi.mock("@/db", () => ({ db: {} }));

const img = (url = "https://media.example.com/a.jpg") => ({ kind: "image" as const, url, mimeType: "image/jpeg", sizeBytes: 1000, altText: "A latte" });
const vid = (url = "https://media.example.com/v.mp4") => ({ kind: "video" as const, url, mimeType: "video/mp4", sizeBytes: 5000, altText: "" });
const ch = (externalId: string, meta: Record<string, unknown> = {}) => ({ externalId, handle: "harborcoffee", meta });

beforeEach(() => setSleepForTests(async () => {}));
afterEach(() => vi.unstubAllGlobals());

describe("Threads", () => {
  it("creates a text container, waits for it, publishes and reads the link", async () => {
    const f = mockFetch([
      { method: "POST", match: /\/u1\/threads$/, body: { id: "c1" } },
      { match: "/c1?", body: { status: "IN_PROGRESS" } },
      { match: "/c1?", body: { status: "FINISHED" } },
      { method: "POST", match: "/u1/threads_publish", body: { id: "p1" } },
      { match: "/p1?", body: { permalink: "https://www.threads.net/@harborcoffee/post/abc" } },
    ]);
    const r = await threadsPublisher.publish({ channel: ch("u1"), accessToken: "tok", caption: "Fresh beans today", firstComment: "", media: [] });
    expect(r).toEqual({ externalId: "p1", url: "https://www.threads.net/@harborcoffee/post/abc", warnings: [] });
    expect(f.calls[0]!.body).toContain("media_type=TEXT");
    expect(f.calls[0]!.body).toContain("access_token=tok");
    expect(f.calls.find((c) => c.url.includes("threads_publish"))!.body).toContain("creation_id=c1");
  });

  it("builds a carousel from several items", async () => {
    const f = mockFetch([
      { method: "POST", match: /\/u1\/threads$/, body: { id: "k1" } },
      { method: "POST", match: /\/u1\/threads$/, body: { id: "k2" } },
      { match: "/k1?", body: { status: "FINISHED" } },
      { match: "/k2?", body: { status: "FINISHED" } },
      { method: "POST", match: /\/u1\/threads$/, body: { id: "car" } },
      { match: "/car?", body: { status: "FINISHED" } },
      { method: "POST", match: "/u1/threads_publish", body: { id: "p2" } },
      { match: "/p2?", body: {} },
    ]);
    await threadsPublisher.publish({ channel: ch("u1"), accessToken: "tok", caption: "Two", firstComment: "", media: [img(), vid()] });
    const carousel = f.calls.find((c) => c.body.includes("media_type=CAROUSEL"))!;
    expect(carousel.body).toContain(`children=${encodeURIComponent("k1,k2")}`);
    expect(f.calls[1]!.body).toContain("media_type=VIDEO");
  });

  it("fails permanently when Threads can't process the media", async () => {
    mockFetch([
      { method: "POST", match: /\/u1\/threads$/, body: { id: "c1" } },
      { match: "/c1?", body: { status: "ERROR", error_message: "bad file" } },
    ]);
    await expect(threadsPublisher.publish({ channel: ch("u1"), accessToken: "t", caption: "x", firstComment: "", media: [img()] })).rejects.toMatchObject({ kind: "permanent" });
  });

  it("treats an expired token as an auth problem", async () => {
    mockFetch([{ method: "POST", match: /\/u1\/threads$/, status: 400, body: { error: { message: "Session expired", code: 190 } } }]);
    await expect(threadsPublisher.publish({ channel: ch("u1"), accessToken: "t", caption: "x", firstComment: "", media: [] })).rejects.toMatchObject({ kind: "auth" });
  });
});

describe("Bluesky", () => {
  it("normalises handles", () => {
    expect(normaliseHandle("@Harbor")).toBe("harbor.bsky.social");
    expect(normaliseHandle("harbor.coffee")).toBe("harbor.coffee");
    expect(normaliseHandle("me@example.com")).toBe("me@example.com");
  });

  it("tells app passwords from main passwords", () => {
    expect(looksLikeAppPassword("abcd-efgh-ijkl-mnop")).toBe(true);
    expect(looksLikeAppPassword("hunter2")).toBe(false);
  });

  it("counts emoji as single characters", () => {
    expect(graphemeCount("hi 👋🏽")).toBe(4);
  });

  it("marks links and hashtags with UTF-8 byte positions", () => {
    const text = "Café ☕ https://harbor.coffee/menu. #coffee #1";
    const facets = buildFacets(text);
    expect(facets).toHaveLength(2);
    const bytes = new TextEncoder().encode(text);
    const slice = (f: (typeof facets)[number]) => new TextDecoder().decode(bytes.slice(f.index.byteStart, f.index.byteEnd));
    expect(slice(facets[0]!)).toBe("https://harbor.coffee/menu");
    expect(slice(facets[1]!)).toBe("#coffee");
    expect(facets[1]!.features[0]).toEqual({ $type: "app.bsky.richtext.facet#tag", tag: "coffee" });
  });

  it("refuses a main password before calling Bluesky", async () => {
    const f = mockFetch([]);
    await expect(blueskyProvider.connectWithCredentials!({ handle: "harbor", appPassword: "my real password" })).rejects.toBeInstanceOf(PublishError);
    expect(f.calls).toHaveLength(0);
  });

  it("connects with an app password and keeps it as the secret", async () => {
    mockFetch([
      { method: "POST", match: "createSession", body: { accessJwt: "jwt", did: "did:plc:1", handle: "harbor.bsky.social" } },
      { match: "getProfile", body: { did: "did:plc:1", handle: "harbor.bsky.social", displayName: "Harbor", followersCount: 42 } },
    ]);
    const [a] = await blueskyProvider.connectWithCredentials!({ handle: "@harbor", appPassword: "abcd-efgh-ijkl-mnop" });
    expect(a).toMatchObject({ platform: "bluesky", externalId: "did:plc:1", followers: 42, accessToken: "abcd-efgh-ijkl-mnop", meta: { login: "harbor.bsky.social" } });
  });

  it("posts text with facets and returns the bsky.app link", async () => {
    const f = mockFetch([
      { method: "POST", match: "createSession", body: { accessJwt: "jwt", did: "did:plc:1", handle: "harbor.bsky.social" } },
      { method: "POST", match: "createRecord", body: { uri: "at://did:plc:1/app.bsky.feed.post/3kabc", cid: "c" } },
    ]);
    const r = await blueskyPublisher.publish({ channel: ch("did:plc:1", { login: "harbor.bsky.social" }), accessToken: "pw", caption: "New roast #coffee", firstComment: "", media: [] });
    expect(r.url).toBe("https://bsky.app/profile/harbor.bsky.social/post/3kabc");
    const rec = JSON.parse(f.calls[1]!.body).record;
    expect(rec.facets).toHaveLength(1);
  });

  it("rejects video and long posts", async () => {
    await expect(blueskyPublisher.publish({ channel: ch("d"), accessToken: "p", caption: "x", firstComment: "", media: [vid()] })).rejects.toMatchObject({ kind: "permanent" });
    await expect(blueskyPublisher.publish({ channel: ch("d"), accessToken: "p", caption: "x".repeat(301), firstComment: "", media: [] })).rejects.toMatchObject({ kind: "permanent" });
  });
});

describe("Mastodon", () => {
  it("normalises server addresses", () => {
    expect(normaliseInstance("Mastodon.Social")).toBe("mastodon.social");
    expect(normaliseInstance("@me@fosstodon.org")).toBe("fosstodon.org");
    expect(normaliseInstance("https://hachyderm.io/@me")).toBe("hachyderm.io");
    expect(normaliseInstance("localhost")).toBeNull();
    expect(normaliseInstance("a..b.com")).toBeNull();
    expect(normaliseInstance("")).toBeNull();
  });
});

describe("DEV.to", () => {
  it("splits a caption into an article", () => {
    expect(toArticle("\n# Shipping faster\nWe cut build time in half. #devops #CI #a #b #c")).toEqual({
      title: "Shipping faster",
      body: "We cut build time in half. #devops #CI #a #b #c",
      tags: ["devops", "ci", "a", "b"],
    });
  });

  it("checks the key shape before calling DEV", async () => {
    const f = mockFetch([]);
    await expect(devtoProvider.connectWithCredentials!({ apiKey: "short" })).rejects.toBeInstanceOf(PublishError);
    expect(f.calls).toHaveLength(0);
  });

  it("publishes with the first image as the cover", async () => {
    const f = mockFetch([{ method: "POST", match: "/api/articles", body: { id: 9, url: "https://dev.to/harbor/shipping-1" } }]);
    const r = await devtoPublisher.publish({ channel: ch("1"), accessToken: "k", caption: "Shipping\nBody", firstComment: "", media: [img("https://m/c.jpg"), img("https://m/i.jpg")] });
    expect(r).toEqual({ externalId: "9", url: "https://dev.to/harbor/shipping-1", warnings: [] });
    const a = JSON.parse(f.calls[0]!.body).article;
    expect(a.main_image).toBe("https://m/c.jpg");
    expect(a.body_markdown).toContain("![A latte](https://m/i.jpg)");
  });
});

describe("Pinterest", () => {
  it("takes the title from the first line and the link from the caption", () => {
    expect(pinText("\nAutumn menu\nPumpkin everything")).toEqual({ title: "Autumn menu", description: "\nAutumn menu\nPumpkin everything" });
    expect(firstLink("See https://harbor.coffee/menu). Thanks")).toBe("https://harbor.coffee/menu");
    expect(firstLink("no link")).toBeNull();
  });

  it("pins an image from its URL to the channel's board", async () => {
    const f = mockFetch([{ method: "POST", match: "/v5/pins", body: { id: "pin1" } }]);
    const r = await pinterestPublisher.publish({ channel: ch("b1", { boardId: "b1" }), accessToken: "t", caption: "Menu https://harbor.coffee", firstComment: "", media: [img()] });
    expect(r.url).toBe("https://www.pinterest.com/pin/pin1/");
    const body = JSON.parse(f.calls[0]!.body);
    expect(body).toMatchObject({ board_id: "b1", link: "https://harbor.coffee", media_source: { source_type: "image_url" } });
  });
});

describe("YouTube and Google Business", () => {
  it("makes a title from the first line", () => {
    expect(youtubeTitle("\n<Latte art> in 60s\nmore")).toBe("Latte art in 60s");
    expect(youtubeTitle("")).toBe("New video");
    expect(youtubeTitle("x".repeat(150))).toHaveLength(100);
  });

  it("posts a standard update to the location", async () => {
    const f = mockFetch([{ method: "POST", match: "accounts/1/locations/2/localPosts", body: { name: "accounts/1/locations/2/localPosts/9", searchUrl: "https://g.co/x", state: "LIVE" } }]);
    const r = await googleBusinessPublisher.publish({ channel: ch("accounts/1/locations/2"), accessToken: "t", caption: "Open late Friday", firstComment: "", media: [] });
    expect(r).toEqual({ externalId: "accounts/1/locations/2/localPosts/9", url: "https://g.co/x", warnings: [] });
    expect(JSON.parse(f.calls[0]!.body)).toMatchObject({ topicType: "STANDARD", summary: "Open late Friday" });
  });
});

describe("Figures for the new channels", () => {
  it("reads YouTube subscribers and hides them when the channel does", async () => {
    mockFetch([
      { match: "channels?part=statistics", body: { items: [{ statistics: { subscriberCount: "1200" } }] } },
      { match: "channels?part=statistics", body: { items: [{ statistics: { subscriberCount: "0", hiddenSubscriberCount: true } }] } },
    ]);
    const ctx = { channel: ch("UC1"), accessToken: "t" };
    expect(await ENGAGE.youtube!.followers(ctx)).toBe(1200);
    expect(await ENGAGE.youtube!.followers(ctx)).toBeNull();
  });

  it("adds Bluesky reposts and quotes together as shares", async () => {
    mockFetch([{ match: "getPosts", body: { posts: [{ likeCount: 5, repostCount: 2, quoteCount: 1, replyCount: 3 }] } }]);
    expect(await ENGAGE.bluesky!.post({ channel: ch("did"), accessToken: "p" }, "at://x")).toEqual({ likes: 5, shares: 3, comments: 3 });
  });
});

describe("post rules for the new channels", () => {
  const c = (platform: Parameters<typeof checkPost>[0][number]["platform"]) => ({ id: platform, platform, handle: "a" });
  it("limits Bluesky to four photos and no video", () => {
    expect(checkPost([c("bluesky")], "hi", {}, [{ kind: "video" }])).toContain("Bluesky posts can have up to 4 photos (no video yet).");
    expect(checkPost([c("bluesky")], "hi", {}, Array(5).fill({ kind: "image" }))).toHaveLength(1);
    expect(checkPost([c("bluesky")], "hi", {}, [{ kind: "image" }])).toEqual([]);
  });
  it("needs one video for YouTube and text for Google Business", () => {
    expect(checkPost([c("youtube")], "hi", {}, [{ kind: "image" }])).toContain("YouTube posts need exactly one video.");
    expect(checkPost([c("google_business")], "", {}, [{ kind: "image" }])).toContain("Google Business Profile posts need text.");
  });
  it("lets Threads and Mastodon post text alone", () => {
    expect(checkPost([c("threads"), c("mastodon")], "hello", {}, [])).toEqual([]);
  });
});
