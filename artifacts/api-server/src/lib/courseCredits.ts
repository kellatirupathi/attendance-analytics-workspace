import { db, courseCreditsTable } from "@workspace/db";

/**
 * Course credits = course weights for the SPI (NIAT-SPI Execution Plan §3.3).
 *
 * Read from the course_credits table (PostgreSQL) only; the old config/course-credits.json is
 * no longer used. Ids are matched without hyphens, lower-cased. The table is re-read at most
 * once a minute, so an edit in the database reaches the report within a minute. A course whose
 * id is not in the table has no weight ("Not set"). If the database cannot be read, the last
 * good copy is kept; with none, every weight is "Not set".
 */
const RELOAD_MS = 60 * 1000;

export const courseIdKey = (id: string) => id.trim().toLowerCase().replace(/-/g, "");

export interface CourseCredits {
  credits: Map<string, number>;
  /** Changes whenever the table changes; part of cache keys. */
  version: string;
}

const EMPTY: CourseCredits = { credits: new Map(), version: "none" };
let cached: { loadedAt: number; value: CourseCredits } | null = null;
let loading: Promise<CourseCredits> | null = null;

async function loadFromDb(): Promise<CourseCredits> {
  const rows = await db
    .select({ id: courseCreditsTable.semesterCourseId, credits: courseCreditsTable.credits, updatedAt: courseCreditsTable.updatedAt })
    .from(courseCreditsTable);
  const credits = new Map<string, number>();
  let latest = 0;
  let total = 0;
  for (const row of rows) {
    if (!Number.isFinite(row.credits) || row.credits < 0) continue;
    credits.set(courseIdKey(row.id), row.credits);
    total += row.credits;
    latest = Math.max(latest, row.updatedAt?.getTime() ?? 0);
  }
  return { credits, version: `credits-db:${rows.length}:${total}:${latest}` };
}

export async function getCourseCredits(): Promise<CourseCredits> {
  if (cached && Date.now() - cached.loadedAt < RELOAD_MS) return cached.value;
  loading ??= loadFromDb()
    .then((value) => {
      cached = { loadedAt: Date.now(), value };
      return value;
    })
    .catch((err) => {
      console.error("[courseCredits] could not read course_credits; keeping the last good copy", err);
      // Try again on the next request rather than waiting a full minute.
      return cached?.value ?? EMPTY;
    })
    .finally(() => {
      loading = null;
    });
  return loading;
}

/** The course's weight: the highest credits among its ids; null when none is in the table. */
export function courseWeight(credits: CourseCredits, courseIds: string[]): number | null {
  let weight: number | null = null;
  for (const id of courseIds) {
    const c = credits.credits.get(courseIdKey(id));
    if (c != null) weight = weight == null ? c : Math.max(weight, c);
  }
  return weight;
}
