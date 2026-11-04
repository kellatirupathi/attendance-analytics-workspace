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

/** A plain-words hint for the commonest R2 / SDK errors (the messages of these errors never contain the keys). */
function hintFor(name: string, message: string): string | null {
  if (/Cannot find (package|module)/i.test(message)) return "The S3 package is not installed on this server. Run `pnpm install` in the Replit Shell, then restart the workflows.";
  if (name === "InvalidAccessKeyId" || /access key/i.test(message)) return "The Access Key ID is not recognised. Check R2_ACCESS_KEY_ID (copy it again from the R2 API token page, no spaces).";
  if (name === "SignatureDoesNotMatch") return "The Secret Access Key does not match the Access Key ID. Check R2_SECRET_ACCESS_KEY (it is shown only once when the token is created; create a new token if unsure).";
  if (name === "AccessDenied" || /access denied|forbidden/i.test(message)) return "The token is not allowed to write to this bucket. Create the token with 'Object Read & Write' and include this bucket.";
  if (name === "NoSuchBucket") return "The bucket was not found. Check R2_BUCKET is exactly the bucket name, and that the token's account owns it.";
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(message)) return "The endpoint address could not be reached. Check R2_ENDPOINT is https://<account id>.r2.cloudflarestorage.com.";
  if (/ECONNREFUSED|ETIMEDOUT|fetch failed/i.test(message)) return "The server could not connect to Cloudflare. Check R2_ENDPOINT and the network.";
  return null;
}

export interface StorageCheck {
  ok: boolean;
  /** Names (never values) of the settings that are not set. */
  missing: string[];
  bucket: string | null;
  endpointHost: string | null;
  hints: string[];
  steps: { step: string; ok: boolean; error?: { name: string; message: string }; hint?: string | null }[];
}

/**
 * For Admin / Super Admin: writes, reads back and deletes a tiny test file in the bucket, step by step, and says in plain
 * words what is wrong. Shows setting names and the bucket / endpoint host, never a key.
 */
export async function checkStorage(): Promise<StorageCheck> {
  const names = ["R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"];
  const missing = names.filter((n) => !process.env[n]?.trim());
  const result: StorageCheck = { ok: false, missing, bucket: process.env["R2_BUCKET"] ?? null, endpointHost: null, hints: [], steps: [] };
  if (missing.length > 0) {
    result.hints.push(`These settings are not set: ${missing.join(", ")}. Add them in Tools > Secrets, then restart the workflows.`);
    return result;
  }
  const endpoint = process.env["R2_ENDPOINT"]!;
  try {
    const u = new URL(endpoint);
    result.endpointHost = u.host;
    if (u.pathname !== "/" && u.pathname !== "") result.hints.push("R2_ENDPOINT has a path in it. Use only https://<account id>.r2.cloudflarestorage.com (no bucket name, no trailing path).");
    if (!u.hostname.endsWith("r2.cloudflarestorage.com")) result.hints.push("R2_ENDPOINT should end with r2.cloudflarestorage.com.");
  } catch {
    result.hints.push("R2_ENDPOINT is not a valid web address. It should look like https://<account id>.r2.cloudflarestorage.com.");
    return result;
  }
  if (endpoint !== endpoint.trim() || process.env["R2_BUCKET"] !== process.env["R2_BUCKET"]!.trim()) result.hints.push("A setting has a space at the start or end. Re-enter it without spaces.");

  const storage = r2Storage();
  const key = `healthcheck/${Date.now()}.txt`;
  const run = async (step: string, fn: () => Promise<void>) => {
    try {
      await fn();
      result.steps.push({ step, ok: true });
      return true;
    } catch (err) {
      const e = err as { name?: string; message?: string };
      const name = e.name ?? "Error";
      const message = String(e.message ?? err).slice(0, 300);
      result.steps.push({ step, ok: false, error: { name, message }, hint: hintFor(name, message) });
      return false;
    }
  };
  if (await run("write a test file", () => storage.put(key, Buffer.from("ok"), "text/plain"))) {
    await run("read it back", async () => {
      const s = await storage.get(key);
      if (!s) throw new Error("The test file was not found after writing it.");
      s.destroy();
    });
    await run("delete it", () => storage.remove(key));
  }
  result.ok = result.steps.length === 3 && result.steps.every((s) => s.ok);
  return result;
}
