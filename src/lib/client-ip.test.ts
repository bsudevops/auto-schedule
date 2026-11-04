import { describe, expect, it } from "vitest";
import { clientIp } from "./client-ip";

describe("clientIp", () => {
  it("ignores X-Forwarded-For when no proxy is trusted", () => {
    expect(clientIp("203.0.113.9", "1.2.3.4", "")).toBe("203.0.113.9");
  });
  it("ignores X-Forwarded-For from an untrusted peer", () => {
    expect(clientIp("203.0.113.9", "1.2.3.4", "10.0.0.0/8")).toBe("203.0.113.9");
  });
  it("takes the right-most untrusted hop behind a trusted proxy", () => {
    // Client spoofed 1.2.3.4; the proxy appended the real address 198.51.100.7.
    expect(clientIp("10.0.0.5", "1.2.3.4, 198.51.100.7", "10.0.0.0/8")).toBe("198.51.100.7");
  });
});
