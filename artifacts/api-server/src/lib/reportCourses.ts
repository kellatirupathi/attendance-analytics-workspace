import { pool } from "@workspace/db";
import { logger } from "./logger.js";
import { buildAllScorecards } from "./spiScorecard.js";
import { plainCourseName } from "./reportRemovedCourses.js";
import type { ReportCourses } from "./quizCoverageModel.js";

/**
 * The courses each student's report shows, so the Assessments quiz tab lists exactly those courses.
 * Read from the saved reports (spi_report_cache, rebuilt by the report sync). The report code is not
 * touched: the report decides its courses (removed courses and planned-only courses are already left
 * off), and this only reads the result. When the cache is empty or cannot be read, the same reports
 * are built in memory with buildAllScorecards(), the sync's own builder.
 */
export async function loadReportCourses(): Promise<ReportCourses | null> {
  try {
    const { rows } = await pool.query<{ student_id: string; college: string | null; courses: string[] | null }>(
      "SELECT student_id, college, jsonb_path_query_array(report, '$.courses[*].name') AS courses FROM spi_report_cache",
    );
    if (rows.length > 0) return collect(rows.map((r) => ({ studentKey: r.student_id, campus: r.college, courses: r.courses ?? [] })));
    logger.warn("spi_report_cache is empty; building the reports in memory for the Assessments course list");
  } catch (err) {
    logger.warn({ err }, "Reading spi_report_cache failed; building the reports in memory for the Assessments course list");
  }
  try {
    const built = await buildAllScorecards();
    return collect(built.map((b) => ({ studentKey: b.identity.studentKey, campus: b.identity.instituteName, courses: b.scorecard.courses.map((c) => c.name) })));
  } catch (err) {
    logger.error({ err }, "Could not load the report course list; the Assessments quiz tab will show every enrolled course");
    return null;
  }
}

function collect(reports: { studentKey: string; campus: string | null; courses: string[] }[]): ReportCourses {
  const byStudent = new Map<string, Set<string>>();
  const campusCourses = new Set<string>();
  for (const r of reports) {
    const names = new Set(r.courses.map(plainCourseName));
    byStudent.set(r.studentKey, names);
    if (r.campus) for (const name of names) campusCourses.add(`${r.campus.trim()}\t${name}`);
  }
  return { byStudent, campusCourses };
}
