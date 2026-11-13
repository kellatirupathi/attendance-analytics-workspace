import { pool } from "@workspace/db";
import { logger } from "./logger.js";
import { buildAllScorecards } from "./spiScorecard.js";
import { plainCourseName } from "./reportRemovedCourses.js";
import type { ReportCourses } from "./quizCoverageModel.js";

/**
 * What the student reports show, read from the saved reports (spi_report_cache, rebuilt by the report sync).
 * The Assessments tabs use it to list exactly the courses a student's report shows (quizzes) and the
 * Skill Assessment results the report shows (Skill Assessment tab). The report code is not touched: the
 * report decides its courses (removed courses and planned-only courses are already left off), and this only
 * reads the result. When the cache is empty or cannot be read, the same reports are built in memory with
 * buildAllScorecards(), the sync's own builder.
 */
export interface SavedReportCourse {
  name: string;
  /** The course's Skill Assessment part on the report; null when the report shows none. */
  skill: { avgPct: number; attempted: number; total: number } | null;
}

export interface SavedReport {
  /** Student id without hyphens, lower-cased. */
  studentKey: string;
  campus: string | null;
  section: string | null;
  batch: string | null;
  semester: string | null;
  /** The student's semester ended: their last report, from spi_report_history. */
  ended: boolean;
  name: string | null;
  courses: SavedReportCourse[];
}

export async function loadSavedReports(): Promise<SavedReport[] | null> {
  try {
    type Row = {
      student_id: string;
      college: string | null;
      section: string | null;
      batch: string | null;
      semester: string | null;
      ended: boolean;
      name: string | null;
      course: string;
      skill: { avgPct: number; attempted: number; total: number } | null;
    };
    const select = (source: string) =>
      `SELECT r.student_id, r.college, r.section, r.batch, r.semester, r.ended, r.report->>'studentName' AS name, c->>'name' AS course,
              CASE WHEN jsonb_typeof(c->'skillAssessment') = 'object' THEN c->'skillAssessment' END AS skill
       FROM ${source} r CROSS JOIN LATERAL jsonb_array_elements(r.report->'courses') c`;
    // The live cache plus students whose semester ended (their last report in spi_report_history), as on Overview.
    const withHistory = `(
      SELECT student_id, college, section, batch, semester, false AS ended, report FROM spi_report_cache
      UNION ALL
      (SELECT DISTINCT ON (h.student_id) h.student_id, h.college, h.section, h.batch, h.semester, true AS ended, h.report
       FROM spi_report_history h
       WHERE NOT EXISTS (SELECT 1 FROM spi_report_cache c WHERE c.student_id = h.student_id)
       ORDER BY h.student_id, h.built_at DESC))`;
    let rows: Row[];
    try {
      rows = (await pool.query<Row>(select(withHistory))).rows;
    } catch {
      // spi_report_history not created yet (fresh database): the live cache alone.
      rows = (await pool.query<Row>(select("(SELECT student_id, college, section, batch, semester, false AS ended, report FROM spi_report_cache)"))).rows;
    }
    if (rows.length > 0) {
      const byStudent = new Map<string, SavedReport>();
      for (const r of rows) {
        let report = byStudent.get(r.student_id);
        if (!report) byStudent.set(r.student_id, (report = { studentKey: r.student_id, campus: r.college, section: r.section, batch: r.batch, semester: r.semester, ended: !!r.ended, name: r.name, courses: [] }));
        report.courses.push({ name: r.course, skill: r.skill ? { avgPct: Number(r.skill.avgPct) || 0, attempted: Number(r.skill.attempted) || 0, total: Number(r.skill.total) || 0 } : null });
      }
      return [...byStudent.values()];
    }
    logger.warn("spi_report_cache is empty; building the reports in memory for the Assessments tabs");
  } catch (err) {
    logger.warn({ err }, "Reading spi_report_cache failed; building the reports in memory for the Assessments tabs");
  }
  try {
    const built = await buildAllScorecards();
    // The Assessments tabs are current-semester: leave out the ended-semester reports.
    return built.filter((b) => !b.ended).map((b) => ({
      studentKey: b.identity.studentKey,
      campus: b.identity.instituteName,
      section: null,
      batch: null,
      semester: null,
      ended: false,
      name: b.scorecard.studentName ?? null,
      courses: b.scorecard.courses.map((c) => ({ name: c.name, skill: c.skillAssessment ? { avgPct: c.skillAssessment.avgPct, attempted: c.skillAssessment.attempted, total: c.skillAssessment.total } : null })),
    }));
  } catch (err) {
    logger.error({ err }, "Could not load the saved reports; the Assessments tabs will show every enrolled course");
    return null;
  }
}

/** The courses each student's report shows, by plain lower-case name. */
export async function loadReportCourses(): Promise<ReportCourses | null> {
  const reports = await loadSavedReports();
  if (!reports) return null;
  const byStudent = new Map<string, Set<string>>();
  const campusCourses = new Set<string>();
  const display = new Map<string, string[]>();
  for (const r of reports) {
    const names = new Set(r.courses.map((c) => plainCourseName(c.name)));
    byStudent.set(r.studentKey, names);
    display.set(r.studentKey, r.courses.map((c) => c.name.trim()));
    if (r.campus) for (const name of names) campusCourses.add(`${r.campus.trim()}\t${name}`);
  }
  return { byStudent, campusCourses, names: display };
}
