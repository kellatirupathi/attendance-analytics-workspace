import type { Readable } from "node:stream";

/**
 * Where the query screenshots are kept: a private Cloudflare R2 bucket (S3-compatible). Postgres holds only
 * the details of each image (spi_query_attachments); the bytes live here.
 *
 * Settings (Replit Secrets; use separate Dev and Prod buckets): R2_ENDPOINT (https://<account id>.r2.cloudflarestorage.com),
 * R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET. Without them, screenshots are simply "not set up yet" and
 * the rest of the chat works. The S3 client is loaded on first use, so the app starts even before it is installed.
 */
export interface QueryStorage {
  put(key: string, body: Buffer, mime: string): Promise<void>;
  /** The stored image as a stream, or null when it is gone. */
  get(key: string): Promise<Readable | null>;
  remove(key: string): Promise<void>;
}

export class StorageNotConfigured extends Error {
  constructor() {
    super("Screenshots are not set up yet.");
  }
}

let override: QueryStorage | null = null;
let cached: QueryStorage | null = null;

/** For tests: use this storage instead of R2. */
export function setQueryStorageForTests(storage: QueryStorage | null): void {
  override = storage;
}

export function storageConfigured(): boolean {
  return override !== null || Boolean(process.env["R2_ENDPOINT"] && process.env["R2_ACCESS_KEY_ID"] && process.env["R2_SECRET_ACCESS_KEY"] && process.env["R2_BUCKET"]);
}

type S3Module = {
  S3Client: new (cfg: unknown) => { send(cmd: unknown): Promise<{ Body?: unknown }> };
  PutObjectCommand: new (input: unknown) => unknown;
  GetObjectCommand: new (input: unknown) => unknown;
  DeleteObjectCommand: new (input: unknown) => unknown;
};

function r2Storage(): QueryStorage {
  const bucket = process.env["R2_BUCKET"]!;
  let client: InstanceType<S3Module["S3Client"]> | null = null;
  let mod: S3Module | null = null;
  const load = async () => {
    if (!mod) {
      // A variable specifier keeps this a runtime import: the package may not be installed until the next deploy.
      const name = "@aws-sdk/client-s3";
      mod = (await import(name)) as S3Module;
      client = new mod.S3Client({
        region: "auto",
        endpoint: process.env["R2_ENDPOINT"],
        credentials: { accessKeyId: process.env["R2_ACCESS_KEY_ID"], secretAccessKey: process.env["R2_SECRET_ACCESS_KEY"] },
        // Newer AWS SDK versions add checksum headers by default, which R2 does not accept; only send them when required.
        requestChecksumCalculation: "WHEN_REQUIRED",
        responseChecksumValidation: "WHEN_REQUIRED",
      });
    }
    return { mod, client: client! };
  };
  return {
    async put(key, body, mime) {
      const { mod, client } = await load();
      await client.send(new mod.PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: mime }));
    },
    async get(key) {
      const { mod, client } = await load();
      try {
        const out = await client.send(new mod.GetObjectCommand({ Bucket: bucket, Key: key }));
        return (out.Body as Readable | undefined) ?? null;
      } catch (err) {
        if ((err as { name?: string }).name === "NoSuchKey") return null;
        throw err;
      }
    },
    async remove(key) {
      const { mod, client } = await load();
      await client.send(new mod.DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}

export function getQueryStorage(): QueryStorage {
  if (override) return override;
  if (!storageConfigured()) throw new StorageNotConfigured();
  cached ??= r2Storage();
  return cached;
}
