import { test as setup } from "@playwright/test";
import { STATE, signInWithForm } from "./helpers";

setup("sign in once", async ({ page }) => {
  await signInWithForm(page);
  await page.waitForURL(/\/w\//);
  await page.context().storageState({ path: STATE });
});
