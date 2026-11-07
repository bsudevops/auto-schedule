import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { linkedinPagesProvider, linkedinProvider } from "./linkedin";
import { mockFetch } from "./test-fetch";

vi.mock("@/db", () => ({ db: {} }));

beforeEach(() => {
  process.env.LINKEDIN_PAGES_CLIENT_ID = "pages-app";
  process.env.LINKEDIN_PAGES_CLIENT_SECRET = "pages-secret";
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.LINKEDIN_PAGES_CLIENT_ID;
  delete process.env.LINKEDIN_PAGES_CLIENT_SECRET;
});

describe("LinkedIn company pages app", () => {
  it("asks only for organization scopes, with its own client ID", async () => {
    const u = new URL(await linkedinPagesProvider.authorizeUrl!("st", "https://app/cb/linkedin_pages"));
    expect(u.searchParams.get("client_id")).toBe("pages-app");
    expect(u.searchParams.get("scope")).not.toMatch(/openid|profile/);
    expect(u.searchParams.get("scope")).toMatch(/w_organization_social/);
  });

  it("returns the pages the member administers, marked as coming from the pages app", async () => {
    mockFetch([
      { method: "POST", match: "oauth/v2/accessToken", body: { access_token: "tok", expires_in: 5184000 } },
      { match: "organizationAcls", body: { elements: [{ organization: "urn:li:organization:42" }] } },
      { match: "organizations/42", body: { localizedName: "Teak Ads", vanityName: "teak-ads" } },
    ]);
    const accts = await linkedinPagesProvider.exchangeCode!("code", "https://app/cb");
    expect(accts).toHaveLength(1);
    expect(accts[0]).toMatchObject({ platform: "linkedin", externalId: "organization:42", displayName: "Teak Ads", meta: { author: "urn:li:organization:42", kind: "organization", app: "pages" } });
  });

  it("is only set up when both of its keys are present", () => {
    expect(linkedinPagesProvider.configured()).toBe(true);
    delete process.env.LINKEDIN_PAGES_CLIENT_SECRET;
    expect(linkedinPagesProvider.configured()).toBe(false);
    expect(linkedinProvider.id).toBe("linkedin");
  });
});
