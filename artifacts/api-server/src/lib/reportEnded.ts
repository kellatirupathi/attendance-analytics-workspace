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
