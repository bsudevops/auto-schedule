import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const put = vi.fn();
vi.mock("@/lib/media/storage", () => ({ storage: () => ({ put, remove: vi.fn() }), publicUrl: (k: string) => `https://media.test/${k}` }));

const { storeWorkspaceLogo, workspaceLogoUrl, LogoError } = await import("./workspace-logo");

describe("workspace logo", () => {
  beforeEach(() => put.mockReset());

  it("stores a 256px square PNG under the workspace's logo folder", async () => {
    const wide = await sharp({ create: { width: 400, height: 200, channels: 3, background: "#D6336C" } }).jpeg().toBuffer();
    const key = await storeWorkspaceLogo("ws1", wide);
    expect(key).toMatch(/^logos\/ws1\/[0-9a-f-]+\.png$/);
    const [k, body, type] = put.mock.calls[0]!;
    expect(k).toBe(key);
    expect(type).toBe("image/png");
    const meta = await sharp(body as Buffer).metadata();
    expect([meta.width, meta.height, meta.format]).toEqual([256, 256, "png"]);
  });

  it("refuses files that aren't images", async () => {
    await expect(storeWorkspaceLogo("ws1", Buffer.from("<svg onload=alert(1)>"))).rejects.toBeInstanceOf(LogoError);
    expect(put).not.toHaveBeenCalled();
  });

  it("builds the public address, or null without a logo", () => {
    expect(workspaceLogoUrl("logos/ws1/a.png")).toBe("https://media.test/logos/ws1/a.png");
    expect(workspaceLogoUrl(null)).toBeNull();
  });
});
