/**
 * When a saved report counts as "semester ended". No imports, so it can be tested on its own.
 *
 * A student the latest report sync did not rebuild is shown from their last saved report (spi_report_history).
 * That alone does not mean the semester ended: a student moved to another section can drop out of the
 * attendance data for a while (e.g. 3 Batch-2 students on 14–15 Nov 2026, semester ending 23 Jan 2027).
 * So the saved report is "ended" only when its semester end date (report.semesterEnd, YYYY-MM-DD) is before
 * today in India; a report with no end date keeps the old meaning (ended).
 */

/** Today's date in India, YYYY-MM-DD. */
export function todayInIndia(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** True when the saved report's semester has ended (end date before today, or no end date). */
export function savedReportEnded(report: { semesterEnd?: unknown } | null | undefined, today = todayInIndia()): boolean {
  const end = typeof report?.semesterEnd === "string" ? report.semesterEnd.slice(0, 10) : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(end)) return true;
  return end < today;
}

/** The same rule in Postgres, for a saved report JSON column (e.g. "h.report"). */
export function savedReportEndedSql(reportColumn: string): string {
  return `(CASE WHEN COALESCE(${reportColumn}->>'semesterEnd', '') ~ '^\\d{4}-\\d{2}-\\d{2}'
    THEN LEFT(${reportColumn}->>'semesterEnd', 10)::date < (now() AT TIME ZONE 'Asia/Kolkata')::date
    ELSE true END)`;
}

/**
 * A saved report counts only when SPI tracked its semester while it ran: it was first saved on or before the
 * semester's end date (agreed 2026-11-16). A report first saved after its semester had already ended covers a
 * semester from before SPI (e.g. 4 NIAT Chevella students with no rows after their Year-1 "Semester 1" ended on
 * 31 Jul 2026, first saved 10 Nov 2026): it stays in spi_report_history but is shown nowhere.
 * `firstSaved`: the India date the report was first saved (YYYY-MM-DD). No end date: counted (old meaning).
 */
export function savedReportTracked(report: { semesterEnd?: unknown } | null | undefined, firstSaved: string): boolean {
  const end = typeof report?.semesterEnd === "string" ? report.semesterEnd.slice(0, 10) : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(end)) return true;
  return firstSaved.slice(0, 10) <= end;
}

/**
 * True when no other semester of the same student overlaps this saved report's dates and was first saved later: such
 * a report is a stale copy under the wrong title (2 Yenapoya students were reported on "Semester 3", 27 Jul – 4 Dec,
 * before their report was corrected to "Semester 1" with the same dates). Back-to-back semesters (CDU Semester 3
 * to 7 Nov, Semester 4 from 16 Nov) do not overlap, so both count. Dates are compared as YYYY-MM-DD text; a report
 * without dates is never treated as stale.
 */
export function savedReportLatestCopySql(alias: string): string {
  const start = (a: string) => `LEFT(${a}.report->>'semesterStart', 10)`;
  const end = (a: string) => `LEFT(${a}.report->>'semesterEnd', 10)`;
  return `NOT EXISTS (
    SELECT 1 FROM spi_report_history o
    WHERE o.student_id = ${alias}.student_id
      AND TRIM(o.semester) <> TRIM(${alias}.semester)
      AND o.first_built_at > ${alias}.first_built_at
      AND ${start("o")} <= ${end(alias)}
      AND ${end("o")} >= ${start(alias)})`;
}

/** The same rule in Postgres, for a spi_report_history alias (e.g. "h"). */
export function savedReportTrackedSql(alias: string): string {
  return `(CASE WHEN COALESCE(${alias}.report->>'semesterEnd', '') ~ '^\\d{4}-\\d{2}-\\d{2}'
    THEN (${alias}.first_built_at AT TIME ZONE 'Asia/Kolkata')::date <= LEFT(${alias}.report->>'semesterEnd', 10)::date
    ELSE true END)`;
}
