import { afterEach, describe, expect, it } from "vitest";
import { appIdFrom, checkDriveFile, DriveError, driveConfig, isAccessToken, isDriveFileId } from "./drive";

describe("Google Drive config", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("takes the app ID from the client ID's project number", () => {
    expect(appIdFrom("123456789012-abc.apps.googleusercontent.com")).toBe("123456789012");
    expect(appIdFrom("not-a-client-id")).toBe("");
    expect(appIdFrom("123-abc.apps.googleusercontent.com", "999")).toBe("999");
  });

  it("is off until a client ID and an API key are set", () => {
    delete process.env.GOOGLE_DRIVE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_PUBLISH_CLIENT_ID;
    process.env.GOOGLE_DRIVE_API_KEY = "key";
    expect(driveConfig()).toBeNull();
    process.env.GOOGLE_PUBLISH_CLIENT_ID = "55-yt.apps.googleusercontent.com";
    expect(driveConfig()?.clientId).toBe("55-yt.apps.googleusercontent.com");
    process.env.GOOGLE_CLIENT_ID = "42-x.apps.googleusercontent.com";
    expect(driveConfig()).toEqual({ clientId: "42-x.apps.googleusercontent.com", apiKey: "key", appId: "42" });
    process.env.GOOGLE_DRIVE_CLIENT_ID = "7-y.apps.googleusercontent.com";
    expect(driveConfig()?.appId).toBe("7");
    delete process.env.GOOGLE_DRIVE_API_KEY;
    expect(driveConfig()).toBeNull();
  });
});

describe("Google Drive files", () => {
  it("accepts only Drive-shaped IDs and tokens", () => {
    expect(isDriveFileId("1AbC-dEf_GhIjKlMnOp")).toBe(true);
    expect(isDriveFileId("../../etc/passwd")).toBe(false);
    expect(isDriveFileId("abc?alt=media")).toBe(false);
    expect(isDriveFileId(42)).toBe(false);
    expect(isAccessToken("ya29.a0AfH6SMBxyz-123_abc")).toBe(true);
    expect(isAccessToken("short")).toBe(false);
    expect(isAccessToken("ya29.abcdefghijklmnopqrst\nX-Header: 1")).toBe(false);
  });

  it("takes photos and videos within the limits", () => {
    expect(checkDriveFile({ id: "x", name: "a.jpg", mimeType: "image/jpeg", size: "1000" }).kind).toBe("image");
    expect(checkDriveFile({ id: "x", name: "a.mp4", mimeType: "video/mp4", size: String(200 * 1024 * 1024) }).kind).toBe("video");
  });

  it("refuses Google Docs, folders, other files and oversized ones", () => {
    expect(() => checkDriveFile({ id: "x", name: "Plan", mimeType: "application/vnd.google-apps.document" })).toThrow(DriveError);
    expect(() => checkDriveFile({ id: "x", name: "Pics", mimeType: "application/vnd.google-apps.folder" })).toThrow(/folder/);
    expect(() => checkDriveFile({ id: "x", name: "a.pdf", mimeType: "application/pdf", size: "10" })).toThrow(/isn't a photo/);
    expect(() => checkDriveFile({ id: "x", name: "big.jpg", mimeType: "image/jpeg", size: String(21 * 1024 * 1024) })).toThrow(/20 MB/);
    expect(() => checkDriveFile({ id: "x", name: "big.mp4", mimeType: "video/mp4", size: String(301 * 1024 * 1024) })).toThrow(/300 MB/);
  });
});
