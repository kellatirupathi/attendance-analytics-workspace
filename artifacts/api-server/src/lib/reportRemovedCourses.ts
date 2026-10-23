import { db, reportRemovedCoursesTable } from "@workspace/db";
import { dbSnapshot, rowsVersion } from "./dbSnapshot.js";

/**
 * Subjects left off the student SPI report, from the report_removed_courses table
 * (campus "*" = every campus, course, reason, removed_on). Names match ignoring case and extra
 * spaces. Re-read at most once a minute.
 */
export const plainCourseName = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");

/** plain campus name ("*" for every campus) → plain course names */
export type RemovedCourses = Map<string, Set<string>>;

export const getRemovedCourses = dbSnapshot<RemovedCourses>(
  "reportRemovedCourses",
  async () => {
    const rows = await db.select().from(reportRemovedCoursesTable);
    const byCampus: RemovedCourses = new Map();
    for (const r of rows) {
      if (!r.course?.trim()) continue;
      const campus = r.campus?.trim() ? plainCourseName(r.campus) : "*";
      const set = byCampus.get(campus) ?? new Set<string>();
      set.add(plainCourseName(r.course));
      byCampus.set(campus, set);
    }
    return { value: byCampus, version: rowsVersion("removed", rows) };
  },
  { value: new Map(), version: "none" },
);

/** Plain names of the courses removed from the report for a student at this campus. */
export function removedCoursesIn(byCampus: RemovedCourses, campus: string | null | undefined): Set<string> {
  return new Set([...(byCampus.get("*") ?? []), ...(campus ? byCampus.get(plainCourseName(campus)) ?? [] : [])]);
}
