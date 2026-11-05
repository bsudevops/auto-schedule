import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({ db: {} }));

const { authorizationServerMetadata, parseScopes, pkceChallenge, protectedResourceMetadata, resourceOk, validRedirectUri, verifyPkce } = await import("./oauth");

describe("OAuth for the MCP server", () => {
  it("accepts HTTPS redirect addresses and http only on this computer", () => {
    expect(validRedirectUri("https://claude.ai/api/mcp/auth_callback")).toBe(true);
    expect(validRedirectUri("http://localhost:6274/oauth/callback")).toBe(true);
    expect(validRedirectUri("http://127.0.0.1:33418/")).toBe(true);
    expect(validRedirectUri("http://evil.example/cb")).toBe(false);
    expect(validRedirectUri("https://claude.ai/cb#frag")).toBe(false);
    expect(validRedirectUri("javascript:alert(1)")).toBe(false);
    expect(validRedirectUri(42)).toBe(false);
  });

  it("keeps only known scopes, and grants all when none are asked for", () => {
    expect(parseScopes(undefined)).toEqual(["posts:read", "posts:write", "channels:read", "analytics:read", "workspaces:create"]);
    expect(parseScopes("posts:read  bogus analytics:read")).toEqual(["posts:read", "analytics:read"]);
    expect(parseScopes("bogus")).toEqual([]);
  });

  it("checks the PKCE verifier against its S256 challenge", () => {
    // Example from RFC 7636, appendix B.
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    expect(pkceChallenge(verifier)).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    expect(verifyPkce(verifier, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")).toBe(true);
    expect(verifyPkce("wrong-verifier-wrong-verifier-wrong-verifier-x", "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")).toBe(false);
    expect(verifyPkce(null, "x")).toBe(false);
    expect(verifyPkce("short", pkceChallenge("short"))).toBe(false);
  });

  it("publishes discovery documents that point at this server", () => {
    process.env.APP_URL = "https://bsu.example/";
    expect(protectedResourceMetadata()).toMatchObject({ resource: "https://bsu.example/api/mcp", authorization_servers: ["https://bsu.example"] });
    expect(authorizationServerMetadata()).toMatchObject({
      issuer: "https://bsu.example",
      token_endpoint: "https://bsu.example/oauth/token",
      registration_endpoint: "https://bsu.example/oauth/register",
      code_challenge_methods_supported: ["S256"],
    });
    expect(resourceOk(undefined)).toBe(true);
    expect(resourceOk("https://bsu.example/api/mcp/")).toBe(true);
    expect(resourceOk("https://other.example/api/mcp")).toBe(false);
  });
});
