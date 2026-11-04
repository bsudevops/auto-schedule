import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { detectKind, incomingKey, isIncomingKey, UploadError } from "./media/pipeline";

vi.mock("server-only", () => ({}));

const WS = "0b9f6a52-3c0e-4f43-9d3e-5d8f6f8a1c11";

describe("direct upload keys", () => {
  it("only accepts keys the server made for this workspace", () => {
    expect(isIncomingKey(WS, incomingKey(WS))).toBe(true);
    expect(isIncomingKey(WS, incomingKey("11111111-1111-4111-8111-111111111111"))).toBe(false);
    expect(isIncomingKey(WS, `incoming/${WS}/../../other`)).toBe(false);
    expect(isIncomingKey(WS, `ws/${WS}/2026/11/abc.jpg`)).toBe(false);
  });
  it("tells images and videos from their first bytes and refuses anything else", async () => {
    const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489", "hex");
    expect((await detectKind(png)).kind).toBe("image");
    const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypmp42"), Buffer.alloc(16)]);
    expect(await detectKind(mp4)).toMatchObject({ kind: "video", videoExt: "mp4" });
    await expect(detectKind(Buffer.from("<script>alert(1)</script>"))).rejects.toBeInstanceOf(UploadError);
  });
});

describe("direct upload link", () => {
  it("is limited to this object, its size and its type, and expires", async () => {
    vi.stubEnv("STORAGE_BACKEND", "s3");
    vi.stubEnv("S3_ENDPOINT_URL", "https://acct.r2.cloudflarestorage.com");
    vi.stubEnv("S3_BUCKET_NAME", "media");
    vi.stubEnv("S3_ACCESS_KEY_ID", "AKIDEXAMPLE");
    vi.stubEnv("S3_SECRET_ACCESS_KEY", "secret");
    const { directStorage } = await import("./media/storage");
    const url = new URL(await directStorage()!.presignPut(`incoming/${WS}/x`, 1234, "application/octet-stream"));
    expect(url.origin).toBe("https://acct.r2.cloudflarestorage.com");
    expect(url.pathname).toBe(`/media/incoming/${WS}/x`);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("900");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toContain("content-length");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toContain("content-type");
    // A checksum in the link would be the checksum of an empty file, so the real upload would fail.
    expect([...url.searchParams.keys()].filter((k) => k.toLowerCase().includes("checksum"))).toEqual([]);
  });
  it("is off without S3 storage", async () => {
    vi.stubEnv("STORAGE_BACKEND", "local");
    const { directStorage } = await import("./media/storage");
    expect(directStorage()).toBeNull();
  });
});

describe("cron routes", () => {
  let GET: (req: Request, ctx: { params: Promise<{ job: string }> }) => Promise<Response>;
  beforeAll(async () => {
    vi.stubEnv("DATABASE_URL", "postgres://u:p@127.0.0.1:1/none"); // never connected to in these tests
    ({ GET } = await import("../app/api/cron/[job]/route"));
  });
  afterEach(() => vi.unstubAllEnvs());
  const call = (job: string, auth?: string) => GET(new Request("http://x/api/cron/" + job, { headers: auth ? { authorization: auth } : {} }), { params: Promise.resolve({ job }) });

  it("stays off until CRON_SECRET is set", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await call("tick", "Bearer anything")).status).toBe(503);
  });
  it("refuses a missing or wrong secret", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret-value");
    expect((await call("tick")).status).toBe(401);
    expect((await call("tick", "Bearer s3cret-valuf")).status).toBe(401);
    expect((await call("tick", "Bearer short")).status).toBe(401);
  });
  it("knows only its own jobs", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret-value");
    expect((await call("nope", "Bearer s3cret-value")).status).toBe(404);
    expect((await call("constructor", "Bearer s3cret-value")).status).toBe(404);
  });
});
