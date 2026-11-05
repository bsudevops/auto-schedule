import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { go, openWorkspace, signInWithForm } from "./helpers";

// Tests run in order on one worker (see playwright.config.ts); a failure doesn't stop the rest.

test("a wrong password is refused", async ({ browser }) => {
  const page = await browser.newPage({ storageState: { cookies: [], origins: [] } });
  await signInWithForm(page, "not-the-password");
  await expect(page.locator(".err")).toBeVisible();
  await expect(page).toHaveURL(/sign-in/);
});

test("signed-out visitors are sent to sign in, and other workspaces are hidden", async ({ browser, page }) => {
  const anon = await browser.newPage({ storageState: { cookies: [], origins: [] } });
  await go(anon, "/w/00000000-0000-4000-8000-000000000000/calendar");
  await expect(anon).toHaveURL(/sign-in/);
  const res = await page.goto("/w/00000000-0000-4000-8000-000000000000/calendar");
  expect(res?.status()).toBe(404);
});

test("publish now goes out on each channel and notifies the author", async ({ page }) => {
  const base = await openWorkspace(page);
  await go(page, `${base}/compose`);
  // Start from Facebook and LinkedIn only (Instagram needs media).
  for (const name of ["Instagram", "Facebook", "LinkedIn"]) {
    const chip = page.locator("button", { hasText: name }).first();
    const on = (await chip.getAttribute("class"))?.includes("on");
    if ((name === "Instagram" && on) || (name !== "Instagram" && !on)) await chip.click();
  }
  const caption = `End-to-end post ${Date.now()}`;
  await page.locator("textarea").first().fill(caption);
  await page.getByText("Goes out right away").click();
  await page.getByRole("button", { name: "Publish now" }).last().click();
  await page.waitForURL(/calendar/);

  await go(page, `${base}/search?q=${encodeURIComponent(caption)}`);
  await page.getByRole("link", { name: caption }).click();
  await expect(page.locator(".page-head .pill")).toHaveText("Published", { timeout: 45_000 });
  await expect(page.locator("[data-target]")).toHaveCount(2);

  await page.reload();
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: /Notifications/ }).click();
  await expect(page.getByRole("dialog", { name: "Notifications" })).toContainText(`Published: “${caption}`);
});

test("failed channels can be retried", async ({ page }) => {
  const base = await openWorkspace(page);
  await go(page, `${base}/search?q=Rainy%20day`);
  await page.getByRole("link", { name: /Rainy day/ }).click();
  await page.getByRole("button", { name: /Retry/ }).click();
  // TikTok still needs reconnecting, so the retry fails again with a clear reason.
  await expect(page.locator("[data-target] .err")).toContainText("needs reconnecting", { timeout: 45_000 });
});

test("inbox: reply with a saved reply, assign and mark done", async ({ page }) => {
  const base = await openWorkspace(page);
  await go(page, `${base}/inbox`);
  await page.locator("[data-thread='Linda Ortiz']").click();
  await expect(page.locator(".detail-h h2")).toHaveText("Linda Ortiz");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Thanks so much! ☕" }).click();
  await expect(page.getByLabel("Reply")).toHaveValue("Thanks so much! ☕");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.locator(".bubble.me").last()).toHaveText("Thanks so much! ☕");
  await page.getByLabel("Assign to").selectOption({ label: "Marcus Lee" });
  await expect(page.getByLabel("Assign to")).toHaveValue(/.+/);
  await page.getByRole("button", { name: "Mark done" }).click();
  await expect(page.locator("[data-thread='Linda Ortiz']")).toHaveCount(0);
  await go(page, `${base}/inbox?filter=done`);
  await expect(page.locator("[data-thread='Linda Ortiz']")).toBeVisible();
});

test("analytics: filter by channel, sort and export", async ({ page }) => {
  const base = await openWorkspace(page);
  await go(page, `${base}/analytics`);
  await expect(page.getByRole("img", { name: /Daily impressions/ })).toBeVisible();
  await page.getByRole("navigation", { name: "Filter by channel" }).getByRole("link", { name: /Harbor Coffee Co\./ }).click();
  await expect(page).toHaveURL(/channel=/);
  await expect(page.getByText("Results for Harbor Coffee Co.")).toBeVisible();
  await page.getByRole("link", { name: /^Followers/ }).click();
  await expect(page).toHaveURL(/sort=followers/);
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Export CSV" }).click()]);
  expect(download.suggestedFilename()).toMatch(/^analytics-harbor-coffee-co-.*\.csv$/);
});

test("API keys work, respect scopes and stop working when revoked", async ({ page, request }) => {
  const base = await openWorkspace(page);
  await go(page, `${base}/settings/developer`);
  await page.getByLabel("Key name").fill("E2E");
  await page.getByRole("button", { name: "Create key" }).click();
  const key = (await page.locator("[data-secret]").textContent())!.trim();
  expect(key).toMatch(/^bsu_live_/);

  const auth = { Authorization: `Bearer ${key}` };
  const me = await request.get("/api/v1/me", { headers: auth });
  expect(me.status()).toBe(200);
  expect((await me.json()).workspace.name).toBe("Harbor Coffee Co.");

  const chans = await request.get("/api/v1/channels", { headers: auth });
  expect(chans.status()).toBe(403); // channels:read wasn't granted

  const created = await request.post("/api/v1/posts", { headers: auth, data: { channelIds: [], caption: "Draft from the API", mode: "draft" } });
  expect(created.status()).toBe(201);
  const post = (await created.json()).data;
  expect(post.status).toBe("draft");
  expect((await request.delete(`/api/v1/posts/${post.id}`, { headers: auth })).status()).toBe(204);

  expect((await request.get("/api/v1/posts", { headers: { Authorization: "Bearer bsu_live_nope" } })).status()).toBe(401);

  // The same key works over MCP, and only the tools its scopes allow are offered.
  const rpc = (method: string, params?: unknown) => request.post("/api/mcp", { headers: auth, data: { jsonrpc: "2.0", id: 1, method, params } });
  expect((await request.post("/api/mcp", { data: { jsonrpc: "2.0", id: 1, method: "ping" } })).status()).toBe(401);
  const list = await (await rpc("tools/list")).json();
  const names = list.result.tools.map((t: { name: string }) => t.name);
  expect(names).toContain("create_post");
  expect(names).not.toContain("list_channels");
  const made = await (await rpc("tools/call", { name: "create_post", arguments: { channelIds: [], caption: "Draft from MCP", mode: "draft" } })).json();
  expect(made.result.isError).toBeUndefined();
  const mcpPost = JSON.parse(made.result.content[0].text);
  expect(mcpPost.status).toBe("draft");
  expect((await (await rpc("tools/call", { name: "delete_post", arguments: { postId: mcpPost.id } })).json()).result.content[0].text).toBe("Deleted.");
  expect((await request.get("/api/mcp", { headers: auth })).status()).toBe(405);

  await page.getByRole("button", { name: "Done" }).click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("row", { name: /E2E/ }).getByRole("button", { name: "Revoke" }).click();
  await expect(page.getByRole("row", { name: /E2E/ })).toHaveCount(0);
  expect((await request.get("/api/v1/me", { headers: auth })).status()).toBe(401);
});

test("webhooks refuse private addresses", async ({ page }) => {
  const base = await openWorkspace(page);
  await go(page, `${base}/settings/developer`);
  await page.getByLabel("Webhook URL").fill("https://169.254.169.254/latest/meta-data");
  await page.getByRole("button", { name: "Add webhook" }).click();
  await expect(page.locator(".err[role=alert]")).toContainText("private network");
  await page.getByLabel("Webhook URL").fill("http://example.com/hook");
  await page.getByRole("button", { name: "Add webhook" }).click();
  await expect(page.locator(".err[role=alert]")).toContainText("https://");
});

test("notification preferences save", async ({ page }) => {
  const base = await openWorkspace(page);
  await go(page, `${base}/settings/notifications`);
  await page.getByLabel("A post is published: email").check();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved.");
  await page.reload();
  await expect(page.getByLabel("A post is published: email")).toBeChecked();
});

test("health check answers", async ({ request }) => {
  const r = await request.get("/api/health");
  expect(r.status()).toBe(200);
  expect(await r.json()).toEqual({ ok: true, database: true, redis: true });
});

test("Bluesky, DEV and Mastodon connect with a short form", async ({ page }) => {
  const base = await openWorkspace(page);
  await go(page, `${base}/channels`);
  const bsky = page.locator('[data-provider="bluesky"]');
  await bsky.getByRole("button", { name: "Connect" }).click();
  await bsky.getByLabel("Handle or email").fill("harbor.bsky.social");
  await bsky.getByLabel("App password").fill("my main password");
  await bsky.getByRole("button", { name: "Connect" }).last().click();
  await expect(bsky.locator(".err")).toContainText("doesn't look like an app password");

  const masto = page.locator('[data-provider="mastodon"]');
  await masto.getByRole("button", { name: "Connect" }).click();
  await masto.getByLabel("Your Mastodon server").fill("not a server");
  await masto.getByRole("button", { name: "Continue to sign in" }).click();
  await expect(page).toHaveURL(/connect=mastodon/);
  await expect(page.locator('[data-provider="mastodon"] .err')).toContainText("Enter your server's address");
});

test("hashtag sets save from a caption and insert into another", async ({ page }) => {
  const base = await openWorkspace(page);
  await go(page, `${base}/compose`);
  const caption = page.locator("#caption");
  await caption.fill("Autumn menu is here #coffee #pumpkin");
  await page.locator("summary[aria-label=Hashtags]").click();
  await page.getByPlaceholder("Set name, like Product launch").fill("Autumn");
  await page.getByRole("button", { name: "Save set" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Hashtag set saved." })).toBeVisible();

  await caption.fill("Weekend hours");
  await page.locator(".tag-set .mi", { hasText: "Autumn" }).click();
  await expect(caption).toHaveValue("Weekend hours\n\n#coffee #pumpkin");
});

test("queues shuffle, best times show, and the team sees it in activity", async ({ page }) => {
  const base = await openWorkspace(page);
  await go(page, `${base}/calendar?view=queues`);
  await page.getByRole("button", { name: "Shuffle order" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Shuffled 3 posts" })).toBeVisible();

  await go(page, `${base}/analytics`);
  await expect(page.locator(".best-times li").first()).toBeVisible();

  await go(page, base);
  await expect(page.locator(".activity").first()).toContainText("shuffled 3 posts in “Weekday mornings”");
  await page.getByRole("link", { name: "See all" }).last().click();
  await expect(page.getByRole("heading", { name: "Team activity" })).toBeVisible();
});

test("sign-in lands on the organization page, where a client workspace can be created", async ({ page }) => {
  await go(page, "/");
  await expect(page).toHaveURL(/\/organization$/);
  await expect(page.getByRole("link", { name: /Harbor Coffee Co\./ }).first()).toBeVisible();
  const name = `Client ${Date.now()}`;
  await page.getByLabel("Workspace name").fill(name);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await page.waitForURL(/\/w\/[0-9a-f-]{36}/);
  await expect(page.getByText(name).first()).toBeVisible();
});

test("YouTube settings are saved with the post", async ({ page }) => {
  const base = await openWorkspace(page);
  await go(page, `${base}/compose`);
  const yt = page.locator("button.chip", { hasText: "YouTube" }).first();
  if (!(await yt.getAttribute("class"))?.includes("on")) await yt.click();
  const caption = `YouTube details ${Date.now()}\nA longer description for the video.`;
  await page.locator("textarea").first().fill(caption);
  const panel = page.getByRole("region", { name: /YouTube settings/ });
  await expect(panel.getByLabel(/^Title/)).toHaveAttribute("placeholder", caption.split("\n")[0]!);
  await panel.getByLabel(/^Title/).fill("Our spring menu");
  await panel.getByLabel("Visibility").selectOption("unlisted");
  await panel.getByText("Yes, it’s made for kids").click();
  await panel.getByLabel("Tags", { exact: true }).fill("coffee, spring,");
  await panel.getByLabel("Category").selectOption({ label: "Howto & Style" });
  await panel.getByRole("button", { name: "Show more" }).click();
  await panel.getByLabel("Paid promotion").check();
  await panel.getByLabel("Video language").selectOption({ label: "Malayalam" });
  await page.getByRole("button", { name: "Save draft" }).click();
  await page.waitForURL(/calendar/);

  await go(page, `${base}/search?q=${encodeURIComponent(caption.split("\n")[0]!)}`);
  await page.getByRole("link", { name: /YouTube details/ }).first().click();
  const again = page.getByRole("region", { name: /YouTube settings/ });
  await expect(again.getByLabel(/^Title/)).toHaveValue("Our spring menu");
  await expect(again.getByLabel("Visibility")).toHaveValue("unlisted");
  await expect(again.getByRole("radio", { name: /Yes, it’s made for kids/ })).toBeChecked();
  await expect(again.getByRole("button", { name: "Remove tag coffee" })).toBeVisible();
  await expect(again.getByRole("button", { name: "Remove tag spring" })).toBeVisible();
  await expect(again.getByLabel("Category")).toHaveValue("26");
  await again.getByRole("button", { name: "Show more" }).click();
  await expect(again.getByLabel("Paid promotion")).toBeChecked();
  await expect(again.getByLabel("Video language")).toHaveValue("ml");
});

test("a YouTube thumbnail can be dropped in or taken from a frame of the video", async ({ page }) => {
  const base = await openWorkspace(page);
  await go(page, `${base}/compose`);
  for (const name of ["Instagram", "Facebook", "LinkedIn"]) {
    const chip = page.locator("button.chip", { hasText: name }).first();
    if ((await chip.getAttribute("class"))?.includes("on")) await chip.click();
  }
  const yt = page.locator("button.chip", { hasText: "YouTube" }).first();
  if (!(await yt.getAttribute("class"))?.includes("on")) await yt.click();
  const caption = `Thumbnail test ${Date.now()}`;
  await page.locator("textarea").first().fill(caption);

  // Attach a video through the media picker.
  await page.getByRole("button", { name: "Add media" }).first().click();
  await page.getByRole("dialog", { name: "Add media" }).locator('input[type="file"]').setInputFiles("e2e/fixtures/clip.webm");
  await expect(page.getByRole("dialog", { name: "Add media" })).toBeHidden({ timeout: 30_000 });
  const panel = page.getByRole("region", { name: /YouTube settings/ });

  // Drag and drop an image.
  const drop = await page.evaluateHandle(() => new DataTransfer());
  const png = readFileSync("e2e/fixtures/thumb.png").toString("base64");
  await page.evaluate(({ dt, png }) => {
    const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
    dt.items.add(new File([bytes], "cover.png", { type: "image/png" }));
  }, { dt: drop, png });
  await panel.getByRole("button", { name: "Upload a thumbnail" }).dispatchEvent("drop", { dataTransfer: drop });
  await expect(panel.getByAltText("Chosen thumbnail")).toBeVisible({ timeout: 30_000 });
  await expect(panel.getByText("Using cover-thumbnail.jpg")).toBeVisible();

  // Then swap it for a suggested frame from the video.
  await panel.getByRole("button", { name: "Use suggested frame 2" }).click({ timeout: 30_000 });
  await expect(panel.getByText(/Using frame-1\.\ds\.jpg/)).toBeVisible({ timeout: 30_000 });

  // And for a frame picked in the player.
  await panel.getByRole("button", { name: "Pick a frame from the video" }).click();
  const player = panel.getByLabel("Video to pick a frame from");
  await player.evaluate((v: HTMLVideoElement) => new Promise<void>((ok) => { const go = () => { v.addEventListener("seeked", () => ok(), { once: true }); v.currentTime = 2.5; }; if (v.readyState >= 2) go(); else v.addEventListener("loadeddata", go, { once: true }); }));
  await panel.getByRole("button", { name: "Use this frame" }).click();
  await expect(panel.getByText("Using frame-2.5s.jpg")).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: "Save draft" }).click();
  await page.waitForURL(/calendar/);
  await go(page, `${base}/search?q=${encodeURIComponent(caption)}`);
  await page.getByRole("link", { name: caption }).first().click();
  await expect(page.getByRole("region", { name: /YouTube settings/ }).getByText("Using frame-2.5s.jpg")).toBeVisible();
});
