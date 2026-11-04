import { vi } from "vitest";
vi.mock("@/db", () => ({ db: {} }));
import { describe, expect, it } from "vitest";
import { checkWebhookUrl, isPublicAddress, safePost } from "./safe-http";

describe("isPublicAddress", () => {
  it("blocks private, loopback, link-local and metadata addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "::", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "64:ff9b::a9fe:a9fe", "2002:7f00:1::"])
      expect(isPublicAddress(ip), ip).toBe(false);
  });
  it("allows public addresses", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "172.32.0.1"]) expect(isPublicAddress(ip), ip).toBe(true);
  });
});

describe("checkWebhookUrl", () => {
  it("requires https, no credentials and no private hosts", () => {
    expect(checkWebhookUrl("http://example.com/hook").ok).toBe(false);
    expect(checkWebhookUrl("https://user:pw@example.com").ok).toBe(false);
    expect(checkWebhookUrl("https://127.0.0.1/x").ok).toBe(false);
    expect(checkWebhookUrl("https://[::1]/x").ok).toBe(false);
    expect(checkWebhookUrl("https://localhost/x").ok).toBe(false);
    expect(checkWebhookUrl("https://hooks.example.com/abc").ok).toBe(true);
  });
  it("refuses to connect when a name resolves to a private address", async () => {
    await expect(safePost("https://localhost.localdomain.invalid/", "{}", {})).rejects.toThrow();
    await expect(safePost("https://127.0.0.1/", "{}", {})).rejects.toThrow(/private/);
  });
});

describe("sign", () => {
  it("signs the timestamp and body", async () => {
    const { sign } = await import("./webhooks");
    const { createHmac } = await import("node:crypto");
    expect(sign("s3cret", '{"a":1}', 1700000000)).toBe(`t=1700000000,v1=${createHmac("sha256", "s3cret").update('1700000000.{"a":1}').digest("hex")}`);
  });
});
