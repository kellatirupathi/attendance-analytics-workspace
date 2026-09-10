import {
  bqQuery,
  pct,
  PROD_SEQUENCE_TABLE,
  validateStudentId,
  normalizeStudentId,
} from "./bigquery.js";
import {
  db,
  recoveryProgressTable,
  recoverySessionsTable,
  recoveryTopicsTable,
  sessionTopicsTable,
} from "@workspace/db";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import type { SessionScope } from "./rbac.js";

/**
 * Matches a student id column against @studentId regardless of UUID hyphens.
 * The warehouse is inconsistent: the attendance table stores hyphenated
 * UUIDs while the quiz table stores bare hex, and SPI links can carry either.
 */
function studentIdMatch(column: string): string {
  return `LOWER(REPLACE(CAST(${column} AS STRING), '-', '')) = @studentId`;
}

const ATTENDANCE_TABLE =
  "`kossip-helpers.niat_post_onboarding_engagement_ai_analytics_workspace.z_niat_student_session_wise_attendance_details`";
const QUIZ_TABLE =
  "`kossip-helpers.niat_post_onboarding_engagement_ai_analytics_workspace.z_niat_students_classroom_and_module_quiz_details`";

function scopeClause(
  scope: SessionScope,
  params: Record<string, unknown>,
  options: { semester?: string; currentSemester?: boolean } = {},
): string {
  const clauses: string[] = [];
  if (options.semester) {
    clauses.push("derived_semester_title = @semester");
    params["semester"] = options.semester;
  } else if (options.currentSemester !== false) {
    clauses.push("is_current_semester = 1");
  }
  if (scope.campuses && scope.campuses.length > 0) {
    clauses.push("institute_name IN UNNEST(@campuses)");
    params["campuses"] = scope.campuses;
  }
  if (scope.subjects && scope.subjects.length > 0) {
    clauses.push("subject_title IN UNNEST(@subjects)");
    params["subjects"] = scope.subjects;
  }
  return clauses.length > 0 ? clauses.join(" AND ") : "TRUE";
}

export async function getRecoverySemesters(
  campus: string,
  scope: SessionScope,
): Promise<string[]> {
  const params: Record<string, unknown> = { campus };
  const where = scopeClause(scope, params, { currentSemester: false });
  const rows = await bqQuery<{ semester: string }>(
    `SELECT DISTINCT TRIM(derived_semester_title) AS semester
     FROM ${ATTENDANCE_TABLE}
     WHERE ${where}
       AND institute_name = @campus
       AND derived_semester_title IS NOT NULL
       AND TRIM(derived_semester_title) != ''
     ORDER BY semester`,
    params,
  );

  return rows
    .map((row) => row.semester)
    .sort((left, right) =>
      right.localeCompare(left, undefined, { numeric: true, sensitivity: "base" }),
    );
}

export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface DateRangeFilter {
  from?: string;
  to?: string;
}

/** Parse `dateFrom` / `dateTo` query params. Invalid values are dropped. */
export function parseDateRange(
  q: Record<string, string | undefined>,
): DateRangeFilter | undefined {
  let from = q["dateFrom"]?.trim() || undefined;
  let to = q["dateTo"]?.trim() || undefined;
  if (from && !ISO_DATE_RE.test(from)) from = undefined;
  if (to && !ISO_DATE_RE.test(to)) to = undefined;
  if (from && to && from > to) {
    const swap = from;
    from = to;
    to = swap;
  }
  if (!from && !to) return undefined;
  return { from, to };
}

export function dateRangeCacheKey(
  range: DateRangeFilter | undefined,
): string {
  if (!range) return "";
  return `${range.from ?? ""}:${range.to ?? ""}`;
}

function dateRangeClause(
  range: DateRangeFilter | undefined,
  params: Record<string, unknown>,
): string {
  if (!range) return "";
  const parts: string[] = [];
  if (range.from) {
    params["dateFrom"] = range.from;
    parts.push("DATE(date) >= DATE(@dateFrom)");
  }
  if (range.to) {
    params["dateTo"] = range.to;
    parts.push("DATE(date) <= DATE(@dateTo)");
  }
  return parts.length > 0 ? ` AND ${parts.join(" AND ")}` : "";
}

export interface StudentOverview {
  studentId: string;
  studentName: string;
  instituteName: string | null;
  sectionName: string | null;
  totalSessions: number;
  presentCount: number;
  absentCount: number;
  attendancePct: number;
  inRecovery: boolean;
  coursesInRecovery: number;
}

export async function getStudentOverview(
  studentId: string,
): Promise<StudentOverview | null> {
  if (!validateStudentId.test(studentId)) return null;
  const rows = await bqQuery<{
    student_user_id: string;
    student_name: string;
    institute_name: string;
    batch_section_name: string;
    total_sessions: string;
    present_count: string;
    subjects_in_recovery: string;
  }>(
    `SELECT
      student_user_id,
      MAX(student_name) AS student_name,
      MAX(institute_name) AS institute_name,
      MAX(batch_section_name) AS batch_section_name,
      COUNT(*) AS total_sessions,
      COUNTIF(LOWER(attendance_status) = 'present') AS present_count,
      COUNTIF(subject_pct < 80) AS subjects_in_recovery
    FROM (
      SELECT
        student_user_id,
        student_name,
        institute_name,
        batch_section_name,
        attendance_status,
        subject_title,
        SAFE_DIVIDE(
          COUNTIF(LOWER(attendance_status) = 'present') OVER (PARTITION BY student_user_id, subject_title),
          COUNT(*) OVER (PARTITION BY student_user_id, subject_title)
        ) * 100 AS subject_pct
      FROM ${ATTENDANCE_TABLE}
      WHERE ${studentIdMatch('student_user_id')}
        AND is_current_semester = 1
    )
    GROUP BY student_user_id`,
    { studentId: normalizeStudentId(studentId) },
  );
  if (rows.length === 0) return null;
  const r = rows[0]!;
  const total = Number(r.total_sessions);
  const present = Number(r.present_count);
  const absent = total - present;
  const attendancePct = pct(present, total);
  return {
    studentId: r.student_user_id,
    studentName: r.student_name,
    instituteName: r.institute_name ?? null,
    sectionName: r.batch_section_name ?? null,
    totalSessions: total,
    presentCount: present,
    absentCount: absent,
    attendancePct,
    inRecovery: attendancePct < 80,
    coursesInRecovery: Number(r.subjects_in_recovery),
  };
}

export interface SubjectAttendance {
  subjectTitle: string;
  present: number;
  total: number;
  pct: number;
  meetsRequirement: boolean;
}

export async function getStudentSubjects(
  studentId: string,
): Promise<SubjectAttendance[]> {
  if (!validateStudentId.test(studentId)) return [];
  const rows = await bqQuery<{
    subject_title: string;
    present: string;
    total: string;
  }>(
    `SELECT
      subject_title,
      COUNTIF(LOWER(attendance_status) = 'present') AS present,
      COUNT(*) AS total
    FROM ${ATTENDANCE_TABLE}
    WHERE ${studentIdMatch('student_user_id')}
      AND is_current_semester = 1
    GROUP BY subject_title
    ORDER BY subject_title`,
    { studentId: normalizeStudentId(studentId) },
  );
  return rows.map((r) => {
    const p = Number(r.present);
    const t = Number(r.total);
    const percentage = pct(p, t);
    return {
      subjectTitle: r.subject_title,
      present: p,
      total: t,
      pct: percentage,
      meetsRequirement: percentage >= 80,
    };
  });
}

export interface SessionRecord {
  date: string;
  sessionTitle: string;
  subjectTitle: string;
  attendanceStatus: string;
  markingMethod: string | null;
}

export async function getStudentRecentSessions(
  studentId: string,
): Promise<SessionRecord[]> {
  if (!validateStudentId.test(studentId)) return [];
  const rows = await bqQuery<{
    date: string;
    session_title: string;
    subject_title: string;
    attendance_status: string;
    marking_method: string;
  }>(
    `SELECT
      CAST(date AS STRING) AS date,
      session_title,
      subject_title,
      attendance_status,
      marking_method
    FROM ${ATTENDANCE_TABLE}
    WHERE ${studentIdMatch('student_user_id')}
      AND is_current_semester = 1
    ORDER BY date DESC
    LIMIT 500`,
    { studentId: normalizeStudentId(studentId) },
  );
  return rows.map((r) => ({
    date: r.date,
    sessionTitle: r.session_title,
    subjectTitle: r.subject_title,
    attendanceStatus: r.attendance_status,
    markingMethod: r.marking_method ?? null,
  }));
}

export interface StudentSearchResult {
  studentId: string;
  studentName: string;
  instituteName: string | null;
  sectionName: string | null;
  attendancePct: number | null;
  presentCount?: number;
  totalCount?: number;
  classroomAvg?: number | null;
  moduleAvg?: number | null;
}

export async function searchStudents(
  q: string,
  limit: number = 50,
  scope: SessionScope = {},
): Promise<StudentSearchResult[]> {
  const params: Record<string, unknown> = {
    q: `%${q}%`,
    exactId: normalizeStudentId(q),
  };
  const where = scopeClause(scope, params);
  const safeLimit = Math.min(limit, 50);
  const rows = await bqQuery<{
    student_user_id: string;
    student_name: string;
    institute_name: string;
    batch_section_name: string;
    present: string;
    total: string;
  }>(
    `SELECT
      student_user_id,
      MAX(student_name) AS student_name,
      MAX(institute_name) AS institute_name,
      MAX(batch_section_name) AS batch_section_name,
      COUNTIF(LOWER(attendance_status) = 'present') AS present,
      COUNT(*) AS total
    FROM ${ATTENDANCE_TABLE}
    WHERE ${where}
      AND (LOWER(student_name) LIKE LOWER(@q)
           OR ${studentIdMatch("student_user_id")})
    GROUP BY student_user_id
    LIMIT ${safeLimit}`,
    params,
  );
  return rows.map((r) => {
    const p = Number(r.present);
    const t = Number(r.total);
    return {
      studentId: r.student_user_id,
      studentName: r.student_name,
      instituteName: r.institute_name ?? null,
      sectionName: r.batch_section_name ?? null,
      attendancePct: t > 0 ? pct(p, t) : null,
      presentCount: p,
      totalCount: t,
    };
  });
}

function attendanceHavingClause(band: string | undefined): string {
  const pct =
    "SAFE_DIVIDE(COUNTIF(LOWER(attendance_status) = 'present'), COUNT(*)) * 100";
  switch (band) {
    case "below50":
      return `${pct} < 50`;
    case "below80":
      return `${pct} < 80`;
    case "above80":
      return `${pct} >= 80`;
    default:
      return "TRUE";
  }
}

export interface DashboardFilterOptions {
  campuses: string[];
  sections: string[];
  updatedAt: string;
}

/** Live campus/section lists from BigQuery, scoped to the signed-in user. */
export async function getDashboardFilterOptions(
  scope: SessionScope,
  opts: { campus?: string } = {},
): Promise<DashboardFilterOptions> {
  const params: Record<string, unknown> = {};
  const where = scopeClause(scope, params);
  let sectionCampusFilter = "";
  if (opts.campus) {
    params["filterCampus"] = opts.campus;
    sectionCampusFilter = "AND institute_name = @filterCampus";
  }

  const [campusRows, sectionRows] = await Promise.all([
    bqQuery<{ institute_name: string }>(
      `SELECT DISTINCT institute_name
       FROM ${ATTENDANCE_TABLE}
       WHERE ${where} AND institute_name IS NOT NULL
       ORDER BY institute_name`,
      params,
    ),
    bqQuery<{ batch_section_name: string }>(
      `SELECT DISTINCT batch_section_name
       FROM ${ATTENDANCE_TABLE}
       WHERE ${where} ${sectionCampusFilter}
         AND batch_section_name IS NOT NULL
       ORDER BY batch_section_name`,
      params,
    ),
  ]);

  return {
    campuses: campusRows.map((r) => r.institute_name),
    sections: sectionRows.map((r) => r.batch_section_name),
    updatedAt: new Date().toISOString(),
  };
}

export async function getStudentsList(
  scope: SessionScope,
  opts: {
    search?: string;
    limit?: number;
    campus?: string;
    section?: string;
    subject?: string;
    attendanceBand?: string;
    dateRange?: DateRangeFilter;
  } = {},
): Promise<StudentSearchResult[]> {
  const params: Record<string, unknown> = {};
  const where = scopeClause(scope, params) + dateRangeClause(opts.dateRange, params);
  const safeLimit = Math.min(opts.limit ?? 1000, 5000);
  let searchFilter = "";
  if (opts.search) {
    params["q"] = `%${opts.search}%`;
    searchFilter =
      "AND (LOWER(student_name) LIKE LOWER(@q) OR LOWER(CAST(student_user_id AS STRING)) LIKE LOWER(@q))";
  }
  let dimensionFilter = "";
  if (opts.campus) {
    params["campus"] = opts.campus;
    dimensionFilter += " AND institute_name = @campus";
  }
  if (opts.section) {
    params["section"] = opts.section;
    dimensionFilter += " AND batch_section_name = @section";
  }
  if (opts.subject) {
    params["subject"] = opts.subject;
    dimensionFilter += " AND subject_title = @subject";
  }
  const having = attendanceHavingClause(opts.attendanceBand);
  const rows = await bqQuery<{
    student_user_id: string;
    student_name: string;
    institute_name: string;
    batch_section_name: string;
    present: string;
    total: string;
    classroom_avg: string | null;
    module_avg: string | null;
  }>(
    `WITH att AS (
      SELECT
        student_user_id,
        MAX(student_name) AS student_name,
        MAX(institute_name) AS institute_name,
        MAX(batch_section_name) AS batch_section_name,
        COUNTIF(LOWER(attendance_status) = 'present') AS present,
        COUNT(*) AS total
      FROM ${ATTENDANCE_TABLE}
      WHERE ${where}
      ${searchFilter}
      ${dimensionFilter}
      GROUP BY student_user_id
      HAVING ${having}
    ),
    quiz AS (
      SELECT
        user_id,
        AVG(IF(UPPER(derived_unit_type) LIKE '%MODULE%', NULL,
          IFNULL(SAFE_CAST(avg_best_attempt_percentage_score AS FLOAT64), 0))) AS classroom_avg,
        AVG(IF(UPPER(derived_unit_type) LIKE '%MODULE%',
          IFNULL(SAFE_CAST(avg_best_attempt_percentage_score AS FLOAT64), 0), NULL)) AS module_avg
      FROM ${QUIZ_TABLE}
      GROUP BY user_id
    )
    SELECT
      att.student_user_id,
      att.student_name,
      att.institute_name,
      att.batch_section_name,
      att.present,
      att.total,
      quiz.classroom_avg,
      quiz.module_avg
    FROM att
    LEFT JOIN quiz
      ON LOWER(REPLACE(CAST(quiz.user_id AS STRING), '-', ''))
       = LOWER(REPLACE(CAST(att.student_user_id AS STRING), '-', ''))
    ORDER BY SAFE_DIVIDE(att.present, att.total) ASC
    LIMIT ${safeLimit}`,
    params,
  );
  const round1 = (v: string | null): number | null => {
    if (v === null || v === undefined) return null;
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(n * 10) / 10 : null;
  };
  return rows.map((r) => {
    const p = Number(r.present);
    const t = Number(r.total);
    return {
      studentId: r.student_user_id,
      studentName: r.student_name,
      instituteName: r.institute_name ?? null,
      sectionName: r.batch_section_name ?? null,
      attendancePct: t > 0 ? pct(p, t) : null,
      presentCount: p,
      totalCount: t,
      classroomAvg: round1(r.classroom_avg),
      moduleAvg: round1(r.module_avg),
    };
  });
}

export interface CampusSummaryItem {
  instituteName: string;
  studentCount: number;
  sectionCount: number;
  subjectCount: number;
  presentCount: number;
  totalCount: number;
  pct: number;
}

export interface SectionSummaryItem {
  instituteName: string;
  sectionName: string;
  studentCount: number;
  presentCount: number;
  totalCount: number;
  pct: number;
}

export async function getCampusSummary(
  scope: SessionScope,
  opts: { dateRange?: DateRangeFilter } = {},
): Promise<CampusSummaryItem[]> {
  const params: Record<string, unknown> = {};
  const where = scopeClause(scope, params) + dateRangeClause(opts.dateRange, params);
  const rows = await bqQuery<{
    institute_name: string;
    student_count: string;
    section_count: string;
    subject_count: string;
    present_count: string;
    total_count: string;
  }>(
    `SELECT
      institute_name,
      COUNT(DISTINCT student_user_id) AS student_count,
      COUNT(DISTINCT batch_section_name) AS section_count,
      COUNT(DISTINCT subject_title) AS subject_count,
      COUNTIF(LOWER(attendance_status) = 'present') AS present_count,
      COUNT(*) AS total_count
    FROM ${ATTENDANCE_TABLE}
    WHERE ${where}
    GROUP BY institute_name
    ORDER BY institute_name`,
    params,
  );
  return rows.map((r) => {
    const p = Number(r.present_count);
    const t = Number(r.total_count);
    return {
      instituteName: r.institute_name,
      studentCount: Number(r.student_count),
      sectionCount: Number(r.section_count),
      subjectCount: Number(r.subject_count),
      presentCount: p,
      totalCount: t,
      pct: pct(p, t),
    };
  });
}

export async function getSectionSummary(
  scope: SessionScope,
): Promise<SectionSummaryItem[]> {
  const params: Record<string, unknown> = {};
  const where = scopeClause(scope, params);
  const rows = await bqQuery<{
    institute_name: string;
    batch_section_name: string;
    student_count: string;
    present_count: string;
    total_count: string;
  }>(
    `SELECT
      institute_name,
      COALESCE(batch_section_name, 'Unknown') AS batch_section_name,
      COUNT(DISTINCT student_user_id) AS student_count,
      COUNTIF(LOWER(attendance_status) = 'present') AS present_count,
      COUNT(*) AS total_count
    FROM ${ATTENDANCE_TABLE}
    WHERE ${where}
    GROUP BY institute_name, COALESCE(batch_section_name, 'Unknown')
    ORDER BY institute_name, batch_section_name`,
    params,
  );
  return rows.map((r) => {
    const p = Number(r.present_count);
    const t = Number(r.total_count);
    return {
      instituteName: r.institute_name,
      sectionName: r.batch_section_name,
      studentCount: Number(r.student_count),
      presentCount: p,
      totalCount: t,
      pct: pct(p, t),
    };
  });
}

export interface SubjectSummaryItem {
  subjectTitle: string;
  studentCount: number;
  presentCount: number;
  totalCount: number;
  pct: number;
}

export async function getSubjectSummary(
  scope: SessionScope,
  opts: { campus?: string; dateRange?: DateRangeFilter } = {},
): Promise<SubjectSummaryItem[]> {
  const params: Record<string, unknown> = {};
  const where = scopeClause(scope, params) + dateRangeClause(opts.dateRange, params);
  let campusFilter = "";
  if (opts.campus) {
    params["filterCampus"] = opts.campus;
    campusFilter = " AND institute_name = @filterCampus";
  }
  const rows = await bqQuery<{
    subject_title: string;
    student_count: string;
    present_count: string;
    total_count: string;
  }>(
    `SELECT
      subject_title,
      COUNT(DISTINCT student_user_id) AS student_count,
      COUNTIF(LOWER(attendance_status) = 'present') AS present_count,
      COUNT(*) AS total_count
    FROM ${ATTENDANCE_TABLE}
    WHERE ${where}${campusFilter}
    GROUP BY subject_title
    ORDER BY SAFE_DIVIDE(COUNTIF(LOWER(attendance_status) = 'present'), COUNT(*)) ASC`,
    params,
  );
  return rows.map((r) => {
    const p = Number(r.present_count);
    const t = Number(r.total_count);
    return {
      subjectTitle: r.subject_title,
      studentCount: Number(r.student_count),
      presentCount: p,
      totalCount: t,
      pct: pct(p, t),
    };
  });
}

export interface SessionSummaryItem {
  sessionTitle: string;
  date: string | null;
  studentCount: number;
  presentCount: number;
  totalCount: number;
  pct: number;
}

/**
 * Session (unit) level rollup inside one subject. One row per
 * (session_title, date) so a session repeated on different days stays
 * distinct. Scope-filtered like every other dashboard query.
 */
export async function getSubjectSessions(
  scope: SessionScope,
  opts: {
    subject: string;
    campus?: string;
    section?: string;
    semester?: string;
    dateRange?: DateRangeFilter;
  },
): Promise<SessionSummaryItem[]> {
  const params: Record<string, unknown> = { subject: opts.subject };
  const where =
    scopeClause(scope, params, { semester: opts.semester }) +
    dateRangeClause(opts.dateRange, params);
  let extra = " AND subject_title = @subject";
  if (opts.campus) {
    params["campus"] = opts.campus;
    extra += " AND institute_name = @campus";
  }
  if (opts.section) {
    params["section"] = opts.section;
    extra += " AND batch_section_name = @section";
  }
  const rows = await bqQuery<{
    session_title: string;
    date: string | null;
    student_count: string;
    present_count: string;
    total_count: string;
  }>(
    `SELECT
      COALESCE(session_title, 'Untitled session') AS session_title,
      CAST(date AS STRING) AS date,
      COUNT(DISTINCT student_user_id) AS student_count,
      COUNTIF(LOWER(attendance_status) = 'present') AS present_count,
      COUNT(*) AS total_count
    FROM ${ATTENDANCE_TABLE}
    WHERE ${where}${extra}
    GROUP BY session_title, date
    ORDER BY date DESC, session_title`,
    params,
  );
  return rows.map((r) => {
    const p = Number(r.present_count);
    const t = Number(r.total_count);
    return {
      sessionTitle: r.session_title,
      date: r.date ?? null,
      studentCount: Number(r.student_count),
      presentCount: p,
      totalCount: t,
      pct: pct(p, t),
    };
  });
}

export interface CampusSessionRow {
  subjectTitle: string;
  sessionTitle: string;
  date: string | null;
  studentCount: number;
  presentCount: number;
  absentCount: number;
  totalCount: number;
  pct: number;
}

/**
 * Every session at one campus, flattened across subjects — the campus
 * drill-down table. Ordered by subject then worst attendance first, so the
 * sessions needing attention surface at the top of each subject group.
 */
export async function getCampusSessions(
  scope: SessionScope,
  opts: { campus: string; section?: string; dateRange?: DateRangeFilter },
): Promise<CampusSessionRow[]> {
  const params: Record<string, unknown> = { campus: opts.campus };
  const where = scopeClause(scope, params) + dateRangeClause(opts.dateRange, params);
  let extra = " AND institute_name = @campus";
  if (opts.section) {
    params["section"] = opts.section;
    extra += " AND batch_section_name = @section";
  }
  const rows = await bqQuery<{
    subject_title: string;
    session_title: string;
    date: string | null;
    student_count: string;
    present_count: string;
    total_count: string;
  }>(
    `SELECT
      subject_title,
      COALESCE(session_title, 'Untitled session') AS session_title,
      CAST(date AS STRING) AS date,
      COUNT(DISTINCT student_user_id) AS student_count,
      COUNTIF(LOWER(attendance_status) = 'present') AS present_count,
      COUNT(*) AS total_count
    FROM ${ATTENDANCE_TABLE}
    WHERE ${where}${extra}
    GROUP BY subject_title, session_title, date
    ORDER BY
      subject_title,
      SAFE_DIVIDE(
        COUNTIF(LOWER(attendance_status) = 'present'),
        COUNT(*)
      ) ASC`,
    params,
  );
  return rows.map((r) => {
    const p = Number(r.present_count);
    const t = Number(r.total_count);
    return {
      subjectTitle: r.subject_title,
      sessionTitle: r.session_title,
      date: r.date ?? null,
      studentCount: Number(r.student_count),
      presentCount: p,
      absentCount: t - p,
      totalCount: t,
      pct: pct(p, t),
    };
  });
}

export interface SessionStudentItem {
  studentId: string;
  studentName: string;
  instituteName: string | null;
  sectionName: string | null;
  attendanceStatus: string;
  markingMethod: string | null;
}

/**
 * Per-student attendance for one session of one subject — who attended and
 * who did not, which is the leaf of the campus drill-down.
 */
export async function getSessionStudents(
  scope: SessionScope,
  opts: {
    subject: string;
    sessionTitle: string;
    date?: string;
    campus?: string;
    section?: string;
    limit?: number;
  },
): Promise<SessionStudentItem[]> {
  const params: Record<string, unknown> = {
    subject: opts.subject,
    sessionTitle: opts.sessionTitle,
  };
  const where = scopeClause(scope, params);
  let extra =
    " AND subject_title = @subject" +
    " AND COALESCE(session_title, 'Untitled session') = @sessionTitle";
  if (opts.date) {
    params["date"] = opts.date;
    extra += " AND CAST(date AS STRING) = @date";
  }
  if (opts.campus) {
    params["campus"] = opts.campus;
    extra += " AND institute_name = @campus";
  }
  if (opts.section) {
    params["section"] = opts.section;
    extra += " AND batch_section_name = @section";
  }
  const safeLimit = Math.min(opts.limit ?? 2000, 5000);
  const rows = await bqQuery<{
    student_user_id: string;
    student_name: string;
    institute_name: string;
    batch_section_name: string;
    attendance_status: string;
    marking_method: string | null;
  }>(
    `SELECT
      student_user_id,
      MAX(student_name) AS student_name,
      MAX(institute_name) AS institute_name,
      MAX(batch_section_name) AS batch_section_name,
      MAX(attendance_status) AS attendance_status,
      MAX(marking_method) AS marking_method
    FROM ${ATTENDANCE_TABLE}
    WHERE ${where}${extra}
    GROUP BY student_user_id
    ORDER BY MAX(student_name)
    LIMIT ${safeLimit}`,
    params,
  );
  return rows.map((r) => ({
    studentId: r.student_user_id,
    studentName: r.student_name,
    instituteName: r.institute_name ?? null,
    sectionName: r.batch_section_name ?? null,
    attendanceStatus: r.attendance_status ?? "",
    markingMethod: r.marking_method ?? null,
  }));
}

export interface RecoveryStudent {
  studentId: string;
  studentName: string;
  sectionName: string | null;
  attendancePct: number;
  presentCount: number;
  totalCount: number;
}

export interface SubjectProdSequenceItem {
  sessionId: string;
  order: number;
  week: number | null;
  topicTitle: string;
  sessionType: string | null;
  completed: boolean;
  completedAt: string | null;
  completedSections: number;
  totalSections: number;
}

export async function getSubjectProdSequence(
  campus: string,
  subject: string,
  semester?: string,
  section?: string,
  sessionType?: string,
): Promise<SubjectProdSequenceItem[]> {
  const params: Record<string, unknown> = { campus, subject };
  const semesterClause = semester
    ? "semester_title = @semester"
    : "is_current_semester = 1";
  const sectionClause = section ? "AND section_name = @section" : "";
  const sessionTypeClause = sessionType
    ? "AND UPPER(COALESCE(session_type, '')) = UPPER(@sessionType)"
    : "";
  if (semester) params["semester"] = semester;
  if (section) params["section"] = section;
  if (sessionType) params["sessionType"] = sessionType;

  const rows = await bqQuery<{
    session_id: string;
    sequence_order: string;
    week_count: string | null;
    session_title: string;
    session_type: string | null;
    completed: boolean | string;
    completed_at: string | null;
    completed_sections: string;
    total_sections: string;
  }>(
    `SELECT
       session_id,
       MIN(COALESCE(calculated_session_id_order, session_id_order, schedule_rn)) AS sequence_order,
       MIN(week_count) AS week_count,
       ANY_VALUE(session_title) AS session_title,
       ANY_VALUE(session_type) AS session_type,
       COUNTIF(UPPER(COALESCE(session_status, '')) = 'COMPLETED') > 0 AS completed,
       CAST(MIN(IF(
         UPPER(COALESCE(session_status, '')) = 'COMPLETED',
         DATE(session_start_datetime),
         NULL
       )) AS STRING) AS completed_at,
       COUNT(DISTINCT IF(
         UPPER(COALESCE(session_status, '')) = 'COMPLETED',
         section_id,
         NULL
       )) AS completed_sections,
       COUNT(DISTINCT section_id) AS total_sections
     FROM ${PROD_SEQUENCE_TABLE}
     WHERE institute_name = @campus
       AND course_title = @subject
       AND ${semesterClause}
       ${sectionClause}
       ${sessionTypeClause}
       AND session_id IS NOT NULL
       AND session_title IS NOT NULL
     GROUP BY session_id
     ORDER BY sequence_order, session_title`,
    params,
  );

  return rows.map((row) => ({
    sessionId: row.session_id,
    order: Number(row.sequence_order),
    week: row.week_count === null ? null : Number(row.week_count),
    topicTitle: row.session_title,
    sessionType: row.session_type ?? null,
    completed: row.completed === true || row.completed === "true",
    completedAt: row.completed_at ?? null,
    completedSections: Number(row.completed_sections),
    totalSections: Number(row.total_sections),
  }));
}

export interface RecoverySubjectCard {
  subjectTitle: string;
  attendancePct: number;
  studentsBelow80Count: number;
  students: RecoveryStudent[];
}

export interface RecoveryCampusData {
  campus: string;
  subjects: RecoverySubjectCard[];
  totalSubjectsInRecovery: number;
  totalStudentsInRecovery: number;
}

/**
 * Subject-level recovery data for a campus.
 *
 * The threshold is applied at the subject level: a student may appear under one
 * or more subjects even if their overall attendance is above 80%.
 */
export async function getCampusSubjectRecovery(
  campus: string,
  scope: SessionScope,
  semester?: string,
): Promise<RecoveryCampusData> {
  const params: Record<string, unknown> = { campus };
  const where = scopeClause(scope, params, { semester });

  const rows = await bqQuery<{
    subject_title: string;
    student_user_id: string;
    student_name: string;
    batch_section_name: string | null;
    present_count: string;
    total_count: string;
    subject_pct: string;
  }>(
    `WITH student_subject_attendance AS (
      SELECT
        subject_title,
        student_user_id,
        MAX(student_name) AS student_name,
        MAX(batch_section_name) AS batch_section_name,
        COUNTIF(LOWER(attendance_status) = 'present') AS present_count,
        COUNT(*) AS total_count,
        SAFE_DIVIDE(COUNTIF(LOWER(attendance_status) = 'present'), COUNT(*)) * 100 AS subject_pct
      FROM ${ATTENDANCE_TABLE}
      WHERE ${where}
        AND institute_name = @campus
        AND COALESCE(session_title, '') NOT IN (
          'Coding Practice',
          'MCQ Practice',
          'Module Quiz'
        )
      GROUP BY subject_title, student_user_id
    )
    SELECT
      subject_title,
      student_user_id,
      student_name,
      batch_section_name,
      present_count,
      total_count,
      subject_pct
    FROM student_subject_attendance
    WHERE CAST(subject_pct AS FLOAT64) < 80
    ORDER BY subject_title, subject_pct ASC, student_name`,
    params,
  );

  const subjectMap = new Map<string, RecoveryStudent[]>();
  const subjectAttendanceMap = new Map<string, number>();
  const studentIds = new Set<string>();

  for (const r of rows) {
    const present = Number(r.present_count);
    const total = Number(r.total_count);
    const pctValue = Number(r.subject_pct);

    const student: RecoveryStudent = {
      studentId: r.student_user_id,
      studentName: r.student_name,
      sectionName: r.batch_section_name ?? null,
      attendancePct: pctValue,
      presentCount: present,
      totalCount: total,
    };

    if (!subjectMap.has(r.subject_title)) {
      subjectMap.set(r.subject_title, []);
    }
    subjectMap.get(r.subject_title)!.push(student);
    studentIds.add(r.student_user_id);

    if (!subjectAttendanceMap.has(r.subject_title)) {
      subjectAttendanceMap.set(r.subject_title, pctValue);
    }
  }

  // Recompute overall subject attendance from the attendance table for the campus
  const subjectSummaryRows = await bqQuery<{
    subject_title: string;
    subject_pct: string;
  }>(
    `SELECT
      subject_title,
      SAFE_DIVIDE(COUNTIF(LOWER(attendance_status) = 'present'), COUNT(*)) * 100 AS subject_pct
    FROM ${ATTENDANCE_TABLE}
    WHERE ${where}
      AND institute_name = @campus
      AND COALESCE(session_title, '') NOT IN (
        'Coding Practice',
        'MCQ Practice',
        'Module Quiz'
      )
    GROUP BY subject_title
    ORDER BY subject_title`,
    params,
  );

  const subjectCards: RecoverySubjectCard[] = subjectSummaryRows
    .map((r) => {
      const students = subjectMap.get(r.subject_title) ?? [];
      const studentsBelow80 = students.length;
      return {
        subjectTitle: r.subject_title,
        attendancePct: Number(r.subject_pct),
        studentsBelow80Count: studentsBelow80,
        students,
      };
    })
    .filter((subject) => subject.studentsBelow80Count > 0)
    .sort((a, b) => a.subjectTitle.localeCompare(b.subjectTitle));

  return {
    campus,
    subjects: subjectCards,
    totalSubjectsInRecovery: subjectCards.length,
    totalStudentsInRecovery: studentIds.size,
  };
}

export async function getRecoveryStudents(
  campus: string,
  subject: string,
  semester: string,
  scope: SessionScope,
): Promise<RecoveryStudent[]> {
  const params: Record<string, unknown> = { campus, subject };
  const where = scopeClause(scope, params, { semester });
  const rows = await bqQuery<{
    student_user_id: string;
    student_name: string;
    batch_section_name: string | null;
    present_count: string;
    total_count: string;
    subject_pct: string;
  }>(
    `SELECT
       student_user_id,
       MAX(student_name) AS student_name,
       MAX(batch_section_name) AS batch_section_name,
       COUNTIF(LOWER(attendance_status) = 'present') AS present_count,
       COUNT(*) AS total_count,
       SAFE_DIVIDE(COUNTIF(LOWER(attendance_status) = 'present'), COUNT(*)) * 100 AS subject_pct
     FROM ${ATTENDANCE_TABLE}
     WHERE ${where}
       AND institute_name = @campus
       AND subject_title = @subject
       AND COALESCE(session_title, '') NOT IN (
         'Coding Practice',
         'MCQ Practice',
         'Module Quiz'
       )
     GROUP BY student_user_id
     HAVING CAST(subject_pct AS FLOAT64) < 80
     ORDER BY subject_pct ASC, student_name`,
    params,
  );

  return rows.map((row) => ({
    studentId: row.student_user_id,
    studentName: row.student_name,
    sectionName: row.batch_section_name ?? null,
    attendancePct: Number(row.subject_pct),
    presentCount: Number(row.present_count),
    totalCount: Number(row.total_count),
  }));
}

const LECTURE_SESSION_EXCLUSIONS = `COALESCE(session_title, '') NOT IN (
          'Coding Practice',
          'MCQ Practice',
          'Module Quiz'
        )`;

/** C.Q / M.Q fail the 100% bar if unfinished or a known average is under 100. Null avg is not treated as 0. */
function quizFails100Sql(completed: string, total: string, avg: string): string {
  return `(${total} > 0 AND (${completed} < ${total} OR (${avg} IS NOT NULL AND ${avg} < 100)))`;
}

/**
 * Classroom and module quiz rows store the attendance subject in different
 * columns. Match either `semester_course_title` or `course_title`.
 */
function quizMatchesSubjectSql(subjectExpr: string, quizAlias = ""): string {
  const col = quizAlias ? `${quizAlias}.` : "";
  return `(
    LOWER(TRIM(CAST(COALESCE(${col}semester_course_title, '') AS STRING))) = LOWER(TRIM(${subjectExpr}))
    OR LOWER(TRIM(CAST(COALESCE(${col}course_title, '') AS STRING))) = LOWER(TRIM(${subjectExpr}))
  )`;
}

/** Prefer semester_course_title, then course_title — CQ and MQ store the subject in different columns. */
function quizSubjectTitleSql(quizAlias = ""): string {
  const col = quizAlias ? `${quizAlias}.` : "";
  return `COALESCE(
    NULLIF(TRIM(CAST(${col}semester_course_title AS STRING)), ''),
    NULLIF(TRIM(CAST(${col}course_title AS STRING)), ''),
    'Unknown'
  )`;
}

const QUIZ_PIVOT_SELECT = `SUM(IF(UPPER({a}derived_unit_type) LIKE '%MODULE%', 0,
          IFNULL(SAFE_CAST({a}total_quizzes AS INT64), 0))) AS cq_total,
        SUM(IF(UPPER({a}derived_unit_type) LIKE '%MODULE%', 0,
          IFNULL(SAFE_CAST({a}total_completed_quizzes AS INT64), 0))) AS cq_completed,
        AVG(IF(UPPER({a}derived_unit_type) LIKE '%MODULE%', NULL,
          SAFE_CAST({a}avg_best_attempt_percentage_score AS FLOAT64))) AS cq_avg,
        SUM(IF(UPPER({a}derived_unit_type) LIKE '%MODULE%',
          IFNULL(SAFE_CAST({a}total_quizzes AS INT64), 0), 0)) AS mq_total,
        SUM(IF(UPPER({a}derived_unit_type) LIKE '%MODULE%',
          IFNULL(SAFE_CAST({a}total_completed_quizzes AS INT64), 0), 0)) AS mq_completed,
        AVG(IF(UPPER({a}derived_unit_type) NOT LIKE '%MODULE%', NULL,
          SAFE_CAST({a}avg_best_attempt_percentage_score AS FLOAT64))) AS mq_avg`;

function quizPivotSelect(quizAlias = ""): string {
  const prefix = quizAlias ? `${quizAlias}.` : "";
  return QUIZ_PIVOT_SELECT.replaceAll("{a}", prefix);
}

/**
 * Quiz table has no `is_current_semester` or date column. Scope by campus
 * and subject only — subject matches either quiz title column.
 */
function quizScopeClause(
  scope: SessionScope,
  params: Record<string, unknown>,
  quizAlias = "",
): string {
  const col = quizAlias ? `${quizAlias}.` : "";
  const clauses: string[] = [];
  if (scope.campuses && scope.campuses.length > 0) {
    clauses.push(`${col}institute_name IN UNNEST(@campuses)`);
    params["campuses"] = scope.campuses;
  }
  if (scope.subjects && scope.subjects.length > 0) {
    clauses.push(
      `(${col}semester_course_title IN UNNEST(@subjects) OR ${col}course_title IN UNNEST(@subjects))`,
    );
    params["subjects"] = scope.subjects;
  }
  return clauses.length > 0 ? clauses.join(" AND ") : "TRUE";
}

export interface AssessmentCountRow {
  classroomCompleted: number;
  classroomTotal: number;
  moduleCompleted: number;
  moduleTotal: number;
  totalCompleted: number;
  totalAssigned: number;
  completionPct: number;
}

export interface AssessmentCampusItem extends AssessmentCountRow {
  instituteName: string;
  studentCount: number;
}

export interface AssessmentSubjectItem extends AssessmentCountRow {
  subjectTitle: string;
  studentCount: number;
}

export interface AssessmentStudentItem extends AssessmentCountRow {
  studentId: string;
  studentName: string;
  instituteName: string;
  sectionName: string | null;
}

function mapAssessmentCounts(row: {
  cq_completed: string;
  cq_total: string;
  mq_completed: string;
  mq_total: string;
}): AssessmentCountRow {
  const classroomCompleted = Number(row.cq_completed ?? 0);
  const classroomTotal = Number(row.cq_total ?? 0);
  const moduleCompleted = Number(row.mq_completed ?? 0);
  const moduleTotal = Number(row.mq_total ?? 0);
  const totalCompleted = classroomCompleted + moduleCompleted;
  const totalAssigned = classroomTotal + moduleTotal;
  return {
    classroomCompleted,
    classroomTotal,
    moduleCompleted,
    moduleTotal,
    totalCompleted,
    totalAssigned,
    completionPct: pct(totalCompleted, totalAssigned),
  };
}

/**
 * Campus rollup of classroom + module quiz counts.
 * Campus list matches attendance (current semester), so campuses without
 * quiz rows still appear with zero counts — same 34 as the dashboard.
 */
export async function getAssessmentCampusSummary(
  scope: SessionScope,
): Promise<AssessmentCampusItem[]> {
  const params: Record<string, unknown> = {};
  const attWhere = scopeClause(scope, params);
  const quizWhere = quizScopeClause(scope, params);
  const rows = await bqQuery<{
    institute_name: string;
    student_count: string;
    cq_completed: string;
    cq_total: string;
    mq_completed: string;
    mq_total: string;
  }>(
    `WITH campuses AS (
      SELECT DISTINCT institute_name
      FROM ${ATTENDANCE_TABLE}
      WHERE ${attWhere}
        AND institute_name IS NOT NULL
        AND TRIM(institute_name) != ''
    ),
    quiz AS (
      SELECT
        institute_name,
        COUNT(DISTINCT user_id) AS student_count,
        ${quizPivotSelect()}
      FROM ${QUIZ_TABLE}
      WHERE ${quizWhere}
        AND institute_name IS NOT NULL
        AND TRIM(institute_name) != ''
      GROUP BY institute_name
    )
    SELECT
      campuses.institute_name,
      IFNULL(quiz.student_count, 0) AS student_count,
      IFNULL(quiz.cq_completed, 0) AS cq_completed,
      IFNULL(quiz.cq_total, 0) AS cq_total,
      IFNULL(quiz.mq_completed, 0) AS mq_completed,
      IFNULL(quiz.mq_total, 0) AS mq_total
    FROM campuses
    LEFT JOIN quiz ON quiz.institute_name = campuses.institute_name
    ORDER BY campuses.institute_name`,
    params,
  );
  return rows.map((r) => ({
    instituteName: r.institute_name,
    studentCount: Number(r.student_count),
    ...mapAssessmentCounts(r),
  }));
}

/** Subject rollup of classroom + module quiz counts at one campus. */
export async function getAssessmentSubjects(
  scope: SessionScope,
  opts: { campus: string },
): Promise<AssessmentSubjectItem[]> {
  const params: Record<string, unknown> = { filterCampus: opts.campus };
  const where = quizScopeClause(scope, params);
  const subjectTitle = quizSubjectTitleSql();
  const rows = await bqQuery<{
    subject_title: string;
    student_count: string;
    cq_completed: string;
    cq_total: string;
    mq_completed: string;
    mq_total: string;
  }>(
    `SELECT
      ${subjectTitle} AS subject_title,
      COUNT(DISTINCT user_id) AS student_count,
      ${quizPivotSelect()}
    FROM ${QUIZ_TABLE}
    WHERE ${where}
      AND institute_name = @filterCampus
    GROUP BY subject_title
    ORDER BY subject_title`,
    params,
  );
  return rows.map((r) => ({
    subjectTitle: r.subject_title,
    studentCount: Number(r.student_count),
    ...mapAssessmentCounts(r),
  }));
}

/** Per-student classroom + module quiz counts. Names come from attendance. */
export async function getAssessmentStudents(
  scope: SessionScope,
  opts: {
    campus?: string;
    subject?: string;
    search?: string;
    limit?: number;
  } = {},
): Promise<AssessmentStudentItem[]> {
  const params: Record<string, unknown> = {};
  const where = quizScopeClause(scope, params);
  let extra = "";
  if (opts.campus) {
    params["filterCampus"] = opts.campus;
    extra += " AND institute_name = @filterCampus";
  }
  if (opts.subject) {
    params["subject"] = opts.subject;
    extra += ` AND ${quizMatchesSubjectSql("@subject")}`;
  }
  let searchFilter = "";
  if (opts.search) {
    params["q"] = `%${opts.search}%`;
    searchFilter =
      "AND (LOWER(COALESCE(names.student_name, '')) LIKE LOWER(@q) OR LOWER(CAST(quiz.user_id AS STRING)) LIKE LOWER(@q))";
  }
  const safeLimit = Math.min(opts.limit ?? 2000, 5000);
  const rows = await bqQuery<{
    student_user_id: string;
    student_name: string;
    institute_name: string;
    section_name: string | null;
    cq_completed: string;
    cq_total: string;
    mq_completed: string;
    mq_total: string;
  }>(
    `WITH quiz AS (
      SELECT
        user_id,
        ANY_VALUE(institute_name) AS institute_name,
        ${quizPivotSelect()}
      FROM ${QUIZ_TABLE}
      WHERE ${where}${extra}
      GROUP BY user_id
    ),
    names AS (
      SELECT
        LOWER(REPLACE(CAST(student_user_id AS STRING), '-', '')) AS student_key,
        MAX(student_name) AS student_name,
        MAX(batch_section_name) AS section_name
      FROM ${ATTENDANCE_TABLE}
      WHERE student_name IS NOT NULL
        AND TRIM(student_name) != ''
      GROUP BY 1
    )
    SELECT
      CAST(quiz.user_id AS STRING) AS student_user_id,
      COALESCE(names.student_name, '') AS student_name,
      quiz.institute_name,
      names.section_name,
      quiz.cq_completed,
      quiz.cq_total,
      quiz.mq_completed,
      quiz.mq_total
    FROM quiz
    LEFT JOIN names
      ON names.student_key = LOWER(REPLACE(CAST(quiz.user_id AS STRING), '-', ''))
    WHERE TRUE
      ${searchFilter}
    ORDER BY
      SAFE_DIVIDE(
        quiz.cq_completed + quiz.mq_completed,
        quiz.cq_total + quiz.mq_total
      ) ASC,
      student_name
    LIMIT ${safeLimit}`,
    params,
  );
  return rows.map((r) => ({
    studentId: r.student_user_id,
    studentName: r.student_name || "Unknown student",
    instituteName: r.institute_name ?? "",
    sectionName: r.section_name ?? null,
    ...mapAssessmentCounts(r),
  }));
}

export interface QuizRecoveryStudent {
  studentId: string;
  studentName: string;
  sectionName: string | null;
  attendancePct: number;
  presentCount: number;
  totalCount: number;
  classroomAvg: number | null;
  classroomCompleted: number;
  classroomTotal: number;
  moduleAvg: number | null;
  moduleCompleted: number;
  moduleTotal: number;
}

export interface QuizRecoverySubjectCard {
  subjectTitle: string;
  studentsNotAt100Count: number;
  students: QuizRecoveryStudent[];
}

export interface QuizRecoveryCampusData {
  campus: string;
  subjects: QuizRecoverySubjectCard[];
  totalSubjectsInRecovery: number;
  totalStudentsInRecovery: number;
}

function mapQuizRecoveryStudent(row: {
  student_user_id: string;
  student_name: string;
  batch_section_name: string | null;
  present_count: string;
  total_count: string;
  subject_pct: string;
  cq_avg: string | null;
  cq_completed: string;
  cq_total: string;
  mq_avg: string | null;
  mq_completed: string;
  mq_total: string;
}): QuizRecoveryStudent {
  const round1 = (v: string | null): number | null => {
    if (v === null || v === undefined) return null;
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(n * 10) / 10 : null;
  };
  return {
    studentId: row.student_user_id,
    studentName: row.student_name,
    sectionName: row.batch_section_name ?? null,
    attendancePct: Number(row.subject_pct),
    presentCount: Number(row.present_count),
    totalCount: Number(row.total_count),
    classroomAvg: round1(row.cq_avg),
    classroomCompleted: Number(row.cq_completed ?? 0),
    classroomTotal: Number(row.cq_total ?? 0),
    moduleAvg: round1(row.mq_avg),
    moduleCompleted: Number(row.mq_completed ?? 0),
    moduleTotal: Number(row.mq_total ?? 0),
  };
}

/**
 * Students whose C.Q or M.Q is not fully completed at 100%. Attendance is
 * joined only for name/section and display % — it does not gate the list.
 * Skill assessment is not in BigQuery yet.
 */
export async function getCampusQuizRecovery(
  campus: string,
  scope: SessionScope,
  semester?: string,
): Promise<QuizRecoveryCampusData> {
  const params: Record<string, unknown> = { campus };
  const attWhere = scopeClause(scope, params, { semester });
  const quizWhere = quizScopeClause(scope, params, "q");
  const rows = await bqQuery<{
    subject_title: string;
    student_user_id: string;
    student_name: string;
    batch_section_name: string | null;
    present_count: string;
    total_count: string;
    subject_pct: string;
    cq_avg: string | null;
    cq_completed: string;
    cq_total: string;
    mq_avg: string | null;
    mq_completed: string;
    mq_total: string;
  }>(
    `WITH quiz AS (
      SELECT
        ${quizSubjectTitleSql("q")} AS subject_title,
        q.user_id,
        ${quizPivotSelect("q")}
      FROM ${QUIZ_TABLE} q
      WHERE (q.institute_name = @campus OR q.institute_name IS NULL)
        AND ${quizWhere}
      GROUP BY 1, q.user_id
      HAVING ${quizFails100Sql("cq_completed", "cq_total", "cq_avg")}
          OR ${quizFails100Sql("mq_completed", "mq_total", "mq_avg")}
    ),
    att AS (
      SELECT
        subject_title,
        student_user_id,
        MAX(student_name) AS student_name,
        MAX(batch_section_name) AS batch_section_name,
        COUNTIF(LOWER(attendance_status) = 'present') AS present_count,
        COUNT(*) AS total_count,
        SAFE_DIVIDE(COUNTIF(LOWER(attendance_status) = 'present'), COUNT(*)) * 100 AS subject_pct
      FROM ${ATTENDANCE_TABLE}
      WHERE ${attWhere}
        AND institute_name = @campus
        AND ${LECTURE_SESSION_EXCLUSIONS}
      GROUP BY subject_title, student_user_id
    ),
    names AS (
      SELECT
        student_user_id,
        MAX(student_name) AS student_name,
        MAX(batch_section_name) AS batch_section_name
      FROM ${ATTENDANCE_TABLE}
      WHERE ${attWhere}
        AND institute_name = @campus
      GROUP BY student_user_id
    )
    SELECT
      quiz.subject_title,
      CAST(quiz.user_id AS STRING) AS student_user_id,
      COALESCE(att.student_name, names.student_name, 'Unknown student') AS student_name,
      COALESCE(att.batch_section_name, names.batch_section_name) AS batch_section_name,
      IFNULL(att.present_count, 0) AS present_count,
      IFNULL(att.total_count, 0) AS total_count,
      IFNULL(att.subject_pct, 0) AS subject_pct,
      quiz.cq_avg,
      quiz.cq_completed,
      quiz.cq_total,
      quiz.mq_avg,
      quiz.mq_completed,
      quiz.mq_total
    FROM quiz
    LEFT JOIN att
      ON LOWER(REPLACE(CAST(quiz.user_id AS STRING), '-', ''))
       = LOWER(REPLACE(CAST(att.student_user_id AS STRING), '-', ''))
     AND LOWER(TRIM(att.subject_title)) = LOWER(TRIM(quiz.subject_title))
    LEFT JOIN names
      ON LOWER(REPLACE(CAST(quiz.user_id AS STRING), '-', ''))
       = LOWER(REPLACE(CAST(names.student_user_id AS STRING), '-', ''))
    ORDER BY quiz.subject_title, student_name`,
    params,
  );

  const subjectMap = new Map<string, QuizRecoveryStudent[]>();
  const studentIds = new Set<string>();
  for (const row of rows) {
    const student = mapQuizRecoveryStudent(row);
    const list = subjectMap.get(row.subject_title) ?? [];
    list.push(student);
    subjectMap.set(row.subject_title, list);
    studentIds.add(student.studentId);
  }

  const subjects: QuizRecoverySubjectCard[] = [...subjectMap.entries()]
    .map(([subjectTitle, students]) => ({
      subjectTitle,
      studentsNotAt100Count: students.length,
      students,
    }))
    .sort((a, b) => a.subjectTitle.localeCompare(b.subjectTitle));

  return {
    campus,
    subjects,
    totalSubjectsInRecovery: subjects.length,
    totalStudentsInRecovery: studentIds.size,
  };
}

export async function getQuizRecoveryStudents(
  campus: string,
  subject: string,
  semester: string,
  scope: SessionScope,
): Promise<QuizRecoveryStudent[]> {
  const params: Record<string, unknown> = { campus, subject };
  const attWhere = scopeClause(scope, params, { semester });
  const quizWhere = quizScopeClause(scope, params);
  const rows = await bqQuery<{
    student_user_id: string;
    student_name: string;
    batch_section_name: string | null;
    present_count: string;
    total_count: string;
    subject_pct: string;
    cq_avg: string | null;
    cq_completed: string;
    cq_total: string;
    mq_avg: string | null;
    mq_completed: string;
    mq_total: string;
  }>(
    `WITH quiz AS (
      SELECT
        user_id,
        ${quizPivotSelect()}
      FROM ${QUIZ_TABLE}
      WHERE (institute_name = @campus OR institute_name IS NULL)
        AND ${quizMatchesSubjectSql("@subject")}
        AND ${quizWhere}
      GROUP BY user_id
      HAVING ${quizFails100Sql("cq_completed", "cq_total", "cq_avg")}
          OR ${quizFails100Sql("mq_completed", "mq_total", "mq_avg")}
    ),
    att AS (
      SELECT
        student_user_id,
        MAX(student_name) AS student_name,
        MAX(batch_section_name) AS batch_section_name,
        COUNTIF(LOWER(attendance_status) = 'present') AS present_count,
        COUNT(*) AS total_count,
        SAFE_DIVIDE(COUNTIF(LOWER(attendance_status) = 'present'), COUNT(*)) * 100 AS subject_pct
      FROM ${ATTENDANCE_TABLE}
      WHERE ${attWhere}
        AND institute_name = @campus
        AND subject_title = @subject
        AND ${LECTURE_SESSION_EXCLUSIONS}
      GROUP BY student_user_id
    ),
    names AS (
      SELECT
        student_user_id,
        MAX(student_name) AS student_name,
        MAX(batch_section_name) AS batch_section_name
      FROM ${ATTENDANCE_TABLE}
      WHERE ${attWhere}
        AND institute_name = @campus
      GROUP BY student_user_id
    )
    SELECT
      CAST(quiz.user_id AS STRING) AS student_user_id,
      COALESCE(att.student_name, names.student_name, 'Unknown student') AS student_name,
      COALESCE(att.batch_section_name, names.batch_section_name) AS batch_section_name,
      IFNULL(att.present_count, 0) AS present_count,
      IFNULL(att.total_count, 0) AS total_count,
      IFNULL(att.subject_pct, 0) AS subject_pct,
      quiz.cq_avg,
      quiz.cq_completed,
      quiz.cq_total,
      quiz.mq_avg,
      quiz.mq_completed,
      quiz.mq_total
    FROM quiz
    LEFT JOIN att
      ON LOWER(REPLACE(CAST(quiz.user_id AS STRING), '-', ''))
       = LOWER(REPLACE(CAST(att.student_user_id AS STRING), '-', ''))
    LEFT JOIN names
      ON LOWER(REPLACE(CAST(quiz.user_id AS STRING), '-', ''))
       = LOWER(REPLACE(CAST(names.student_user_id AS STRING), '-', ''))
    ORDER BY student_name`,
    params,
  );

  return rows.map(mapQuizRecoveryStudent);
}

export interface RecoveryProgressSummary {
  campus: string;
  subject: string;
  totalTopics: number;
  topicsBelowThreshold: number;
  topicsRecovered: number;
  topicsRemaining: number;
  recoveryCompletionPct: number;
  sessionsHeld: number;
  sessionsCancelled: number;
  lastSession: { date: string; topics: string[] } | null;
  nextScheduled: { date: string; topics: string[] } | null;
}

export type SessionTrackerStatus =
  | "not_taught"
  | "completed"
  | "ok"
  | "needs_recovery"
  | "recovery_scheduled"
  | "recovered";

export interface SessionTrackerRow {
  sequenceNo: number;
  weekNo: number | null;
  topicTitle: string;
  unitId: string | null;
  attendancePct: number | null;
  presentCount: number | null;
  totalCount: number | null;
  status: SessionTrackerStatus;
  prodStatus: "pending" | "completed";
  completedAt: string | null;
  recoverySession: {
    id: string;
    date: string;
    instructorName: string;
    instructorType: "campus" | "backup" | "unknown";
    wasCovered: boolean | null;
  } | null;
}

export interface RecoveryTopicAttendance {
  presentCount: number;
  totalCount: number;
}

export interface ProdSequenceTopic {
  subjectTitle: string;
  topicTitle: string;
  firstDate: string;
  delivered: boolean;
}

/**
 * Every distinct completed lecture in the current semester for a campus,
 * grouped by subject and ordered by the date it was first scheduled — the
 * actual prod delivery order.
 */
export async function getProdSequence(
  campus: string,
): Promise<ProdSequenceTopic[]> {
  const rows = await bqQuery<{
    subject_title: string;
    topic_title: string;
    first_date: string;
    delivered: string;
  }>(
    `SELECT
       sched.course_title AS subject_title,
       sched.session_title AS topic_title,
       MIN(sched.session_start_datetime) AS first_date,
       MAX(IF(sched.session_status = 'COMPLETED', 1, 0)) AS delivered
     FROM ${PROD_SEQUENCE_TABLE} sched
    WHERE sched.institute_name = @campus
      AND sched.session_type = 'LECTURE'
       AND sched.session_status = 'COMPLETED'
       AND sched.is_current_semester = 1
    GROUP BY subject_title, topic_title
    ORDER BY subject_title, first_date`,
    { campus },
  );
  return rows.map((r) => ({
    subjectTitle: r.subject_title,
    topicTitle: r.topic_title,
    firstDate: r.first_date,
    delivered: String(r.delivered) === "1",
  }));
}

/**
 * Session titles BigQuery has actually marked COMPLETED for one campus and
 * subject right now. Lets the session tracker gate "not_taught" on real
 * delivery status instead of only on attendance rows existing.
 */
export async function getDeliveredTopicTitles(
  campus: string,
  subjectTitle: string,
): Promise<Set<string>> {
  const rows = await bqQuery<{ session_name: string }>(
    `SELECT DISTINCT sched.session_title AS session_name
     FROM ${PROD_SEQUENCE_TABLE} sched
     WHERE sched.institute_name = @campus
       AND sched.course_title = @subjectTitle
       AND sched.session_type = 'LECTURE'
       AND sched.session_status = 'COMPLETED'
       AND sched.is_current_semester = 1`,
    { campus, subjectTitle },
  );
  return new Set(rows.map((r) => r.session_name));
}

export async function getResolvedRecoverySessionTitles(
  campus: string,
  subject: string,
): Promise<Set<string>> {
  const rows = await db
    .select({ title: recoveryTopicsTable.bigquerySessionTitle })
    .from(recoveryTopicsTable)
    .where(
      and(
        eq(recoveryTopicsTable.campus, campus),
        eq(recoveryTopicsTable.subject, subject),
        eq(recoveryTopicsTable.isActive, true),
      ),
    );

  return new Set(
    rows.flatMap((row) => (row.title ? [row.title] : [])),
  );
}

export async function getSessionTracker(
  campus: string,
  subject: string,
  attendanceByTitle: ReadonlyMap<string, RecoveryTopicAttendance>,
  section?: string,
  /**
   * Session titles BigQuery has marked COMPLETED (see getDeliveredTopicTitles).
   * When omitted, "delivered" falls back to attendance rows existing, which
   * is how this behaved before the prod sequence table was available.
   */
  deliveredTitles?: ReadonlySet<string>,
): Promise<SessionTrackerRow[]> {
  const topics = await db
    .select({
      id: recoveryTopicsTable.id,
      sequenceNo: recoveryTopicsTable.sequenceNo,
      weekNo: recoveryTopicsTable.weekNo,
      topicTitle: recoveryTopicsTable.topicTitle,
      unitId: recoveryTopicsTable.unitId,
      bigquerySessionTitle: recoveryTopicsTable.bigquerySessionTitle,
    })
    .from(recoveryTopicsTable)
    .where(
      and(
        eq(recoveryTopicsTable.campus, campus),
        eq(recoveryTopicsTable.subject, subject),
        eq(recoveryTopicsTable.isActive, true),
      ),
    )
    .orderBy(asc(recoveryTopicsTable.sequenceNo));

  const progressRows = await db
    .select({
      topicId: recoveryProgressTable.topicId,
      status: recoveryProgressTable.status,
      section: recoveryProgressTable.section,
    })
    .from(recoveryProgressTable)
    .where(
      and(
        eq(recoveryProgressTable.campus, campus),
        eq(recoveryProgressTable.subject, subject),
        section
          ? or(
              isNull(recoveryProgressTable.section),
              eq(recoveryProgressTable.section, section),
            )
          : undefined,
      ),
    );

  const progressRank = { pending: 1, scheduled: 2, completed: 3 } as const;
  const progressByTopic = new Map<
    string,
    { status: keyof typeof progressRank; score: number }
  >();
  for (const row of progressRows) {
    const score =
      progressRank[row.status] + (section && row.section === section ? 10 : 0);
    const current = progressByTopic.get(row.topicId);
    if (!current || score > current.score) {
      progressByTopic.set(row.topicId, { status: row.status, score });
    }
  }

  const recoveryRows = await db
    .select({
      topicId: sessionTopicsTable.topicId,
      id: recoverySessionsTable.id,
      date: recoverySessionsTable.scheduledDate,
      instructorName: recoverySessionsTable.instructorName,
      instructorType: recoverySessionsTable.instructorType,
      wasCovered: sessionTopicsTable.wasCovered,
      sessionStatus: recoverySessionsTable.status,
      section: recoverySessionsTable.section,
    })
    .from(sessionTopicsTable)
    .innerJoin(
      recoverySessionsTable,
      eq(recoverySessionsTable.id, sessionTopicsTable.sessionId),
    )
    .where(
      and(
        eq(recoverySessionsTable.campus, campus),
        eq(recoverySessionsTable.subject, subject),
        section
          ? or(
              isNull(recoverySessionsTable.section),
              eq(recoverySessionsTable.section, section),
            )
          : undefined,
      ),
    )
    .orderBy(
      desc(recoverySessionsTable.scheduledDate),
      desc(recoverySessionsTable.createdAt),
    );

  const recoveryByTopic = new Map<string, typeof recoveryRows>();
  for (const row of recoveryRows) {
    const rows = recoveryByTopic.get(row.topicId) ?? [];
    rows.push(row);
    recoveryByTopic.set(row.topicId, rows);
  }

  return topics.map((topic) => {
    const attendance = topic.bigquerySessionTitle
      ? attendanceByTitle.get(topic.bigquerySessionTitle)
      : undefined;
    const hasAttendance = Boolean(attendance && attendance.totalCount > 0);
    const delivered = deliveredTitles
      ? Boolean(
          topic.bigquerySessionTitle &&
            deliveredTitles.has(topic.bigquerySessionTitle),
        )
      : hasAttendance;
    const attendancePct =
      attendance && attendance.totalCount > 0
        ? Math.round(
            (attendance.presentCount / attendance.totalCount) * 1000,
          ) / 10
        : null;
    const progressStatus = progressByTopic.get(topic.id)?.status;

    let status: SessionTrackerStatus;
    if (!delivered || attendancePct === null) {
      status = "not_taught";
    } else if (attendancePct >= 80) {
      status = "ok";
    } else if (progressStatus === "completed") {
      status = "recovered";
    } else if (progressStatus === "scheduled") {
      status = "recovery_scheduled";
    } else {
      status = "needs_recovery";
    }

    const candidateRows = (recoveryByTopic.get(topic.id) ?? [])
      .filter((row) =>
        ["planned", "conducted", "partial"].includes(row.sessionStatus),
      )
      .sort((left, right) => {
        if (!section) return 0;
        return Number(right.section === section) - Number(left.section === section);
      });
    const recovery =
      (progressStatus === "scheduled"
        ? candidateRows.find((row) => row.sessionStatus === "planned")
        : progressStatus === "completed"
          ? candidateRows.find(
              (row) =>
                row.wasCovered === true &&
                ["conducted", "partial"].includes(row.sessionStatus),
            )
          : undefined) ?? candidateRows[0];

    return {
      sequenceNo: topic.sequenceNo,
      weekNo: topic.weekNo,
      topicTitle: topic.topicTitle,
      unitId: topic.unitId,
      attendancePct,
      presentCount: hasAttendance ? attendance!.presentCount : null,
      totalCount: hasAttendance ? attendance!.totalCount : null,
      status,
      prodStatus: delivered ? "completed" : "pending",
      completedAt: null,
      recoverySession: recovery
        ? {
            id: recovery.id,
            date: recovery.date,
            instructorName: recovery.instructorName,
            instructorType: recovery.instructorType,
            wasCovered: recovery.wasCovered,
          }
        : null,
    };
  });
}

/**
 * Builds the tracker from the live production schedule rather than requiring
 * a Postgres recovery curriculum. Recovery metadata is overlaid when the
 * subject has a seeded recovery curriculum, but the production rows are the
 * source of truth for every college and subject.
 */
export async function getProdSequenceSessionTracker(
  campus: string,
  subject: string,
  attendanceByTitle: ReadonlyMap<string, RecoveryTopicAttendance>,
  section?: string,
  semester?: string,
  recoverySubject?: string,
): Promise<SessionTrackerRow[]> {
  const sequence = await getSubjectProdSequence(
    campus,
    subject,
    semester,
    section,
    "LECTURE",
  );
  const recoveryRows = recoverySubject
    ? await getSessionTracker(
        campus,
        recoverySubject,
        attendanceByTitle,
        section,
      )
    : [];
  const recoveryByTitle = new Map(
    recoveryRows.map((row) => [row.topicTitle, row]),
  );

  return sequence.map((item) => {
    const attendance = attendanceByTitle.get(item.topicTitle);
    const attendancePct =
      attendance && attendance.totalCount > 0
        ? Math.round((attendance.presentCount / attendance.totalCount) * 1000) /
          10
        : null;
    const recovery = recoveryByTitle.get(item.topicTitle);
    const status: SessionTrackerStatus =
      recovery?.status === "recovered" ? "completed" : "needs_recovery";

    return {
      sequenceNo: item.order,
      weekNo: item.week,
      topicTitle: item.topicTitle,
      unitId: recovery?.unitId ?? null,
      attendancePct,
      presentCount: attendance?.presentCount ?? null,
      totalCount: attendance?.totalCount ?? null,
      status,
      prodStatus: item.completed ? "completed" : "pending",
      completedAt: item.completedAt,
      recoverySession: recovery?.recoverySession ?? null,
    };
  });
}

/**
 * Recovery progress for one campus and curriculum subject.
 *
 * The caller supplies the below-threshold topic count from BigQuery so this
 * database query does not repeat a warehouse request on the dashboard path.
 */
export async function getRecoveryProgress(
  campus: string,
  subject: string,
  topicsBelowThreshold: number,
): Promise<RecoveryProgressSummary> {
  const scope = and(
    eq(recoveryTopicsTable.campus, campus),
    eq(recoveryTopicsTable.subject, subject),
    eq(recoveryTopicsTable.isActive, true),
  );

  const [counts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      recovered:
        sql<number>`count(*) filter (where ${recoveryProgressTable.status} = 'completed')::int`,
    })
    .from(recoveryTopicsTable)
    .leftJoin(
      recoveryProgressTable,
      eq(recoveryProgressTable.topicId, recoveryTopicsTable.id),
    )
    .where(scope);

  const [sessions] = await db
    .select({
      held:
        sql<number>`count(*) filter (where ${recoverySessionsTable.status} in ('conducted', 'partial'))::int`,
      cancelled:
        sql<number>`count(*) filter (where ${recoverySessionsTable.status} in ('cancelled', 'no_show'))::int`,
    })
    .from(recoverySessionsTable)
    .where(
      and(
        eq(recoverySessionsTable.campus, campus),
        eq(recoverySessionsTable.subject, subject),
      ),
    );

  const [last] = await db
    .select({
      id: recoverySessionsTable.id,
      date: recoverySessionsTable.scheduledDate,
    })
    .from(recoverySessionsTable)
    .where(
      and(
        eq(recoverySessionsTable.campus, campus),
        eq(recoverySessionsTable.subject, subject),
        inArray(recoverySessionsTable.status, ["conducted", "partial"]),
      ),
    )
    .orderBy(desc(recoverySessionsTable.scheduledDate))
    .limit(1);

  const today = new Date().toISOString().slice(0, 10);
  const [next] = await db
    .select({
      id: recoverySessionsTable.id,
      date: recoverySessionsTable.scheduledDate,
    })
    .from(recoverySessionsTable)
    .where(
      and(
        eq(recoverySessionsTable.campus, campus),
        eq(recoverySessionsTable.subject, subject),
        eq(recoverySessionsTable.status, "planned"),
        gte(recoverySessionsTable.scheduledDate, today),
      ),
    )
    .orderBy(asc(recoverySessionsTable.scheduledDate))
    .limit(1);

  async function topicsFor(sessionId: string | undefined): Promise<string[]> {
    if (!sessionId) return [];
    const rows = await db
      .select({ title: recoveryTopicsTable.topicTitle })
      .from(sessionTopicsTable)
      .innerJoin(
        recoveryTopicsTable,
        eq(recoveryTopicsTable.id, sessionTopicsTable.topicId),
      )
      .where(eq(sessionTopicsTable.sessionId, sessionId))
      .orderBy(asc(sessionTopicsTable.orderInSession));
    return rows.map((row) => row.title);
  }

  const recovered = counts?.recovered ?? 0;
  return {
    campus,
    subject,
    totalTopics: counts?.total ?? 0,
    topicsBelowThreshold,
    topicsRecovered: recovered,
    topicsRemaining: Math.max(topicsBelowThreshold - recovered, 0),
    recoveryCompletionPct:
      topicsBelowThreshold > 0
        ? Math.round((recovered / topicsBelowThreshold) * 1000) / 10
        : 0,
    sessionsHeld: sessions?.held ?? 0,
    sessionsCancelled: sessions?.cancelled ?? 0,
    lastSession: last
      ? { date: last.date, topics: await topicsFor(last.id) }
      : null,
    nextScheduled: next
      ? { date: next.date, topics: await topicsFor(next.id) }
      : null,
  };
}

/*
export type SessionTrackerStatus =
  | "not_taught"
  | "ok"
  | "needs_recovery"
  | "recovery_scheduled"
  | "recovered";

export interface SessionTrackerAttendance {
  presentCount: number;
  totalCount: number;
}

export interface SessionTrackerRow {
  sequenceNo: number;
  weekNo: number | null;
  topicTitle: string;
  unitId: string | null;
  attendancePct: number | null;
  presentCount: number;
  totalCount: number;
  status: SessionTrackerStatus;
  recoverySession: {
    date: string;
    instructorName: string;
    instructorType: "campus" | "backup" | "unknown";
    wasCovered: boolean | null;
  } | null;
}

/**
 * Combines the ordered Postgres recovery curriculum with already-aggregated
 * BigQuery attendance. Recovery delivery fields come only from recovery
 * sessions; regular-class instructors are deliberately not substituted.
 * /
export async function getRecoverySessionTracker(
  campus: string,
  subject: string,
  attendanceByTitle: ReadonlyMap<string, SessionTrackerAttendance>,
  section?: string,
): Promise<SessionTrackerRow[]> {
  const [topics, progressRows, sessionRows] = await Promise.all([
    db
      .select({
        id: recoveryTopicsTable.id,
        sequenceNo: recoveryTopicsTable.sequenceNo,
        weekNo: recoveryTopicsTable.weekNo,
        topicTitle: recoveryTopicsTable.topicTitle,
        unitId: recoveryTopicsTable.unitId,
        bigquerySessionTitle: recoveryTopicsTable.bigquerySessionTitle,
      })
      .from(recoveryTopicsTable)
      .where(
        and(
          eq(recoveryTopicsTable.campus, campus),
          eq(recoveryTopicsTable.subject, subject),
          eq(recoveryTopicsTable.isActive, true),
        ),
      )
      .orderBy(asc(recoveryTopicsTable.sequenceNo)),
    db
      .select({
        topicId: recoveryProgressTable.topicId,
        section: recoveryProgressTable.section,
        status: recoveryProgressTable.status,
      })
      .from(recoveryProgressTable)
      .where(
        and(
          eq(recoveryProgressTable.campus, campus),
          eq(recoveryProgressTable.subject, subject),
        ),
      ),
    db
      .select({
        topicId: sessionTopicsTable.topicId,
        wasCovered: sessionTopicsTable.wasCovered,
        section: recoverySessionsTable.section,
        date: recoverySessionsTable.scheduledDate,
        instructorName: recoverySessionsTable.instructorName,
        instructorType: recoverySessionsTable.instructorType,
      })
      .from(sessionTopicsTable)
      .innerJoin(
        recoverySessionsTable,
        eq(recoverySessionsTable.id, sessionTopicsTable.sessionId),
      )
      .where(
        and(
          eq(recoverySessionsTable.campus, campus),
          eq(recoverySessionsTable.subject, subject),
        ),
      )
      .orderBy(desc(recoverySessionsTable.scheduledDate)),
  ]);

  const progressPriority = { pending: 1, scheduled: 2, completed: 3 } as const;
  const progressByTopic = new Map<
    string,
    (typeof progressRows)[number]["status"]
  >();
  for (const row of progressRows) {
    if (section && row.section !== null && row.section !== section) continue;
    const current = progressByTopic.get(row.topicId);
    if (!current || progressPriority[row.status] > progressPriority[current]) {
      progressByTopic.set(row.topicId, row.status);
    }
  }

  const recoverySessionByTopic = new Map<
    string,
    SessionTrackerRow["recoverySession"]
  >();
  for (const row of sessionRows) {
    if (section && row.section !== null && row.section !== section) continue;
    if (recoverySessionByTopic.has(row.topicId)) continue;
    recoverySessionByTopic.set(row.topicId, {
      date: row.date,
      instructorName: row.instructorName,
      instructorType: row.instructorType,
      wasCovered: row.wasCovered,
    });
  }

  return topics.map((topic) => {
    const attendance = topic.bigquerySessionTitle
      ? attendanceByTitle.get(topic.bigquerySessionTitle)
      : undefined;
    const presentCount = attendance?.presentCount ?? 0;
    const totalCount = attendance?.totalCount ?? 0;
    const attendancePct =
      totalCount > 0
        ? Math.round((presentCount / totalCount) * 1000) / 10
        : null;
    const progress = progressByTopic.get(topic.id);

    let status: SessionTrackerStatus;
    if (attendancePct === null) status = "not_taught";
    else if (attendancePct >= 80) status = "ok";
    else if (progress === "completed") status = "recovered";
    else if (progress === "scheduled") status = "recovery_scheduled";
    else status = "needs_recovery";

    return {
      sequenceNo: topic.sequenceNo,
      weekNo: topic.weekNo,
      topicTitle: topic.topicTitle,
      unitId: topic.unitId,
      attendancePct,
      presentCount,
      totalCount,
      status,
      recoverySession: recoverySessionByTopic.get(topic.id) ?? null,
    };
  });
}
*/

export async function getCampusList(): Promise<string[]> {
  const rows = await bqQuery<{ institute_name: string }>(
    `SELECT DISTINCT institute_name FROM ${ATTENDANCE_TABLE} WHERE is_current_semester = 1 ORDER BY institute_name`,
  );
  return rows.map((r) => r.institute_name).filter(Boolean);
}

export interface Institution {
  instituteId: string | null;
  instituteName: string;
}

// Distinct institutions from live BigQuery attendance data, keyed by name
// (the scope filter matches on institute_name). institute_id is returned
// alongside for display / uniqueness. One row per institute_name; if a name
// maps to multiple ids we keep the first id seen.
export async function getInstitutions(): Promise<Institution[]> {
  const rows = await bqQuery<{
    institute_id: string | null;
    institute_name: string;
  }>(
    `SELECT
       ANY_VALUE(institute_id) AS institute_id,
       institute_name
     FROM ${ATTENDANCE_TABLE}
     WHERE is_current_semester = 1 AND institute_name IS NOT NULL
     GROUP BY institute_name
     ORDER BY institute_name`,
  );
  return rows
    .filter((r) => Boolean(r.institute_name))
    .map((r) => ({
      instituteId: r.institute_id ?? null,
      instituteName: r.institute_name,
    }));
}

// Distinct subject titles from live BigQuery attendance data.
export async function getSubjectList(): Promise<string[]> {
  const rows = await bqQuery<{ subject_title: string }>(
    `SELECT DISTINCT subject_title
     FROM ${ATTENDANCE_TABLE}
     WHERE is_current_semester = 1 AND subject_title IS NOT NULL
     ORDER BY subject_title`,
  );
  return rows.map((r) => r.subject_title).filter(Boolean);
}

export interface QuizItem {
  subjectTitle: string;
  title: string;
  score: number;
  maxScore: number;
  percentage: number;
  status: string;
  date: string | null;
}

export interface QuizSummary {
  attempted: number;
  total: number;
  avgPct: number;
}

export interface StudentQuizzes {
  classroomQuizzes: QuizItem[];
  moduleQuizzes: QuizItem[];
  classroomSummary: QuizSummary;
  moduleSummary: QuizSummary;
}

// Real quiz table schema (z_niat_students_classroom_and_module_quiz_details):
//   institute_name, section_name, user_id, course_id, course_title,
//   derived_unit_type (CLASSROOM_QUIZ | MODULE_QUIZ), total_quizzes,
//   total_completed_quizzes, avg_best_attempt_percentage_score, semester_course_title
// This is an aggregated table: one row per (student, course, unit_type).
export async function getStudentQuizzes(
  studentId: string,
): Promise<StudentQuizzes> {
  if (!validateStudentId.test(studentId)) {
    return {
      classroomQuizzes: [],
      moduleQuizzes: [],
      classroomSummary: { attempted: 0, total: 0, avgPct: 0 },
      moduleSummary: { attempted: 0, total: 0, avgPct: 0 },
    };
  }

  const rows = await bqQuery<{
    semester_course_title: string | null;
    course_title: string | null;
    derived_unit_type: string | null;
    total_quizzes: string | null;
    total_completed_quizzes: string | null;
    avg_best_attempt_percentage_score: string | null;
  }>(
    `SELECT
      semester_course_title,
      course_title,
      derived_unit_type,
      total_quizzes,
      total_completed_quizzes,
      avg_best_attempt_percentage_score
    FROM ${QUIZ_TABLE}
    WHERE ${studentIdMatch('user_id')}
    ORDER BY semester_course_title, course_title`,
    { studentId: normalizeStudentId(studentId) },
  );

  const classroomQuizzes: QuizItem[] = [];
  const moduleQuizzes: QuizItem[] = [];

  for (const r of rows) {
    const completed = Number(r.total_completed_quizzes ?? 0);
    const total = Number(r.total_quizzes ?? 0);
    const rawPct =
      r.avg_best_attempt_percentage_score === null ||
      r.avg_best_attempt_percentage_score === undefined
        ? null
        : Number(r.avg_best_attempt_percentage_score);
    const percentage = rawPct === null ? 0 : Math.round(rawPct * 10) / 10;

    const item: QuizItem = {
      subjectTitle: r.semester_course_title ?? "",
      title: r.course_title ?? "",
      score: completed,
      maxScore: total,
      percentage,
      status: completed > 0 ? "Attempted" : "Pending",
      date: null,
    };

    const unitType = String(r.derived_unit_type ?? "").toUpperCase();
    if (unitType.includes("MODULE")) {
      moduleQuizzes.push(item);
    } else {
      classroomQuizzes.push(item);
    }
  }

  const calcSummary = (items: QuizItem[]): QuizSummary => {
    const attempted = items.reduce((s, q) => s + q.score, 0);
    const total = items.reduce((s, q) => s + q.maxScore, 0);
    // Average all course rows. Unattempted (Pending) courses count as 0% (Ab).
    const avgPct =
      items.length > 0
        ? Math.round(
            (items.reduce((s, q) => s + q.percentage, 0) / items.length) * 10,
          ) / 10
        : 0;
    return { attempted, total, avgPct };
  };

  return {
    classroomQuizzes,
    moduleQuizzes,
    classroomSummary: calcSummary(classroomQuizzes),
    moduleSummary: calcSummary(moduleQuizzes),
  };
}
