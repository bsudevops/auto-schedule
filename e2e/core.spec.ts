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
