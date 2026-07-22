import { createHmac, timingSafeEqual } from "node:crypto";

const JWT_SECRET = process.env.JWT_SECRET ?? "dev-secret-change-me";

export function makeSpiToken(studentId: string): string {
  return createHmac("sha256", JWT_SECRET)
    .update("spi:" + studentId)
    .digest("base64url");
}

export function verifySpiToken(studentId: string, token: string): boolean {
  const expected = makeSpiToken(studentId);
  try {
    const a = Buffer.from(expected);
    const b = Buffer.from(token);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function spiSharePath(studentId: string): string {
  return `/spi/${studentId}?t=${makeSpiToken(studentId)}`;
}
