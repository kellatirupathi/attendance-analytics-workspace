import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Course credits = course weights for the SPI (NIAT-SPI Execution Plan §3.3).
 *
 * Read from config/course-credits.json ({ credits: { semester_course_id: credits } }), or
 * COURSE_CREDITS_PATH, looked up from the API server folder and from the repo root.
 * Ids are matched without hyphens, lower-cased. The file is re-read when it changes.
 * A course whose id is not in the file has no weight ("Not set").
 */
const FILE_NAME = "course-credits.json";

function candidatePaths(): string[] {
  const fromEnv = process.env["COURSE_CREDITS_PATH"]?.trim();
  if (fromEnv) return [path.resolve(fromEnv)];
  return [
    path.resolve(process.cwd(), "config", FILE_NAME),
    path.resolve(process.cwd(), "artifacts", "api-server", "config", FILE_NAME),
  ];
}

export const courseIdKey = (id: string) => id.trim().toLowerCase().replace(/-/g, "");

export interface CourseCredits {
  credits: Map<string, number>;
  /** Changes whenever the file changes; part of cache keys. */
  version: string;
}

const EMPTY: CourseCredits = { credits: new Map(), version: "none" };
let cached: { key: string; value: CourseCredits } | null = null;

export function getCourseCredits(): CourseCredits {
  const file = candidatePaths().find((candidate) => existsSync(candidate));
  if (!file) {
    console.warn(`[courseCredits] ${FILE_NAME} not found; every course weight is "Not set"`);
    return EMPTY;
  }
  try {
    const mtime = statSync(file).mtimeMs;
    const key = `${file}:${mtime}`;
    if (cached?.key === key) return cached.value;
    const json = JSON.parse(readFileSync(file, "utf8")) as { credits?: Record<string, unknown> };
    const credits = new Map<string, number>();
    for (const [id, value] of Object.entries(json.credits ?? {})) {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) credits.set(courseIdKey(id), n);
    }
    const value = { credits, version: `credits:${mtime}` };
    cached = { key, value };
    return value;
  } catch (err) {
    console.error(`[courseCredits] could not read ${file}; keeping the last good config`, err);
    return cached?.value ?? EMPTY;
  }
}

/** The course's weight: the highest credits among its ids; null when none is in the file. */
export function courseWeight(courseIds: string[]): number | null {
  const { credits } = getCourseCredits();
  let weight: number | null = null;
  for (const id of courseIds) {
    const c = credits.get(courseIdKey(id));
    if (c != null) weight = weight == null ? c : Math.max(weight, c);
  }
  return weight;
}
