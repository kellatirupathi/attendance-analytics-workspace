import { pool } from "@workspace/db";
import { bqQuery, BQ_LOCATION } from "./bigquery.js";
import { ATTENDANCE_TABLE as RAW_ATTENDANCE_TABLE } from "./attendance-contract.js";
import { SKILL_ASSESSMENT_TABLE } from "./queries.js";
import { logger } from "./logger.js";

/**
 * Daily refresh of skill_assessment_course_map (run by the report sync, agreed 11 Nov 2026):
 * - For every college × batch × semester × Skill Assessment course in the Skill Assessment data, updates
 *   is_current_semester, main_sa_count, students, first_sa_date and last_sa_date on its row.
 * - A course with no row yet is added with status "To confirm" and no report course, so it stays off the
 *   report until someone maps it.
 * Mapping columns (report_course_name, status) and updated_at are never changed here, and no row is deleted.
 * Names match ignoring case and extra spaces, the same as the report.
 */
export interface SkillAssessmentCourseStat {
  college: string;
  batch: string;
  semester: string;
  saCourse: string;
  isCurrentSemester: number;
  mainSaCount: number;
  students: number;
  firstSaDate: string | null;
  lastSaDate: string | null;
}

/** Counts and dates per college × batch × semester × SA course, from BigQuery (read-only). */
export async function getSkillAssessmentCourseStats(): Promise<SkillAssessmentCourseStat[]> {
  const norm = (c: string) => `LOWER(REGEXP_REPLACE(TRIM(${c}), r'\\s+', ' '))`;
  const rows = await bqQuery<Record<string, string | null>>(
    `WITH current_semesters AS (
       SELECT DISTINCT ${norm("institute_name")} AS c, ${norm("batch_name")} AS b, ${norm("semester_title")} AS s
       FROM ${RAW_ATTENDANCE_TABLE}
       WHERE is_current_semester = 1 AND institute_name IS NOT NULL AND batch_name IS NOT NULL AND semester_title IS NOT NULL
     )
     SELECT
       TRIM(sa.institute_name) AS college,
       TRIM(sa.batch_name) AS batch,
       TRIM(sa.derived_semester_title) AS semester,
       TRIM(sa.semester_course_name) AS sa_course,
       COUNT(DISTINCT IF(UPPER(TRIM(IFNULL(sa.assessment_variant, ''))) = 'MAIN', sa.assessment_id, NULL)) AS main_sa_count,
       COUNT(DISTINCT sa.student_user_id) AS students,
       CAST(MIN(DATE(sa.assessment_open_at)) AS STRING) AS first_sa_date,
       CAST(MAX(DATE(sa.assessment_open_at)) AS STRING) AS last_sa_date,
       CAST(LOGICAL_OR(cs.c IS NOT NULL) AS STRING) AS is_current
     FROM ${SKILL_ASSESSMENT_TABLE} sa
     LEFT JOIN current_semesters cs
       ON cs.c = ${norm("sa.institute_name")} AND cs.b = ${norm("sa.batch_name")} AND cs.s = ${norm("sa.derived_semester_title")}
     WHERE IFNULL(TRIM(sa.institute_name), '') != '' AND IFNULL(TRIM(sa.batch_name), '') != ''
       AND IFNULL(TRIM(sa.derived_semester_title), '') != '' AND IFNULL(TRIM(sa.semester_course_name), '') != ''
     GROUP BY college, batch, semester, sa_course`,
    {},
    BQ_LOCATION,
  );
  return rows.map((r) => ({
    college: r["college"] ?? "",
    batch: r["batch"] ?? "",
    semester: r["semester"] ?? "",
    saCourse: r["sa_course"] ?? "",
    isCurrentSemester: r["is_current"] === "true" ? 1 : 0,
    mainSaCount: Number(r["main_sa_count"]) || 0,
    students: Number(r["students"]) || 0,
    firstSaDate: r["first_sa_date"] ?? null,
    lastSaDate: r["last_sa_date"] ?? null,
  }));
}

const NORM = (c: string) => `lower(regexp_replace(trim(coalesce(${c}, '')), '\\s+', ' ', 'g'))`;
const SAME = (m: string, s: string) =>
  [
    `${NORM(`${m}.college`)} = ${NORM(`${s}.college`)}`,
    `${NORM(`${m}.batch`)} = ${NORM(`${s}.batch`)}`,
    `${NORM(`${m}.semester`)} = ${NORM(`${s}.semester`)}`,
    `${NORM(`${m}.skill_assessment_course_name`)} = ${NORM(`${s}.sa_course`)}`,
  ].join(" AND ");
const STATS_INPUT = `jsonb_to_recordset($1::jsonb) AS s(college text, batch text, semester text, sa_course text,
    is_current int, main_sa_count int, students int, first_sa_date date, last_sa_date date)`;

/** Writes the counts and dates, and adds new SA courses as "To confirm". Returns how many rows each step touched. */
export async function applySkillAssessmentCourseStats(stats: SkillAssessmentCourseStat[]): Promise<{ updated: number; added: string[] }> {
  if (stats.length === 0) return { updated: 0, added: [] };
  const input = JSON.stringify(
    stats.map((s) => ({
      college: s.college, batch: s.batch, semester: s.semester, sa_course: s.saCourse, is_current: s.isCurrentSemester,
      main_sa_count: s.mainSaCount, students: s.students, first_sa_date: s.firstSaDate, last_sa_date: s.lastSaDate,
    })),
  );
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const updated = await client.query(
      `UPDATE skill_assessment_course_map m SET is_current_semester = s.is_current, main_sa_count = s.main_sa_count,
         students = s.students, first_sa_date = s.first_sa_date, last_sa_date = s.last_sa_date
       FROM ${STATS_INPUT}
       WHERE ${SAME("m", "s")}`,
      [input],
    );
    // ON CONFLICT DO NOTHING: an older row (no semester) with the same college, batch and course keeps its key.
    const added = await client.query<{ college: string; batch: string; semester: string; skill_assessment_course_name: string }>(
      `INSERT INTO skill_assessment_course_map (college, batch, skill_assessment_course_name, report_course_name, status,
         semester, is_current_semester, main_sa_count, students, first_sa_date, last_sa_date)
       SELECT s.college, s.batch, s.sa_course, NULL, 'To confirm', s.semester, s.is_current, s.main_sa_count, s.students,
         s.first_sa_date, s.last_sa_date
       FROM ${STATS_INPUT}
       WHERE NOT EXISTS (SELECT 1 FROM skill_assessment_course_map m WHERE ${SAME("m", "s")})
       ON CONFLICT DO NOTHING
       RETURNING college, batch, semester, skill_assessment_course_name`,
      [input],
    );
    await client.query("COMMIT");
    return {
      updated: updated.rowCount ?? 0,
      added: added.rows.map((r) => `${r.college} | ${r.batch} | ${r.semester} | ${r.skill_assessment_course_name}`),
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** One refresh; a failure is logged and never stops the report sync. */
export async function refreshSkillAssessmentCourseMap(): Promise<void> {
  try {
    const result = await applySkillAssessmentCourseStats(await getSkillAssessmentCourseStats());
    logger.info({ updated: result.updated, added: result.added.length }, "Skill Assessment course map refreshed");
    if (result.added.length) logger.warn({ added: result.added }, "New Skill Assessment courses added as To confirm");
  } catch (err) {
    logger.error({ err }, "Skill Assessment course map refresh failed");
  }
}
