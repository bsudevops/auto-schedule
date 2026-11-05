import { expect, type Page } from "@playwright/test";

export const DEMO = { email: "demo@example.com", password: "demo-password-123" };
export const STATE = "e2e/results/.auth.json";

/** Navigates and waits until the page is interactive, so clicks reach React rather than the bare HTML. */
export async function go(page: Page, url: string) {
  const res = await page.goto(url);
  await page.waitForLoadState("networkidle");
  return res;
}

export async function signInWithForm(page: Page, password = DEMO.password) {
  await go(page, "/sign-in");
  await page.getByLabel("Email").fill(DEMO.email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

/** Opens the Harbor Coffee workspace with the saved session and returns its URL path. */
export async function openWorkspace(page: Page): Promise<string> {
  await go(page, "/");
  await page.waitForURL(/\/organization/);
  await page.getByRole("link", { name: /Harbor Coffee Co\./ }).first().click();
  await page.waitForURL(/\/w\/[0-9a-f-]{36}/);
  const base = page.url().match(/\/w\/[0-9a-f-]{36}/)![0];
  await expect(page.getByText("Harbor Coffee Co.").first()).toBeVisible();
  return base;
}
