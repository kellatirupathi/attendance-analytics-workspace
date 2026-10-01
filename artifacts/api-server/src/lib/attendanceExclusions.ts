import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Course categories and subjects left out of course-wise attendance.
 *
 * Read from config, never hardcoded in queries:
 *   1. ATTENDANCE_EXCLUSIONS env var (JSON, e.g. a Replit Secret), else
 *   2. ATTENDANCE_EXCLUSIONS_PATH, else config/attendance-exclusions.json
 *      (looked up from the API server folder and from the repo root).
 * The file is re-read when it changes, so an edit applies without a restart.
 * Matching is case-insensitive: values are trimmed and upper-cased here and
 * compared against UPPER(TRIM(...)) in SQL.
 */
export interface AttendanceExclusions {
  excludedCategories: string[];
  excludedSubjects: string[];
  /** Changes whenever the lists change; part of cache keys. */
  version: string;
}

const FILE_NAME = "attendance-exclusions.json";

function candidatePaths(): string[] {
  const fromEnv = process.env["ATTENDANCE_EXCLUSIONS_PATH"]?.trim();
  if (fromEnv) return [path.resolve(fromEnv)];
  return [
    path.resolve(process.cwd(), "config", FILE_NAME),
    path.resolve(process.cwd(), "artifacts", "api-server", "config", FILE_NAME),
  ];
}

function normalize(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const out = new Set<string>();
  for (const item of list) {
    if (typeof item !== "string") continue;
    const value = item.trim().toUpperCase();
    if (value) out.add(value);
  }
  return [...out].sort();
}

function parse(raw: string, source: string): AttendanceExclusions {
  const json = JSON.parse(raw) as { excludedCategories?: unknown; excludedSubjects?: unknown };
  const excludedCategories = normalize(json.excludedCategories);
  const excludedSubjects = normalize(json.excludedSubjects);
  return {
    excludedCategories,
    excludedSubjects,
    version: `${source}:${excludedCategories.join("|")}#${excludedSubjects.join("|")}`,
  };
}

const EMPTY: AttendanceExclusions = { excludedCategories: [], excludedSubjects: [], version: "none" };

let cached: { key: string; value: AttendanceExclusions } | null = null;

export function getAttendanceExclusions(): AttendanceExclusions {
  const fromEnv = process.env["ATTENDANCE_EXCLUSIONS"]?.trim();
  if (fromEnv) {
    if (cached?.key === `env:${fromEnv}`) return cached.value;
    try {
      const value = parse(fromEnv, "env");
      cached = { key: `env:${fromEnv}`, value };
      return value;
    } catch (err) {
      console.error("[attendanceExclusions] ATTENDANCE_EXCLUSIONS is not valid JSON; using the file instead", err);
    }
  }
  const file = candidatePaths().find((candidate) => existsSync(candidate));
  if (!file) {
    console.warn(`[attendanceExclusions] ${FILE_NAME} not found; no categories or subjects are excluded`);
    return EMPTY;
  }
  try {
    const key = `${file}:${statSync(file).mtimeMs}`;
    if (cached?.key === key) return cached.value;
    const value = parse(readFileSync(file, "utf8"), "file");
    cached = { key, value };
    return value;
  } catch (err) {
    console.error(`[attendanceExclusions] could not read ${file}; keeping the last good config`, err);
    return cached?.value ?? EMPTY;
  }
}
