import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Subjects left off the student SPI report, listed in config/report-removed-courses.json
 * (or REPORT_REMOVED_COURSES_PATH) so the list is easy to read and change:
 * { removedCourses: [{ campus: "*" | campus name, course, reason, removedOn }] }.
 * Names match ignoring case and extra spaces. The file is re-read when it changes.
 */
const FILE_NAME = "report-removed-courses.json";

function candidatePaths(): string[] {
  const fromEnv = process.env["REPORT_REMOVED_COURSES_PATH"]?.trim();
  if (fromEnv) return [path.resolve(fromEnv)];
  return [
    path.resolve(process.cwd(), "config", FILE_NAME),
    path.resolve(process.cwd(), "artifacts", "api-server", "config", FILE_NAME),
  ];
}

export const plainCourseName = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");

interface RemovedCourses {
  /** plain campus name ("*" for every campus) → plain course names */
  byCampus: Map<string, Set<string>>;
  /** Changes whenever the file changes; part of cache keys. */
  version: string;
}

const EMPTY: RemovedCourses = { byCampus: new Map(), version: "none" };
let cached: { key: string; value: RemovedCourses } | null = null;

function load(): RemovedCourses {
  const file = candidatePaths().find((candidate) => existsSync(candidate));
  if (!file) return EMPTY;
  try {
    const mtime = statSync(file).mtimeMs;
    const key = `${file}:${mtime}`;
    if (cached?.key === key) return cached.value;
    const json = JSON.parse(readFileSync(file, "utf8")) as { removedCourses?: { campus?: unknown; course?: unknown }[] };
    const byCampus = new Map<string, Set<string>>();
    for (const entry of json.removedCourses ?? []) {
      if (typeof entry.course !== "string" || !entry.course.trim()) continue;
      const campus = typeof entry.campus === "string" && entry.campus.trim() ? plainCourseName(entry.campus) : "*";
      const set = byCampus.get(campus) ?? new Set<string>();
      set.add(plainCourseName(entry.course));
      byCampus.set(campus, set);
    }
    const value = { byCampus, version: `removed:${mtime}` };
    cached = { key, value };
    return value;
  } catch (err) {
    console.error(`[reportRemovedCourses] could not read ${file}; keeping the last good list`, err);
    return cached?.value ?? EMPTY;
  }
}

/** Plain names of the courses removed from the report for a student at this campus. */
export function removedCoursesFor(campus: string | null | undefined): Set<string> {
  const { byCampus } = load();
  return new Set([...(byCampus.get("*") ?? []), ...(campus ? byCampus.get(plainCourseName(campus)) ?? [] : [])]);
}

export function reportRemovedCoursesVersion(): string {
  return load().version;
}
