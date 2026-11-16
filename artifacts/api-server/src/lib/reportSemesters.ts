/**
 * The Semester menu on the student report: the semesters a student has a saved report for (SPI-tracked only),
 * newest first, and which one the page shows. Pure functions, no imports, so they can be tested on their own.
 */

/** One semester in the report's Semester menu. */
export interface ReportSemester {
  semester: string;
  /** YYYY-MM-DD, or null when the report has none. */
  start: string | null;
  end: string | null;
  ended: boolean;
}

/** Newest first: by start date, then by title (Semester 10 after Semester 9). */
export function sortReportSemesters(list: ReportSemester[]): ReportSemester[] {
  return list.slice().sort((a, b) => (b.start ?? "").localeCompare(a.start ?? "") || b.semester.localeCompare(a.semester, undefined, { numeric: true }));
}

/** The `semester` link parameter: a trimmed title of at most 60 characters, or undefined. */
export function readSemesterParam(raw: unknown): string | undefined {
  const value = typeof raw === "string" ? raw.trim().slice(0, 60) : "";
  return value || undefined;
}

/** The semester title a report carries: `semester` on a saved report, `semesterTitle` on a live one. */
export function reportSemesterTitle(report: object): string {
  const r = report as { semester?: unknown; semesterTitle?: unknown };
  const title = typeof r.semester === "string" && r.semester.trim() ? r.semester : typeof r.semesterTitle === "string" ? r.semesterTitle : "";
  return title.trim();
}

/**
 * The menu for a report: the student's current report (`shown`, the default) and the saved semesters that have ended.
 * A saved semester that has not ended and is not the current one is left out: it is a stale copy (e.g. 2 Yenapoya
 * students once reported on the wrong semester, whose report was corrected). The current semester is added when it
 * is not saved yet (a report built live).
 */
export function reportSemesterMenu(savedAll: ReportSemester[], shown: object, shownEnded: boolean): ReportSemester[] {
  const title = reportSemesterTitle(shown);
  const saved = savedAll.filter((s) => s.ended || s.semester === title);
  if (!title) return sortReportSemesters(saved);
  if (saved.some((s) => s.semester === title)) return sortReportSemesters(saved);
  const r = shown as { semesterStart?: unknown; semesterEnd?: unknown };
  const day = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
  return sortReportSemesters([...saved, { semester: title, start: day(r.semesterStart), end: day(r.semesterEnd), ended: shownEnded }]);
}
