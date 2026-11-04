import { randomBytes } from "node:crypto";
import type { Response } from "express";
import { pool } from "@workspace/db";
import { logger } from "./logger.js";
import { ensureTables } from "./queryChat.js";
import { getQueryStorage, StorageNotConfigured, storageConfigured } from "./queryStorage.js";

/**
 * Screenshots on a query. A student uploads each image first (it is checked here and kept in R2), gets a random
 * token back, and sends the tokens with the message that attaches them. Images are only ever served through
 * the two routes that check who is asking (the student who owns the chat, or Admin / Super Admin).
 * Every image that was sent with a message is kept for good (the history of a query is not deleted); only an
 * upload that was never attached to a message is dropped, after a day.
 */
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
/** Uploaded but not yet attached to a message: a student cannot pile up more than this (a message takes up to 6). */
const MAX_WAITING = 20;

export type ImageMime = "image/png" | "image/jpeg" | "image/webp";

/** The real type of an image from its first bytes (the filename and the browser's claim are not trusted). */
export function detectImage(buf: Buffer): ImageMime | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 12 && buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

export { storageConfigured };

export type UploadResult = { ok: true; token: string } | { ok: false; status: 400 | 429 | 503; error: string };

/** The file name the student's device gave the image, made safe to store and show (no path, no control characters). */
export function cleanFileName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let name = raw;
  try {
    name = decodeURIComponent(raw);
  } catch {
    /* keep it as sent */
  }
  name = name.replace(/[\u0000-\u001f\u007f]/g, "").split(/[\\/]/).pop()!.trim().slice(0, 120);
  return name || null;
}

export async function saveUpload(studentKey: string, body: unknown, fileName?: unknown): Promise<UploadResult> {
  if (!storageConfigured()) return { ok: false, status: 503, error: new StorageNotConfigured().message };
  if (!Buffer.isBuffer(body) || body.length === 0) return { ok: false, status: 400, error: "Choose a PNG, JPG or WebP image." };
  if (body.length > MAX_IMAGE_BYTES) return { ok: false, status: 400, error: "That image is too large. Please choose one under 2 MB." };
  const mime = detectImage(body);
  if (!mime) return { ok: false, status: 400, error: "Only PNG, JPG or WebP images can be added." };

  await ensureTables();
  const { rows } = await pool.query<{ n: string }>("SELECT count(*) AS n FROM spi_query_attachments WHERE student_id = $1 AND query_id IS NULL AND created_at > now() - interval '1 day'", [studentKey]);
  if (Number(rows[0]?.n ?? 0) >= MAX_WAITING) return { ok: false, status: 429, error: "Too many screenshots waiting. Send your message first." };

  const token = randomBytes(16).toString("hex");
  const key = `queries/${studentKey}/${token}`;
  await getQueryStorage().put(key, body, mime);
  await pool.query("INSERT INTO spi_query_attachments (token, student_id, storage_key, mime, size, file_name) VALUES ($1, $2, $3, $4, $5, $6)", [token, studentKey, key, mime, body.length, cleanFileName(fileName)]);
  return { ok: true, token };
}

export interface AttachmentRow {
  studentId: string;
  key: string;
  mime: string;
}

/** An attached screenshot by its token (one still waiting to be attached is not shown). */
export async function findAttachment(token: string): Promise<AttachmentRow | null> {
  if (!/^[0-9a-f]{32}$/.test(token)) return null;
  await ensureTables();
  const { rows } = await pool.query<{ student_id: string; storage_key: string; mime: string }>("SELECT student_id, storage_key, mime FROM spi_query_attachments WHERE token = $1 AND query_id IS NOT NULL", [token]);
  const r = rows[0];
  return r ? { studentId: r.student_id, key: r.storage_key, mime: r.mime } : null;
}

/** Sends the image; the caller has already checked that this person may see it. */
export async function sendAttachment(res: Response, att: AttachmentRow): Promise<void> {
  const stream = await getQueryStorage().get(att.key);
  if (!stream) {
    res.status(404).json({ error: "Image not found" });
    return;
  }
  res.set({
    "Content-Type": att.mime,
    "Cache-Control": "private, max-age=3600",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Content-Disposition": "inline",
  });
  stream.pipe(res);
}

/** Runs the cleanup of abandoned uploads once a day. */
export function startAttachmentCleanup(): void {
  const run = () => void purgeAttachments().catch((err) => logger.error({ err }, "Query screenshot cleanup failed"));
  setTimeout(run, 60_000).unref();
  setInterval(run, 24 * 60 * 60 * 1000).unref();
}

/**
 * Deletes uploads that were never attached to a message (a student picked an image and left) after a day.
 * An image that was sent with a message is never deleted: the history of a query is kept.
 */
export async function purgeAttachments(): Promise<number> {
  if (!storageConfigured()) return 0;
  await ensureTables();
  const { rows } = await pool.query<{ id: number; storage_key: string }>(
    "SELECT id, storage_key FROM spi_query_attachments WHERE query_id IS NULL AND created_at < now() - interval '1 day' LIMIT 500",
  );
  const storage = getQueryStorage();
  let removed = 0;
  for (const r of rows) {
    try {
      await storage.remove(r.storage_key);
      await pool.query("DELETE FROM spi_query_attachments WHERE id = $1", [r.id]);
      removed++;
    } catch {
      /* try again on the next run */
    }
  }
  return removed;
}
