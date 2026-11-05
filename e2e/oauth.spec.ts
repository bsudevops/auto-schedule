import { createHash, randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import { go } from "./helpers";

const REDIRECT = "http://localhost:9/callback";

test("an AI assistant signs in with OAuth, uses the MCP server, refreshes and is disconnected", async ({ page, request, baseURL }) => {
  // Without a token, the MCP server points at its sign-in metadata.
  const anon = await request.post("/api/mcp", { data: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
  expect(anon.status()).toBe(401);
  expect(anon.headers()["www-authenticate"]).toContain(`resource_metadata="${baseURL}/.well-known/oauth-protected-resource"`);
  const prm = await (await request.get("/.well-known/oauth-protected-resource/api/mcp")).json();
  expect(prm.authorization_servers).toEqual([baseURL]);
  const meta = await (await request.get("/.well-known/oauth-authorization-server")).json();
  expect(meta.registration_endpoint).toBe(`${baseURL}/oauth/register`);

  // The assistant registers itself.
  const reg = await request.post("/oauth/register", { data: { client_name: "Claude", redirect_uris: [REDIRECT], token_endpoint_auth_method: "client_secret_post" } });
  expect(reg.status()).toBe(201);
  const client = await reg.json();
  expect(await (await request.post("/oauth/register", { data: { redirect_uris: ["http://evil.example/cb"] } })).json()).toMatchObject({ error: "invalid_redirect_uri" });

  // The person approves it on the consent screen. The assistant's return address is answered locally.
  await page.route(`${REDIRECT}**`, (r) => r.fulfill({ status: 200, contentType: "text/plain", body: "ok" }));
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const qs = new URLSearchParams({ response_type: "code", client_id: client.client_id, redirect_uri: REDIRECT, state: "xyz", code_challenge: challenge, code_challenge_method: "S256", scope: "channels:read posts:read", resource: `${baseURL}/api/mcp` });
  await go(page, `/oauth/authorize?${qs}`);
  await expect(page.getByRole("heading", { name: "Connect Claude" })).toBeVisible();
  await page.locator("#workspaceId").selectOption({ label: "Harbor Coffee Co. · Northwind Agency" });
  await page.getByRole("button", { name: "Allow" }).click();
  await page.waitForURL((u) => u.href.startsWith(REDIRECT));
  const cb = new URL(page.url());
  expect(cb.searchParams.get("state")).toBe("xyz");
  const code = cb.searchParams.get("code")!;

  const exchange = (extra: Record<string, string>) =>
    request.post("/oauth/token", { form: { client_id: client.client_id, client_secret: client.client_secret, ...extra } });
  expect((await exchange({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, code_verifier: "x".repeat(43) })).status()).toBe(400);
  // The failed attempt used the code up, so sign in again.
  await go(page, `/oauth/authorize?${qs}`);
  await page.locator("#workspaceId").selectOption({ label: "Harbor Coffee Co. · Northwind Agency" });
  await page.getByRole("button", { name: "Allow" }).click();
  await page.waitForURL((u) => u.href.startsWith(REDIRECT));
  const code2 = new URL(page.url()).searchParams.get("code")!;
  const tok = await (await exchange({ grant_type: "authorization_code", code: code2, redirect_uri: REDIRECT, code_verifier: verifier })).json();
  expect(tok).toMatchObject({ token_type: "Bearer", expires_in: 3600, scope: "posts:read channels:read" });

  // The token works on the MCP server and only offers the tools it was allowed.
  const mcp = (t: string) => request.post("/api/mcp", { headers: { Authorization: `Bearer ${t}` }, data: { jsonrpc: "2.0", id: 2, method: "tools/list" } });
  const tools = (await (await mcp(tok.access_token)).json()).result.tools.map((t: { name: string }) => t.name);
  expect(tools).toContain("list_channels");
  expect(tools).not.toContain("create_post");

  // Refreshing rotates both tokens; the old ones stop working.
  const fresh = await (await exchange({ grant_type: "refresh_token", refresh_token: tok.refresh_token })).json();
  expect(fresh.access_token).toBeTruthy();
  expect((await mcp(tok.access_token)).status()).toBe(401);
  expect((await exchange({ grant_type: "refresh_token", refresh_token: tok.refresh_token })).status()).toBe(400);
  expect((await mcp(fresh.access_token)).status()).toBe(200);

  // Disconnecting it in Settings ends access at once.
  await go(page, "/organization");
  await page.getByRole("link", { name: /Harbor Coffee Co\./ }).first().click();
  await page.waitForURL(/\/w\/[0-9a-f-]{36}/);
  const ws = page.url().match(/\/w\/[0-9a-f-]{36}/)![0];
  await go(page, `${ws}/settings/developer`);
  await expect(page.getByRole("heading", { name: "Connected AI apps" })).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Disconnect" }).first().click();
  await expect(page.getByRole("heading", { name: "Connected AI apps" })).toHaveCount(0);
  expect((await mcp(fresh.access_token)).status()).toBe(401);
  expect((await exchange({ grant_type: "refresh_token", refresh_token: fresh.refresh_token })).status()).toBe(400);
});

test("signing in from the consent link comes back to it", async ({ browser, request }) => {
  const client = await (await request.post("/oauth/register", { data: { client_name: "Claude", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none" } })).json();
  expect(client.client_secret).toBeUndefined();
  const anon = await browser.newPage({ storageState: { cookies: [], origins: [] } });
  const qs = new URLSearchParams({ response_type: "code", client_id: client.client_id, redirect_uri: REDIRECT, code_challenge: "a".repeat(43), code_challenge_method: "S256" });
  await go(anon, `/oauth/authorize?${qs}`);
  await expect(anon).toHaveURL(/\/sign-in\?next=/);
  await anon.getByLabel("Email").fill("demo@example.com");
  await anon.getByLabel("Password").fill("demo-password-123");
  await anon.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(anon.getByRole("heading", { name: "Connect Claude" })).toBeVisible();

  // A link with an unregistered return address is refused on the page, not redirected.
  await go(anon, `/oauth/authorize?${new URLSearchParams({ ...Object.fromEntries(qs), redirect_uri: "https://evil.example/cb" })}`);
  await expect(anon.getByText("doesn't match the app's registration")).toBeVisible();
});

test("one connection can cover every workspace, and the assistant picks the client per request", async ({ page, request, baseURL }) => {
  const client = await (await request.post("/oauth/register", { data: { client_name: "Claude", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none" } })).json();
  await page.route(`${REDIRECT}**`, (r) => r.fulfill({ status: 200, contentType: "text/plain", body: "ok" }));
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const qs = new URLSearchParams({ response_type: "code", client_id: client.client_id, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: "S256", resource: `${baseURL}/api/mcp` });
  await go(page, `/oauth/authorize?${qs}`);
  await expect(page.locator("#workspaceId")).toHaveValue("all");
  await page.getByRole("button", { name: "Allow" }).click();
  await page.waitForURL((u) => u.href.startsWith(REDIRECT));
  const code = new URL(page.url()).searchParams.get("code")!;
  const tok = await (await request.post("/oauth/token", { form: { client_id: client.client_id, grant_type: "authorization_code", code, redirect_uri: REDIRECT, code_verifier: verifier } })).json();
  expect(tok.scope).toContain("workspaces:create");

  let n = 10;
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const res = await request.post("/api/mcp", { headers: { Authorization: `Bearer ${tok.access_token}` }, data: { jsonrpc: "2.0", id: n++, method: "tools/call", params: { name, arguments: args } } });
    expect(res.status()).toBe(200);
    return (await res.json()).result as { isError?: boolean; content: { text: string }[] };
  };
  const tools = await (await request.post("/api/mcp", { headers: { Authorization: `Bearer ${tok.access_token}` }, data: { jsonrpc: "2.0", id: 1, method: "tools/list" } })).json();
  const names = tools.result.tools.map((t: { name: string }) => t.name);
  expect(names).toEqual(expect.arrayContaining(["list_workspaces", "create_workspace", "list_channels", "create_post"]));

  const list = JSON.parse((await call("list_workspaces")).content[0]!.text);
  expect(list.workspaces.map((w: { name: string }) => w.name)).toEqual(expect.arrayContaining(["Harbor Coffee Co.", "Lumen Fitness"]));

  // Without a workspace, the assistant is told which ones it can use.
  const missing = await call("list_channels");
  expect(missing.isError).toBe(true);
  expect(missing.content[0]!.text).toContain("Harbor Coffee Co.");
  const harbor = await call("list_channels", { workspace: "harbor coffee co." });
  expect(harbor.isError).toBeUndefined();
  expect(JSON.parse(harbor.content[0]!.text).length).toBeGreaterThan(0);
  expect((await call("get_workspace", { workspace: "Nope" })).content[0]!.text).toContain("No workspace called");

  // It can add a new client, which it can then use straight away.
  const created = await call("create_workspace", { name: "Claude Test Client" });
  expect(created.isError).toBeUndefined();
  expect(JSON.parse((await call("get_workspace", { workspace: "Claude Test Client" })).content[0]!.text).workspace.name).toBe("Claude Test Client");

  // A workspace API key can't be used for these tools: the REST API still refuses the account token.
  expect((await request.get("/api/v1/me", { headers: { Authorization: `Bearer ${tok.access_token}` } })).status()).toBe(401);

  // It shows in a workspace's Connected AI apps and can be disconnected there.
  await go(page, "/organization");
  await page.getByRole("link", { name: /Lumen Fitness/ }).first().click();
  await page.waitForURL(/\/w\/[0-9a-f-]{36}/);
  await go(page, `${page.url().match(/\/w\/[0-9a-f-]{36}/)![0]}/settings/developer`);
  await expect(page.getByText("all their workspaces")).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Disconnect" }).first().click();
  await expect(page.getByText("all their workspaces")).toHaveCount(0);
  expect((await request.post("/api/mcp", { headers: { Authorization: `Bearer ${tok.access_token}` }, data: { jsonrpc: "2.0", id: 99, method: "tools/list" } })).status()).toBe(401);
});
