import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { cleanFilename, processUpload, storageKey, UploadError } from "./pipeline";

const png = (alpha = false) =>
  sharp({ create: { width: 64, height: 48, channels: alpha ? 4 : 3, background: alpha ? { r: 0, g: 0, b: 255, alpha: 0.5 } : "#2B86F5" } }).png().toBuffer();

describe("processUpload", () => {
  it("re-encodes a photo to JPEG and makes channel sizes", async () => {
    const out = await processUpload(await png());
    expect(out.kind).toBe("image");
    expect(out.ext).toBe("jpg");
    expect(out.width).toBe(64);
    expect(out.variants.map((v) => v.preset)).toEqual(["square", "portrait", "landscape", "thumb"]);
  });

  it("keeps transparency as PNG", async () => {
    expect((await processUpload(await png(true))).ext).toBe("png");
  });

  it("rejects an HTML file whatever it claims to be", async () => {
    const html = Buffer.from("<!doctype html><script>alert(1)</script>");
    await expect(processUpload(html)).rejects.toBeInstanceOf(UploadError);
  });

  it("strips HTML hidden after real image data", async () => {
    const polyglot = Buffer.concat([await png(), Buffer.from("<script>alert(document.cookie)</script>")]);
    const out = await processUpload(polyglot);
    expect(out.body.includes(Buffer.from("<script>"))).toBe(false);
    expect(out.ext).toBe("jpg");
  });
});

describe("names", () => {
  it("never uses the uploader's name or extension in the key", () => {
    const key = storageKey("w1", "jpg", new Date("2026-11-04T00:00:00Z"));
    expect(key).toMatch(/^ws\/w1\/2026\/11\/[0-9a-f-]{36}\.jpg$/);
  });
  it("cleans display names", () => {
    expect(cleanFilename("../../evil<script>.html")).toBe("evil_script_.html");
  });
});
