import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
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

/** What direct-to-bucket uploads need. Only S3-compatible storage has it: the browser sends the file to the bucket, not through the app. */
export interface DirectStorage {
  presignPut(key: string, size: number, contentType: string): Promise<string>;
  /** The object's size in bytes, or null if it isn't there. */
  size(key: string): Promise<number | null>;
  read(key: string, bytes?: number): Promise<Buffer>;
  copy(from: string, to: string, contentType: string): Promise<void>;
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

class S3Storage implements Storage, DirectStorage {
  private client = new S3Client({
    region: process.env.S3_REGION ?? "auto",
    endpoint: process.env.S3_ENDPOINT_URL || undefined,
    // With a custom endpoint (R2, Supabase, MinIO) the bucket is part of the path, so uploads go to one known host.
    forcePathStyle: Boolean(process.env.S3_ENDPOINT_URL),
    // The SDK's default would put a checksum of an empty body into upload links, and the real upload would then be refused.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "", secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "" },
  });
  private bucket = process.env.S3_BUCKET_NAME ?? "";
  async put(key: string, body: Buffer, contentType: string) {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType, CacheControl: "public, max-age=31536000, immutable" }));
  }
  async remove(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
  /** A link that lets the browser upload exactly this object (this size and type) for 15 minutes. */
  presignPut(key: string, size: number, contentType: string) {
    return getSignedUrl(this.client, new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentLength: size, ContentType: contentType }), {
      expiresIn: 900,
      signableHeaders: new Set(["content-length", "content-type"]),
    });
  }
  async size(key: string) {
    try {
      const r = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return r.ContentLength ?? null;
    } catch (e) {
      const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status === 404 || (e as Error).name === "NotFound") return null;
      throw e;
    }
  }
  async read(key: string, bytes?: number) {
    const r = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: bytes ? `bytes=0-${bytes - 1}` : undefined }));
    return Buffer.from(await r.Body!.transformToByteArray());
  }
  async copy(from: string, to: string, contentType: string) {
    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.bucket,
        Key: to,
        CopySource: `${this.bucket}/${from.split("/").map(encodeURIComponent).join("/")}`,
        ContentType: contentType,
        MetadataDirective: "REPLACE",
        CacheControl: "public, max-age=31536000, immutable",
      }),
    );
  }
}

let instance: Storage | undefined;
export function storage(): Storage {
  instance ??= process.env.STORAGE_BACKEND === "s3" ? new S3Storage() : new LocalStorage(process.env.STORAGE_DIR ?? "./storage");
  return instance;
}

/** Present when the browser can upload straight to the bucket (STORAGE_BACKEND=s3). */
export function directStorage(): DirectStorage | null {
  return process.env.STORAGE_BACKEND === "s3" ? (storage() as unknown as DirectStorage) : null;
}
