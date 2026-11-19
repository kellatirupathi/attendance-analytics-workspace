import { pool } from "@workspace/db";
import { isExcludedInstitute } from "./excludedInstitutes.js";
import { logger } from "./logger.js";
import {
  buildMappingRows,
  planMappingChange,
  toConfirmCount,
  type MapTableRow,
  type MappingRow,
  type ReportCourseRow,
} from "./saCourseMapAdminModel.js";

/** The Skill Assessment course map for the admin page (saCourseMapAdminModel.ts), with the report courses to choose from. */

async function readMapTable(): Promise<MapTableRow[]> {
  const { rows } = await pool.query<MapTableRow>(
    `SELECT college, batch, semester, skill_assessment_course_name AS "saCourse", report_course_name AS "reportCourse", status,
            main_sa_count AS "mainSaCount", students, last_sa_date::text AS "lastSaDate"
     FROM skill_assessment_course_map`,
  );
  return rows;
}

/** Course names on the saved reports, per college × batch × semester: live reports, then ended semesters' last reports. */
async function readReportCourses(): Promise<ReportCourseRow[]> {
  const courses = (source: string, current: boolean) =>
    `SELECT r.college, r.batch, r.semester, co->>'name' AS course, ${current} AS current
     FROM ${source} r CROSS JOIN LATERAL jsonb_array_elements(r.report->'courses') co
     WHERE r.college IS NOT NULL AND r.batch IS NOT NULL AND r.semester IS NOT NULL
     GROUP BY 1, 2, 3, 4`;
  const live = (await pool.query<ReportCourseRow>(courses("spi_report_cache", true))).rows;
  try {
    return [...live, ...(await pool.query<ReportCourseRow>(courses("spi_report_history", false))).rows];
  } catch (err) {
    // No history table yet (fresh database): live reports only.
    logger.warn({ err }, "Reading spi_report_history for the SA course map failed");
    return live;
  }
}

export async function listSaCourseMap(): Promise<{ rows: MappingRow[]; toConfirm: number }> {
  const [map, reports] = await Promise.all([readMapTable(), readReportCourses()]);
  const rows = buildMappingRows(map, reports, isExcludedInstitute);
  return { rows, toConfirm: toConfirmCount(rows) };
}

/** Pending count only (live reports needed): the sidebar badge. */
export async function saCourseMapToConfirm(): Promise<number> {
  const map = (await readMapTable()).filter((m) => (m.status ?? "").trim().toLowerCase() === "to confirm" && m.semester?.trim());
  if (map.length === 0) return 0;
  // Which semesters are live is all the count needs, so one placeholder course per college × batch × semester.
  const live = (
    await pool.query<ReportCourseRow>(
      `SELECT DISTINCT college, batch, semester, '-' AS course, true AS current
       FROM spi_report_cache WHERE college IS NOT NULL AND batch IS NOT NULL AND semester IS NOT NULL`,
    )
  ).rows;
  return toConfirmCount(buildMappingRows(map, live, isExcludedInstitute));
}

const same = (a: string, b: string) => a.trim().toLowerCase().replace(/\s+/g, " ") === b.trim().toLowerCase().replace(/\s+/g, " ");

/** Sets (or clears) the report course of one row, keyed by the table's primary key (college, batch, SA course). */
export async function setSaCourseMapping(input: {
  college: string;
  batch: string;
  saCourse: string;
  reportCourse: string | null;
}): Promise<{ ok: true; row: MappingRow } | { ok: false; code: 400 | 404 | 409; error: string }> {
  const { rows } = await listSaCourseMap();
  const row = rows.find((r) => same(r.college, input.college) && same(r.batch, input.batch) && same(r.saCourse, input.saCourse));
  const change = planMappingChange(row, input.reportCourse);
  if (!change.ok) return change;
  const updated = await pool.query(
    `UPDATE skill_assessment_course_map SET report_course_name = $4, status = $5, updated_at = now()
     WHERE college = $1 AND batch = $2 AND skill_assessment_course_name = $3`,
    [row!.college, row!.batch, row!.saCourse, change.reportCourse, change.status],
  );
  if ((updated.rowCount ?? 0) !== 1) return { ok: false, code: 404, error: "Mapping row not found" };
  return { ok: true, row: { ...row!, reportCourse: change.reportCourse, status: change.status } };
}
