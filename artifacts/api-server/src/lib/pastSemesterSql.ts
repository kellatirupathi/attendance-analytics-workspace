/**
 * BigQuery rows of ended semesters for the Semester filter: the rows of a semester that has ended
 * (is_current_semester = 0, same semester title) of the students whose saved report of that semester ended,
 * at the same college. One parameter holds the "student key \t college \t semester" triples, so nothing from
 * a request is written into the SQL. No imports with side effects, so it can be tested on its own.
 */
import type { PastPlace } from "./pastSemesterModel.js";

export interface PastSemesterSqlOptions {
  /** One ended semester only; all ended semesters when missing. */
  semester?: string;
  /** The user's colleges (empty or missing: all). */
  scopeCampuses?: string[];
  /** Table alias, e.g. "q". */
  alias?: string;
  /** Column holding the student UUID: student_user_id (attendance view) or user_id (quiz table). */
  studentColumn?: string;
  /** Name of the query parameter. */
  param?: string;
}

export function pastPlaceKeys(places: PastPlace[], opts: Pick<PastSemesterSqlOptions, "semester" | "scopeCampuses"> = {}): string[] {
  const scope = opts.scopeCampuses?.length ? new Set(opts.scopeCampuses.map((c) => c.trim())) : null;
  const keys = new Set<string>();
  for (const p of places) {
    if (opts.semester && p.semester !== opts.semester) continue;
    if (scope && !scope.has(p.college)) continue;
    keys.add(`${p.studentKey}\t${p.college}\t${p.semester}`);
  }
  return [...keys].sort();
}

/** A WHERE condition and its parameter; null when there is no such ended report (nothing to read). */
export function pastSemesterSql(places: PastPlace[], opts: PastSemesterSqlOptions = {}): { where: string; params: Record<string, string[]> } | null {
  const keys = pastPlaceKeys(places, opts);
  if (!keys.length) return null;
  const col = (name: string) => (opts.alias ? `${opts.alias}.${name}` : name);
  const param = opts.param ?? "pastPlaces";
  const student = col(opts.studentColumn ?? "student_user_id");
  return {
    where: `SAFE_CAST(${col("is_current_semester")} AS INT64) = 0
      AND CONCAT(LOWER(REPLACE(CAST(${student} AS STRING), '-', '')), CHR(9), TRIM(CAST(${col("institute_name")} AS STRING)), CHR(9), TRIM(CAST(${col("semester_title")} AS STRING))) IN UNNEST(@${param})`,
    params: { [param]: keys },
  };
}
