/**
 * Admin view of the Skill Assessment course map (skill_assessment_course_map): which Skill Assessment course
 * (the assessment team's code, e.g. PROBABILITY_AND_STATISTICS) counts toward which course on the student report,
 * per college, batch and semester. The report sync adds new codes as "To confirm"; they stay off the report until an
 * admin picks the report course here. Pure functions; the database side is saCourseMapAdmin.ts.
 */

export const STATUS_MAPPED = "Mapped";
export const STATUS_TO_CONFIRM = "To confirm";

const plain = (s: string | null | undefined) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const groupKey = (college: string, batch: string, semester: string) => [college, batch, semester].map(plain).join("|");

export interface MapTableRow {
  college: string;
  batch: string;
  semester: string | null;
  saCourse: string;
  reportCourse: string | null;
  status: string | null;
  mainSaCount: number | null;
  students: number | null;
  lastSaDate: string | null;
}

/** A course on the saved student reports of one college, batch and semester. */
export interface ReportCourseRow {
  college: string;
  batch: string;
  semester: string;
  course: string;
  /** From the live reports (spi_report_cache); false = an ended semester's report (spi_report_history). */
  current: boolean;
}

export interface MappingRow {
  college: string;
  batch: string;
  semester: string;
  saCourse: string;
  reportCourse: string | null;
  status: string;
  mainSaCount: number;
  students: number;
  lastSaDate: string | null;
  /** The batch's live reports are this semester: a change shows on student reports after the next sync. */
  current: boolean;
  /** Courses on the saved reports of this college, batch and semester: the only choices allowed. */
  options: string[];
  /** Can be mapped here: status To confirm or Mapped. "No course name in SA table" rows need a data fix instead. */
  editable: boolean;
}

/** Report courses per college × batch × semester, sorted; whether any live report has that semester. */
export function reportCourseIndex(rows: ReportCourseRow[]): Map<string, { options: string[]; current: boolean }> {
  const byKey = new Map<string, { names: Map<string, string>; current: boolean }>();
  for (const r of rows) {
    const name = r.course?.trim();
    if (!name) continue;
    const key = groupKey(r.college, r.batch, r.semester);
    let entry = byKey.get(key);
    if (!entry) byKey.set(key, (entry = { names: new Map(), current: false }));
    if (r.current) entry.current = true;
    // One spelling per course (first seen; live reports are listed first).
    if (!entry.names.has(plain(name))) entry.names.set(plain(name), name);
  }
  const out = new Map<string, { options: string[]; current: boolean }>();
  for (const [key, e] of byKey) out.set(key, { options: [...e.names.values()].sort((a, b) => a.localeCompare(b)), current: e.current });
  return out;
}

export function isEditableStatus(status: string | null | undefined): boolean {
  const s = plain(status);
  return s === plain(STATUS_MAPPED) || s === plain(STATUS_TO_CONFIRM);
}

/**
 * The rows the admin page lists: rows with a semester only (rows without one are the old list the report never
 * uses), excluded colleges left out. To confirm on a live report first, then by college, batch, semester, course.
 */
export function buildMappingRows(map: MapTableRow[], reports: ReportCourseRow[], isExcluded: (college: string) => boolean): MappingRow[] {
  const index = reportCourseIndex(reports);
  const rows: MappingRow[] = [];
  for (const m of map) {
    const semester = m.semester?.trim();
    if (!semester || isExcluded(m.college)) continue;
    const found = index.get(groupKey(m.college, m.batch, semester));
    const status = m.status?.trim() || STATUS_TO_CONFIRM;
    rows.push({
      college: m.college,
      batch: m.batch,
      semester,
      saCourse: m.saCourse,
      reportCourse: m.reportCourse?.trim() || null,
      status,
      mainSaCount: Number(m.mainSaCount) || 0,
      students: Number(m.students) || 0,
      lastSaDate: m.lastSaDate,
      current: found?.current ?? false,
      options: found?.options ?? [],
      editable: isEditableStatus(status),
    });
  }
  const rank = (r: MappingRow) => (needsAction(r) ? 0 : 1);
  return rows.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      a.college.localeCompare(b.college) ||
      a.batch.localeCompare(b.batch) ||
      a.semester.localeCompare(b.semester) ||
      a.saCourse.localeCompare(b.saCourse),
  );
}

/** Waiting for an admin and it matters now: To confirm, on a live report. */
export function needsAction(r: Pick<MappingRow, "status" | "current">): boolean {
  return r.current && plain(r.status) === plain(STATUS_TO_CONFIRM);
}

export function toConfirmCount(rows: MappingRow[]): number {
  return rows.filter(needsAction).length;
}

/** The report course as the reports spell it, or null when it is not one of the choices. */
export function pickReportCourse(options: string[], input: string | null | undefined): string | null {
  const want = plain(input);
  if (!want) return null;
  return options.find((o) => plain(o) === want) ?? null;
}

/** The PATCH body, checked: college, batch and SA course are required text; report course is text, null or absent (= clear). */
export function parseMappingInput(
  body: unknown,
): { ok: true; value: { college: string; batch: string; saCourse: string; reportCourse: string | null } } | { ok: false; error: string } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const college = text(b["college"]);
  const batch = text(b["batch"]);
  const saCourse = text(b["saCourse"]);
  if (!college || !batch || !saCourse) return { ok: false, error: "college, batch and saCourse are required" };
  const rc = b["reportCourse"];
  if (rc != null && typeof rc !== "string") return { ok: false, error: "reportCourse must be text or null" };
  return { ok: true, value: { college, batch, saCourse, reportCourse: rc == null ? null : rc } };
}

export type MappingChange =
  | { ok: true; reportCourse: string | null; status: string }
  | { ok: false; code: 400 | 404 | 409; error: string };

/**
 * What a save does to one row: a report course → Mapped; empty → back to To confirm.
 * Refused when the row is not editable or the course is not on that college, batch and semester's reports.
 */
export function planMappingChange(row: MappingRow | undefined, input: string | null | undefined): MappingChange {
  if (!row) return { ok: false, code: 404, error: "Mapping row not found" };
  if (!row.editable) return { ok: false, code: 409, error: `This row cannot be mapped here (status: ${row.status})` };
  if (input == null || !String(input).trim()) return { ok: true, reportCourse: null, status: STATUS_TO_CONFIRM };
  const course = pickReportCourse(row.options, input);
  if (!course) return { ok: false, code: 400, error: "That course is not on the student reports for this college, batch and semester" };
  return { ok: true, reportCourse: course, status: STATUS_MAPPED };
}
