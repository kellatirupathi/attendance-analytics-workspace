import { pool } from "@workspace/db";
import { isExcludedInstitute } from "./excludedInstitutes.js";
import { createSnapshot } from "./snapshot.js";
import { savedReportEndedSql, savedReportTrackedSql } from "./reportEnded.js";
import type { PastPlace } from "./pastSemesterModel.js";

/**
 * Every ended saved report: one per student × semester (the last one saved), as a SQL source with the
 * spi_report_history columns, the semester title trimmed, and alias-free (wrap it as needed).
 * "Ended" is the report's own rule (reportEnded.ts: its semester end date is before today in India).
 */
export const PAST_REPORTS_SQL = `(
  SELECT DISTINCT ON (h.student_id, TRIM(h.semester))
    h.student_id, h.college, h.batch, TRIM(h.semester) AS semester, h.section, h.attendance_pct, h.spi, h.report, h.built_at
  FROM spi_report_history h
  WHERE NULLIF(TRIM(h.semester), '') IS NOT NULL AND ${savedReportEndedSql("h.report")} AND ${savedReportTrackedSql("h")}
  ORDER BY h.student_id, TRIM(h.semester), h.built_at DESC
)`;

/** The id of the last successful report sync; a new sync (or a semester ending) shows on the next check. */
async function lastSyncToken(): Promise<string | null> {
  const { rows } = await pool.query<{ t: string | null }>(
    "SELECT CONCAT(MAX(id)::text, ':', (now() AT TIME ZONE 'Asia/Kolkata')::date::text) AS t FROM spi_report_sync_runs WHERE status = 'success'",
  );
  return rows[0]?.t ?? null;
}

async function load(): Promise<PastPlace[]> {
  let rows: { student_id: string; college: string | null; batch: string | null; semester: string; section: string | null }[];
  try {
    rows = (await pool.query(`SELECT student_id, college, batch, semester, section FROM ${PAST_REPORTS_SQL} p`)).rows;
  } catch {
    // spi_report_history not created yet (fresh database): no ended semesters.
    return [];
  }
  const out: PastPlace[] = [];
  for (const r of rows) {
    const college = (r.college ?? "").trim();
    if (!college || isExcludedInstitute(college)) continue;
    out.push({
      studentKey: r.student_id.toLowerCase().replace(/-/g, ""),
      college,
      batch: (r.batch ?? "").trim() || "Unknown",
      semester: r.semester,
      section: (r.section ?? "").trim(),
    });
  }
  return out;
}

/** Students' places in ended semesters, refreshed after each report sync and when the day changes. */
export const pastPlacesSnapshot = createSnapshot<PastPlace[]>("past-semester-places", load, { token: lastSyncToken });
