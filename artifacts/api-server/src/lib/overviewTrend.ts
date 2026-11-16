/**
 * Day-level attendance rows for the Overview trend: one BigQuery read, held in memory and refreshed in the background
 * (snapshot.ts), so the chart answers any filter or period at once. Same students and sessions as Student Attendance
 * Stats: the report roster, each batch's latest semester, sessions up to today, the report's removed courses left out.
 * Ended semesters picked in the Semester filter come as `past` rows: that semester's sessions of the students with an
 * ended saved report of it (pastSemesters.ts).
 */
import { bqQuery, BQ_HEAVY_QUERY_TIMEOUT_MS, BQ_LOCATION } from "./bigquery.js";
import { ATTENDED_SQL, SCHEDULED_SQL } from "./attendance-contract.js";
import { excludeInstituteSql, isExcludedInstitute } from "./excludedInstitutes.js";
import { attendanceSource, latestSemesterSql, REPORT_ROSTER_SQL } from "./queries.js";
import { getRemovedCourses, plainCourseName, removedCoursesIn } from "./reportRemovedCourses.js";
import { createSnapshot } from "./snapshot.js";
import { shortSection } from "./directoryReportModel.js";
import { pastPlacesSnapshot } from "./pastSemesters.js";
import { pastSemesterSql } from "./pastSemesterSql.js";
import { loadUntrackedReports } from "./untrackedReports.js";
import type { TrendRow } from "./overviewTrendModel.js";

type Raw = { d: string; college: string; batch: string; section: string | null; semester: string; subject: string | null; ended: boolean | string; present: string; scheduled: string };

const trendSql = (where: string) => `SELECT
    CAST(DATE(date) AS STRING) AS d,
    TRIM(institute_name) AS college,
    COALESCE(NULLIF(TRIM(batch_name), ''), 'Unknown') AS batch,
    TRIM(batch_section_name) AS section,
    COALESCE(NULLIF(TRIM(CAST(semester_title AS STRING)), ''), 'Unknown') AS semester,
    TRIM(subject_title) AS subject,
    is_current_semester = 0 AS ended,
    COUNTIF(${ATTENDED_SQL}) AS present,
    COUNTIF(${SCHEDULED_SQL}) AS scheduled
  FROM ${attendanceSource()}
  WHERE ${excludeInstituteSql()} AND ${REPORT_ROSTER_SQL} AND ${where}
    AND student_user_id IS NOT NULL
    AND date IS NOT NULL
    AND DATE(date) <= CURRENT_DATE('Asia/Kolkata')
  GROUP BY d, college, batch, section, semester, subject, ended
  HAVING scheduled > 0`;

async function load(): Promise<TrendRow[]> {
  // Ended semesters SPI never tracked are left out of each student's latest semester (untrackedReports.ts).
  await loadUntrackedReports();
  const places = await pastPlacesSnapshot.get();
  const past = pastSemesterSql(places);
  const [rows, pastRows, removed] = await Promise.all([
    bqQuery<Raw>(trendSql(latestSemesterSql()), {}, BQ_LOCATION, BQ_HEAVY_QUERY_TIMEOUT_MS),
    past ? bqQuery<Raw>(trendSql(past.where), past.params, BQ_LOCATION, BQ_HEAVY_QUERY_TIMEOUT_MS) : Promise.resolve([] as Raw[]),
    getRemovedCourses(),
  ]);
  const out: TrendRow[] = [];
  const add = (r: Raw, isPast: boolean) => {
    if (!r.college || isExcludedInstitute(r.college)) return;
    // Courses the report leaves out (Campus Setup → removed courses) are left out here too.
    if (r.subject && removedCoursesIn(removed.value, r.college).has(plainCourseName(r.subject))) return;
    out.push({
      date: r.d,
      college: r.college,
      batch: r.batch,
      section: shortSection(r.section),
      semester: r.semester,
      subject: r.subject ?? "",
      ended: r.ended === true || r.ended === "true",
      ...(isPast ? { past: true } : {}),
      present: Number(r.present) || 0,
      scheduled: Number(r.scheduled) || 0,
    });
  };
  for (const r of rows) add(r, false);
  for (const r of pastRows) add(r, true);
  return out;
}

export const overviewTrendSnapshot = createSnapshot<TrendRow[]>("overview-attendance-trend", load);
