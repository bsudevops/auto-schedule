import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, newApiKey, sha256 } from "./crypto";

beforeAll(() => {
  process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
});

describe("secret encryption", () => {
  it("round-trips and uses a fresh IV each time", () => {
    const a = encryptSecret("token-123");
    const b = encryptSecret("token-123");
    expect(a).not.toEqual(b);
    expect(decryptSecret(a)).toBe("token-123");
  });
  it("rejects tampered ciphertext", () => {
    const parts = encryptSecret("token-123").split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptSecret(parts.join("."))).toThrow();
  });
});

describe("api keys", () => {
  it("stores only a hash that matches the key", () => {
    const k = newApiKey();
    expect(k.key.startsWith("yb_live_")).toBe(true);
    expect(k.hash).toBe(sha256(k.key));
    expect(k.hash).not.toContain(k.key);
  });
});
