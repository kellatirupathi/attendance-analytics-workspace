import type { Request, Response } from "express";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";

const CHUNK_BYTES = 64 * 1024;

/**
 * Large attendance JSON must not be sent with a buffered Content-Length:
 * the deployment's HTTP/1 frontend limits non-streamed responses to 32 MiB.
 * Negotiate gzip when supported and stream even the identity fallback.
 * Buffer slices preserve UTF-8 characters and pipeline handles backpressure.
 */
export async function sendLargeJson(
  req: Request,
  res: Response,
  body: unknown,
): Promise<void> {
  res.vary("Accept-Encoding");
  const encoding = req.acceptsEncodings("gzip", "identity");
  if (!encoding) {
    res.status(406).json({ error: "No acceptable response encoding" });
    return;
  }

  const json = JSON.stringify(body);
  if (json === undefined) throw new TypeError("Response is not JSON serializable");
  const bytes = Buffer.from(json, "utf8");
  const source = Readable.from(
    (function* () {
      for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
        yield bytes.subarray(offset, offset + CHUNK_BYTES);
      }
    })(),
    { objectMode: false },
  );

  res.type("json");
  res.removeHeader("Content-Length");
  if (encoding === "gzip") {
    res.setHeader("Content-Encoding", "gzip");
    await pipeline(source, createGzip({ level: 4 }), res);
  } else {
    res.removeHeader("Content-Encoding");
    await pipeline(source, res);
  }
}
