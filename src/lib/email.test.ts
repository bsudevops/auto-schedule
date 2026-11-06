import { describe, expect, it } from "vitest";
import { explainSmtpError, fromAddress, renderHtml, smtpOptions } from "./email";

describe("smtpOptions", () => {
  it("uses STARTTLS on 587 and SSL on 465", () => {
    expect(smtpOptions({ SMTP_HOST: "smtp.x.com", SMTP_PORT: "587" }).secure).toBe(false);
    expect(smtpOptions({ SMTP_HOST: "smtp.x.com", SMTP_PORT: "465" }).secure).toBe(true);
    expect(smtpOptions({ SMTP_HOST: "smtp.x.com", SMTP_PORT: "2525", SMTP_SECURE: "true" }).secure).toBe(true);
  });
  it("removes the spaces Gmail shows in app passwords, only for Gmail", () => {
    expect(smtpOptions({ SMTP_HOST: "smtp.gmail.com", SMTP_USER: "a@gmail.com", SMTP_PASSWORD: "abcd efgh ijkl mnop" }).auth?.pass).toBe("abcdefghijklmnop");
    expect(smtpOptions({ SMTP_HOST: "smtp.x.com", SMTP_USER: "a", SMTP_PASSWORD: "a b" }).auth?.pass).toBe("a b");
  });
  it("skips auth without a user", () => {
    expect(smtpOptions({ SMTP_HOST: "localhost" }).auth).toBeUndefined();
  });
});

describe("fromAddress", () => {
  it("uses EMAIL_FROM when it's real, otherwise the SMTP login", () => {
    expect(fromAddress({ EMAIL_FROM: "Team <team@bsu.dev>", SMTP_USER: "a@gmail.com" })).toBe("Team <team@bsu.dev>");
    expect(fromAddress({ EMAIL_FROM: "BSU Scheduler <no-reply@example.com>", SMTP_USER: "a@gmail.com" })).toContain("<a@gmail.com>");
  });
});

describe("renderHtml", () => {
  it("escapes text and includes the button link", () => {
    const html = renderHtml({ subject: "Hi", text: "<b>x</b>\n\nsecond", button: { label: "Go", url: "https://a.com/invite/t?x=1&y=2" } });
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).toContain('href="https://a.com/invite/t?x=1&amp;y=2"');
  });
});

describe("explainSmtpError", () => {
  it("explains a rejected login without echoing secrets", () => {
    expect(explainSmtpError({ code: "EAUTH", message: "535 5.7.8 Username and Password not accepted" })).toMatch(/app password/);
  });
});
