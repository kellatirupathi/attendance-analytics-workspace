import assert from "node:assert/strict";
import { createServer, request, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { gunzipSync } from "node:zlib";
import express from "express";
import { sendLargeJson } from "./largeJsonResponse.js";

const payload = {
  students: [{
    studentId: "fixture-student",
    studentName: "UTF-8 fixture: é, 漢字, 🙂",
    records: "record ".repeat(5 * 1024 * 1024),
  }],
  classes: [{ sessions: 12 }],
  spiPaths: { "fixture-student": "/spi/fixture" },
};
const expectedJson = JSON.stringify(payload);
assert.ok(Buffer.byteLength(expectedJson) > 32 * 1024 * 1024);

const app = express();
app.get("/large", async (req, res) => {
  await sendLargeJson(req, res, payload);
});
app.get("/small", async (req, res) => {
  await sendLargeJson(req, res, { ok: true });
});
const server = createServer(app);
let port: number;

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});
after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});

function readResponse(path: string, acceptEncoding?: string): Promise<{
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
}> {
  return new Promise((resolve, reject) => {
    const req = request({
      host: "127.0.0.1",
      port,
      path,
      headers: acceptEncoding === undefined ? {} : { "Accept-Encoding": acceptEncoding },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => resolve({
        status: res.statusCode!,
        headers: res.headers,
        body: Buffer.concat(chunks),
      }));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.end();
  });
}

test("a response over 32 MiB is gzip-streamed and preserves every JSON field", async () => {
  const result = await readResponse("/large", "gzip, deflate, br");
  assert.equal(result.status, 200);
  assert.equal(result.headers["content-encoding"], "gzip");
  assert.match(String(result.headers["content-type"]), /^application\/json; charset=utf-8$/);
  assert.match(String(result.headers.vary), /Accept-Encoding/i);
  assert.equal(result.headers["content-length"], undefined);
  assert.equal(result.headers["transfer-encoding"], "chunked");
  assert.ok(result.body.length < 32 * 1024 * 1024);
  assert.equal(gunzipSync(result.body).toString("utf8"), expectedJson);
});

test("clients refusing gzip still receive the full payload as a chunked stream", async () => {
  const result = await readResponse("/large", "gzip;q=0, identity;q=1");
  assert.equal(result.status, 200);
  assert.equal(result.headers["content-encoding"], undefined);
  assert.equal(result.headers["content-length"], undefined);
  assert.equal(result.headers["transfer-encoding"], "chunked");
  assert.equal(result.body.toString("utf8"), expectedJson);
});

test("missing Accept-Encoding is served without gzip", async () => {
  const result = await readResponse("/small");
  assert.equal(result.status, 200);
  assert.equal(result.headers["content-encoding"], undefined);
  assert.deepEqual(JSON.parse(result.body.toString("utf8")), { ok: true });
});

test("negotiation respects encoding quality preferences", async () => {
  const result = await readResponse("/small", "gzip;q=0.1, identity;q=1");
  assert.equal(result.status, 200);
  assert.equal(result.headers["content-encoding"], undefined);
  assert.deepEqual(JSON.parse(result.body.toString("utf8")), { ok: true });
});

test("explicitly refusing all supported encodings returns 406", async () => {
  const result = await readResponse("/small", "gzip;q=0, identity;q=0, *;q=0");
  assert.equal(result.status, 406);
  assert.deepEqual(JSON.parse(result.body.toString("utf8")), {
    error: "No acceptable response encoding",
  });
});
