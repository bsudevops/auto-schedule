import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Where uploaded files live. Files are always served from MEDIA_PUBLIC_URL, a different origin
 * from the app, so an uploaded file can never run scripts on the app's own domain.
 */
export interface Storage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export const mediaPublicUrl = () => (process.env.MEDIA_PUBLIC_URL || "http://localhost:3001").replace(/\/$/, "");
export const publicUrl = (key: string) => `${mediaPublicUrl()}/${key}`;

class LocalStorage implements Storage {
  constructor(private root: string) {}
  private file(key: string) {
    const p = path.resolve(this.root, key);
    if (!p.startsWith(path.resolve(this.root) + path.sep)) throw new Error("Invalid storage key");
    return p;
  }
  async put(key: string, body: Buffer) {
    const p = this.file(key);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, body);
  }
  async remove(key: string) {
    await rm(this.file(key), { force: true });
  }
}

class S3Storage implements Storage {
  private client = new S3Client({
    region: process.env.S3_REGION ?? "auto",
    endpoint: process.env.S3_ENDPOINT_URL || undefined,
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "", secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "" },
  });
  private bucket = process.env.S3_BUCKET_NAME ?? "";
  async put(key: string, body: Buffer, contentType: string) {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType, CacheControl: "public, max-age=31536000, immutable" }));
  }
  async remove(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

let instance: Storage | undefined;
export function storage(): Storage {
  instance ??= process.env.STORAGE_BACKEND === "s3" ? new S3Storage() : new LocalStorage(process.env.STORAGE_DIR ?? "./storage");
  return instance;
}
