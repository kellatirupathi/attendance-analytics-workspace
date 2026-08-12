import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { SessionPayload } from "./auth.js";

const TTL_MS = 60_000;
const cache = new Map<
  string,
  { tokenVersion: number; isActive: boolean; checkedAt: number }
>();

export async function isSessionStillValid(
  session: SessionPayload,
): Promise<boolean> {
  const now = Date.now();
  const hit = cache.get(session.sub);
  if (hit && now - hit.checkedAt < TTL_MS) {
    return hit.isActive && hit.tokenVersion === session.tokenVersion;
  }
  const rows = await db
    .select({
      tokenVersion: usersTable.tokenVersion,
      isActive: usersTable.isActive,
    })
    .from(usersTable)
    .where(eq(usersTable.id, session.sub))
    .limit(1);
  const user = rows[0];
  if (!user) return false;
  cache.set(session.sub, {
    tokenVersion: user.tokenVersion,
    isActive: user.isActive,
    checkedAt: now,
  });
  return user.isActive && user.tokenVersion === session.tokenVersion;
}

export function invalidateSessionCache(userId: string): void {
  cache.delete(userId);
}
