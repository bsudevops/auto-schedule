import { describe, expect, it } from "vitest";
import { adminEmails, isAdminEmail, signupMode } from "./signup-policy";

describe("signup policy", () => {
  it("is open unless told otherwise", () => {
    expect(signupMode({})).toBe("open");
    expect(signupMode({ SIGNUP_MODE: "" })).toBe("open");
    expect(signupMode({ SIGNUP_MODE: "something-else" })).toBe("open");
  });
  it("reads invite-only whatever the case or spacing", () => {
    expect(signupMode({ SIGNUP_MODE: " Invite-Only " })).toBe("invite-only");
  });
  it("reads a list of admin emails", () => {
    expect(adminEmails({ ADMIN_EMAILS: " Akhil@BrandSure.in , ,boss@example.com " })).toEqual(["akhil@brandsure.in", "boss@example.com"]);
    expect(adminEmails({})).toEqual([]);
  });
  it("matches admin emails without caring about case", () => {
    const env = { ADMIN_EMAILS: "akhil@brandsure.in" };
    expect(isAdminEmail("AKHIL@brandsure.in ", env)).toBe(true);
    expect(isAdminEmail("someone@else.com", env)).toBe(false);
    expect(isAdminEmail("akhil@brandsure.in.evil.com", env)).toBe(false);
  });
});
