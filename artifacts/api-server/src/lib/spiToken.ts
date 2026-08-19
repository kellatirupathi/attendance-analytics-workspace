import { createHmac, timingSafeEqual } from "node:crypto";

const JWT_SECRET = process.env.JWT_SECRET ?? "dev-secret-change-me";
/** SPI share links expire after 90 days. Legacy tokens without expiry remain valid. */
const SPI_TOKEN_TTL_SEC = 90 * 24 * 60 * 60;

function signPayload(payload: string): string {
  return createHmac("sha256", JWT_SECRET)
    .update(payload)
    .digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

export function makeSpiToken(studentId: string, expirySeconds = SPI_TOKEN_TTL_SEC): string {
  const exp = Math.floor(Date.now() / 1000) + expirySeconds;
  const sig = signPayload(`spi:${studentId}:${exp}`);
  return `${exp}.${sig}`;
}

export function makeCampusAccessToken(campus: string, expirySeconds = SPI_TOKEN_TTL_SEC): string {
  const exp = Math.floor(Date.now() / 1000) + expirySeconds;
  const sig = signPayload(`campus:${campus}:${exp}`);
  return `${exp}.${sig}`;
}

export function verifySpiToken(studentId: string, token: string): boolean {
  if (!token) return false;

  // New format: exp.signature
  if (token.includes(".")) {
    const dot = token.indexOf(".");
    const expStr = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const exp = Number(expStr);
    if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) {
      return false;
    }
    const expected = signPayload(`spi:${studentId}:${exp}`);
    return safeEqual(expected, sig);
  }

  // Legacy permanent token (backward compatible)
  const expected = signPayload(`spi:${studentId}`);
  return safeEqual(expected, token);
}

export function verifyCampusAccessToken(campus: string, token: string): boolean {
  if (!token) return false;

  if (token.includes(".")) {
    const dot = token.indexOf(".");
    const expStr = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const exp = Number(expStr);
    if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) {
      return false;
    }
    const expected = signPayload(`campus:${campus}:${exp}`);
    return safeEqual(expected, sig);
  }

  const expected = signPayload(`campus:${campus}`);
  return safeEqual(expected, token);
}

export function spiSharePath(studentId: string): string {
  return `/spi/${studentId}?t=${makeSpiToken(studentId)}`;
}
