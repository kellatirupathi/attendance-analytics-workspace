import {
  bqQuery,
  pct,
  PROD_SEQUENCE_TABLE,
  INSTRUCTOR_DETAILS_TABLE,
  BQ_LOCATION,
  BQ_HEAVY_QUERY_TIMEOUT_MS,
  validateStudentId,
  normalizeStudentId,
} from "./bigquery.js";
import {
  db,
  recoveryProgressTable,
  recoverySessionsTable,
  recoveryTopicsTable,
  sessionTopicsTable,
  usersTable,
  type RecoverySession,
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
import {
  excludeInstituteSql,
  isExcludedInstitute,
} from "./excludedInstitutes.js";

/**
 * Matches a student id column against @studentId regardless of UUID hyphens.
 * The warehouse is inconsistent: the attendance table stores hyphenated
 * UUIDs while the quiz table stores bare hex, and SPI links can carry either.
 */
function studentIdMatch(column: string): string {
  return `LOWER(REPLACE(CAST(${column} AS STRING), '-', '')) = @studentId`;
}

const ATTENDANCE_TABLE =
  "`kossip-helpers.niat_post_onboarding_engagement_ai_analytics_workspace.niat_students_overall_attendance_details`";
const QUIZ_TABLE =
  "`kossip-helpers.niat_post_onboarding_engagement_ai_analytics_workspace.z_niat_students_classroom_and_module_quiz_details`";

/**
 * SPI attendance: sessions attended / sessions scheduled.
 * Attended = PRESENT. Scheduled = every student-session row, including
 * ABSENT and OFF_DAY. Lecture, MCQ practice, and module quiz slots all count.
 */
const ATTENDED_SQL = `UPPER(attendance_status) = 'PRESENT'`;

/**
 * This table has entity_type + time, not session_title. Although BigQuery's
 * INFORMATION_SCHEMA currently advertises session_type, querying it fails;
 * real rows expose entity_type instead.
 * Keep the alias so existing APIs and the UI still receive sessionTitle.
 */
const SESSION_TITLE_SQL = `TRIM(CONCAT(
  COALESCE(NULLIF(CAST(entity_type AS STRING), ''), 'SESSION'),
  IF(
    session_start_end_time IS NULL OR TRIM(CAST(session_start_end_time AS STRING)) = '',
    '',
    CONCAT(' · ', CAST(session_start_end_time AS STRING))
  )
))`;

/**
 * One class held: session_id when present, then entity_id, otherwise the
 * display label plus date, scoped by subject so campus rollups do not collapse
 * two subjects.
 * Never use COUNT(*) for "total sessions" — that is student×session rows.
 */
const SESSION_IDENTITY_SQL = `CONCAT(
  COALESCE(subject_title, ''),
  '|',
  COALESCE(
    NULLIF(CAST(session_id AS STRING), ''),
    NULLIF(CAST(entity_id AS STRING), ''),
    ${SESSION_TITLE_SQL}
  ),
  '|',
  COALESCE(CAST(DATE(date) AS STRING), '')
)`;

interface AttendanceRollupRow {
  student_count: string;
  present_student_count: string;
  session_count: string;
  present_record_count: string;
  total_record_count: string;
}

function mapAttendanceRollup(r: AttendanceRollupRow) {
  const studentCount = Number(r.student_count);
  const presentCount = Number(r.present_student_count);
  const sessionCount = Number(r.session_count);
  const presentRecordCount = Number(r.present_record_count);
  const totalRecordCount = Number(r.total_record_count);
  // SPI attendance: sessions attended / sessions scheduled.
  const spiPct = pct(presentRecordCount, totalRecordCount);
  return {
    studentCount,
    presentCount,
    totalCount: sessionCount,
    pct: spiPct,
    presentRecordCount,
    totalRecordCount,
    recordPct: spiPct,
  };
}

function scopeClause(
  scope: SessionScope,
  params: Record<string, unknown>,
  options: { semester?: string; currentSemester?: boolean } = {},
): string {
  const clauses: string[] = [excludeInstituteSql()];
  if (options.semester) {
    clauses.push("semester_title = @semester");
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
  return getAttendanceSemesters(scope, campus);
}

/** Distinct academic semesters in attendance data. Campus is optional. */
export async function getAttendanceSemesters(
  scope: SessionScope,
  campus?: string,
): Promise<string[]> {
  const params: Record<string, unknown> = {};
  const where = scopeClause(scope, params, { currentSemester: false });
  let campusFilter = "";
  if (campus) {
    params["campus"] = campus;
    campusFilter = " AND institute_name = @campus";
  }
  const rows = await bqQuery<{ semester: string }>(
    `SELECT DISTINCT TRIM(semester_title) AS semester
     FROM ${ATTENDANCE_TABLE}
     WHERE ${where}${campusFilter}
       AND semester_title IS NOT NULL
       AND TRIM(semester_title) != ''
     ORDER BY semester`,
    params,
    BQ_LOCATION,
    BQ_HEAVY_QUERY_TIMEOUT_MS,
  );

  return rows
    .map((row) => row.semester)
    .sort((left, right) =>
      right.localeCompare(left, undefined, { numeric: true, sensitivity: "base" }),
    );
}

export function parseSemester(
  q: Record<string, string | undefined>,
): string | undefined {
  const value = q["semester"]?.trim();
  return value || undefined;
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

/** TRUE when no date filter; otherwise the date predicate (no leading AND). */
function dateWindowPredicate(
  range: DateRangeFilter | undefined,
  params: Record<string, unknown>,
): string {
  const clause = dateRangeClause(range, params);
  return clause ? clause.replace(/^\s*AND\s+/, "") : "TRUE";
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
      COUNTIF(${ATTENDED_SQL}) AS present_count,
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
          COUNTIF(${ATTENDED_SQL}) OVER (PARTITION BY student_user_id, subject_title),
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
      COUNTIF(${ATTENDED_SQL}) AS present,
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
      ${SESSION_TITLE_SQL} AS session_title,
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
      COUNTIF(${ATTENDED_SQL}) AS present,
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
  const pct = `SAFE_DIVIDE(COUNTIF(${ATTENDED_SQL}), COUNT(*)) * 100`;
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
    params["filterCampus"] = opts.campus.trim();
    sectionCampusFilter = "AND TRIM(institute_name) = @filterCampus";
  }

  const [campusRows, sectionRows] = await Promise.all([
    bqQuery<{ institute_name: string }>(
      `SELECT DISTINCT institute_name
       FROM ${ATTENDANCE_TABLE}
       WHERE ${where} AND institute_name IS NOT NULL
       ORDER BY institute_name`,
      params,
      BQ_LOCATION,
      BQ_HEAVY_QUERY_TIMEOUT_MS,
    ),
    bqQuery<{ batch_section_name: string }>(
      `SELECT DISTINCT batch_section_name
       FROM ${ATTENDANCE_TABLE}
       WHERE ${where} ${sectionCampusFilter}
         AND batch_section_name IS NOT NULL
       ORDER BY batch_section_name`,
      params,
      BQ_LOCATION,
      BQ_HEAVY_QUERY_TIMEOUT_MS,
    ),
  ]);

  return {
    campuses: campusRows
      .map((r) => r.institute_name)
      .filter((name) => !isExcludedInstitute(name)),
    sections: sectionRows.map((r) => r.batch_section_name),
    updatedAt: new Date().toISOString(),
  };
}

export interface InstituteSemesterRow {
  semesterTitle: string;
  isCurrent: boolean;
  subjectCount: number;
  sectionCount: number;
  studentCount: number;
  subjects: string[];
  sections: string[];
}

export interface InstituteDirectoryItem {
  instituteName: string;
  currentSemesters: string[];
  semesterCount: number;
  subjectCount: number;
  sectionCount: number;
  studentCount: number;
  semesters: InstituteSemesterRow[];
}

function splitPackedList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split("|||")
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Staff directory of institutes: which semesters are running, and per
 * semester the subject list, sections, and distinct student count.
 * Includes every semester in attendance data (not only current).
 */
export async function getInstituteDirectory(
  scope: SessionScope,
  opts: { campus?: string } = {},
): Promise<InstituteDirectoryItem[]> {
  const params: Record<string, unknown> = {};
  const where = scopeClause(scope, params, { currentSemester: false });
  let campusFilter = "";
  if (opts.campus) {
    params["filterCampus"] = opts.campus;
    campusFilter = " AND institute_name = @filterCampus";
  }
  const rows = await bqQuery<{
    institute_name: string;
    semester: string;
    is_current: string;
    subject_count: string;
    section_count: string;
    student_count: string;
    subjects: string | null;
    sections: string | null;
  }>(
    `SELECT
      institute_name,
      TRIM(CAST(semester_title AS STRING)) AS semester,
      CAST(MAX(is_current_semester) AS INT64) AS is_current,
      COUNT(DISTINCT subject_title) AS subject_count,
      COUNT(DISTINCT batch_section_name) AS section_count,
      COUNT(DISTINCT student_user_id) AS student_count,
      ARRAY_TO_STRING(
        ARRAY_AGG(DISTINCT subject_title IGNORE NULLS ORDER BY subject_title),
        '|||'
      ) AS subjects,
      ARRAY_TO_STRING(
        ARRAY_AGG(DISTINCT batch_section_name IGNORE NULLS ORDER BY batch_section_name),
        '|||'
      ) AS sections
     FROM ${ATTENDANCE_TABLE}
     WHERE ${where}${campusFilter}
       AND institute_name IS NOT NULL
       AND TRIM(institute_name) != ''
       AND semester_title IS NOT NULL
       AND TRIM(CAST(semester_title AS STRING)) != ''
     GROUP BY institute_name, semester
     ORDER BY institute_name, semester`,
    params,
    BQ_LOCATION,
    BQ_HEAVY_QUERY_TIMEOUT_MS,
  );

  const byInstitute = new Map<string, InstituteSemesterRow[]>();
  for (const row of rows) {
    const semester: InstituteSemesterRow = {
      semesterTitle: row.semester,
      isCurrent: Number(row.is_current) === 1,
      subjectCount: Number(row.subject_count),
      sectionCount: Number(row.section_count),
      studentCount: Number(row.student_count),
      subjects: splitPackedList(row.subjects),
      sections: splitPackedList(row.sections),
    };
    const list = byInstitute.get(row.institute_name) ?? [];
    list.push(semester);
    byInstitute.set(row.institute_name, list);
  }

  return [...byInstitute.entries()].filter(([instituteName]) => !isExcludedInstitute(instituteName)).map(([instituteName, semesters]) => {
    const subjects = new Set<string>();
    const sections = new Set<string>();
    let studentCount = 0;
    for (const semester of semesters) {
      semester.subjects.forEach((title) => subjects.add(title));
      semester.sections.forEach((name) => sections.add(name));
      studentCount += semester.studentCount;
    }
    return {
      instituteName,
      currentSemesters: semesters
        .filter((semester) => semester.isCurrent)
        .map((semester) => semester.semesterTitle),
      semesterCount: semesters.length,
      subjectCount: subjects.size,
      sectionCount: sections.size,
      studentCount,
      semesters,
    };
  });
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
    semester?: string;
  } = {},
): Promise<StudentSearchResult[]> {
  const params: Record<string, unknown> = {};
  const where =
    scopeClause(scope, params, { semester: opts.semester }) +
    dateRangeClause(opts.dateRange, params);
  const safeLimit = Math.min(opts.limit ?? 1000, 5000);
  let searchFilter = "";
  if (opts.search) {
    params["q"] = `%${opts.search}%`;
    searchFilter =
      "AND (LOWER(student_name) LIKE LOWER(@q) OR LOWER(CAST(student_user_id AS STRING)) LIKE LOWER(@q))";
  }
  let dimensionFilter = "";
  if (opts.campus) {
    params["campus"] = opts.campus.trim();
    dimensionFilter += " AND TRIM(institute_name) = @campus";
  }
  if (opts.section) {
    params["section"] = opts.section.trim();
    dimensionFilter +=
      " AND COALESCE(NULLIF(TRIM(batch_section_name), ''), 'Unassigned') = @section";
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
        COUNTIF(${ATTENDED_SQL}) AS present,
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
        att.student_user_id,
        AVG(IF(UPPER(q.derived_unit_type) LIKE '%MODULE%', NULL,
          IFNULL(SAFE_CAST(q.avg_best_attempt_percentage_score AS FLOAT64), 0))) AS classroom_avg,
        AVG(IF(UPPER(q.derived_unit_type) LIKE '%MODULE%',
          IFNULL(SAFE_CAST(q.avg_best_attempt_percentage_score AS FLOAT64), 0), NULL)) AS module_avg
      FROM att
      INNER JOIN ${QUIZ_TABLE} q
        ON LOWER(REPLACE(CAST(q.user_id AS STRING), '-', ''))
         = LOWER(REPLACE(CAST(att.student_user_id AS STRING), '-', ''))
      GROUP BY att.student_user_id
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
    LEFT JOIN quiz USING (student_user_id)
    ORDER BY SAFE_DIVIDE(att.present, att.total) ASC
    LIMIT ${safeLimit}`,
    params,
    BQ_LOCATION,
    BQ_HEAVY_QUERY_TIMEOUT_MS,
  );
  const round1 = (v: string | null): number | null => {
    if (v === null || v === undefined) return null;
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(n * 10) / 10 : null;
  };
  return rows.filter((r) => !isExcludedInstitute(r.institute_name)).map((r) => {
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

/** Official SPI points 0–10 from classroom/module only (skill/final stubbed as 0). */
const SPI_POINTS_SQL = `(
  (IFNULL(classroom_avg, 0) * 10 + IFNULL(module_avg, 0) * 15) / 100.0
) / 10.0`;

export interface SpiCampusAverage {
  instituteName: string;
  avgSpiPoints: number;
  studentCount: number;
  sectionCount: number;
}

export interface SpiSectionAverage {
  sectionName: string;
  avgSpiPoints: number;
  studentCount: number;
}

/**
 * Campus-level mean SPI without shipping every student row to the client.
 * Quiz is joined only to roster students (not a full quiz table pre-aggregate).
 */
export async function getSpiAveragesByCampus(
  scope: SessionScope,
  opts: { semester?: string } = {},
): Promise<SpiCampusAverage[]> {
  const params: Record<string, unknown> = {};
  const where = scopeClause(scope, params, { semester: opts.semester });
  const rows = await bqQuery<{
    institute_name: string;
    avg_spi_points: string;
    student_count: string;
    section_count: string;
  }>(
    `WITH roster AS (
      SELECT
        student_user_id,
        TRIM(institute_name) AS institute_name,
        COALESCE(NULLIF(TRIM(batch_section_name), ''), 'Unassigned') AS section_name
      FROM ${ATTENDANCE_TABLE}
      WHERE ${where}
        AND institute_name IS NOT NULL
        AND TRIM(institute_name) != ''
    ),
    students AS (
      SELECT DISTINCT student_user_id, institute_name
      FROM roster
    ),
    quiz AS (
      SELECT
        students.student_user_id,
        AVG(IF(UPPER(q.derived_unit_type) LIKE '%MODULE%', NULL,
          IFNULL(SAFE_CAST(q.avg_best_attempt_percentage_score AS FLOAT64), 0))) AS classroom_avg,
        AVG(IF(UPPER(q.derived_unit_type) LIKE '%MODULE%',
          IFNULL(SAFE_CAST(q.avg_best_attempt_percentage_score AS FLOAT64), 0), NULL)) AS module_avg
      FROM students
      INNER JOIN ${QUIZ_TABLE} q
        ON LOWER(REPLACE(CAST(q.user_id AS STRING), '-', ''))
         = LOWER(REPLACE(CAST(students.student_user_id AS STRING), '-', ''))
      GROUP BY students.student_user_id
    ),
    scored AS (
      SELECT
        students.institute_name,
        students.student_user_id,
        ${SPI_POINTS_SQL} AS spi_points
      FROM students
      LEFT JOIN quiz USING (student_user_id)
    ),
    sections AS (
      SELECT
        institute_name,
        COUNT(DISTINCT section_name) AS section_count
      FROM roster
      GROUP BY institute_name
    )
    SELECT
      scored.institute_name,
      AVG(scored.spi_points) AS avg_spi_points,
      COUNT(*) AS student_count,
      ANY_VALUE(sections.section_count) AS section_count
    FROM scored
    LEFT JOIN sections USING (institute_name)
    GROUP BY scored.institute_name
    ORDER BY scored.institute_name`,
    params,
    BQ_LOCATION,
    BQ_HEAVY_QUERY_TIMEOUT_MS,
  );
  return rows.filter((r) => !isExcludedInstitute(r.institute_name)).map((r) => ({
    instituteName: r.institute_name,
    avgSpiPoints: Number.isFinite(Number(r.avg_spi_points))
      ? Math.round(Number(r.avg_spi_points) * 10) / 10
      : 0,
    studentCount: Number(r.student_count),
    sectionCount: Number(r.section_count),
  }));
}

/**
 * Section-level mean SPI for one campus (Reports section drill).
 */
export async function getSpiAveragesBySection(
  scope: SessionScope,
  opts: { campus: string; semester?: string },
): Promise<SpiSectionAverage[]> {
  const params: Record<string, unknown> = { campus: opts.campus.trim() };
  const where =
    scopeClause(scope, params, { semester: opts.semester }) +
    " AND TRIM(institute_name) = @campus";
  const rows = await bqQuery<{
    section_name: string;
    avg_spi_points: string;
    student_count: string;
  }>(
    `WITH roster AS (
      SELECT DISTINCT
        student_user_id,
        COALESCE(NULLIF(TRIM(batch_section_name), ''), 'Unassigned') AS section_name
      FROM ${ATTENDANCE_TABLE}
      WHERE ${where}
    ),
    quiz AS (
      SELECT
        roster.student_user_id,
        AVG(IF(UPPER(q.derived_unit_type) LIKE '%MODULE%', NULL,
          IFNULL(SAFE_CAST(q.avg_best_attempt_percentage_score AS FLOAT64), 0))) AS classroom_avg,
        AVG(IF(UPPER(q.derived_unit_type) LIKE '%MODULE%',
          IFNULL(SAFE_CAST(q.avg_best_attempt_percentage_score AS FLOAT64), 0), NULL)) AS module_avg
      FROM roster
      INNER JOIN ${QUIZ_TABLE} q
        ON LOWER(REPLACE(CAST(q.user_id AS STRING), '-', ''))
         = LOWER(REPLACE(CAST(roster.student_user_id AS STRING), '-', ''))
      GROUP BY roster.student_user_id
    ),
    scored AS (
      SELECT
        roster.section_name,
        roster.student_user_id,
        ${SPI_POINTS_SQL} AS spi_points
      FROM roster
      LEFT JOIN quiz USING (student_user_id)
    )
    SELECT
      section_name,
      AVG(spi_points) AS avg_spi_points,
      COUNT(*) AS student_count
    FROM scored
    GROUP BY section_name
    ORDER BY section_name`,
    params,
    BQ_LOCATION,
    BQ_HEAVY_QUERY_TIMEOUT_MS,
  );
  return rows.map((r) => ({
    sectionName: r.section_name,
    avgSpiPoints: Math.round(Number(r.avg_spi_points) * 10) / 10,
    studentCount: Number(r.student_count),
  }));
}

export type SpiRecordGrain = "all" | "campus" | "semester" | "section" | "student";

export interface SpiRecordRow {
  university: string | null;
  semester: string | null;
  section: string | null;
  studentId: string | null;
  studentName: string | null;
  students: number;
  avgSpi: number | null;
  sections: number;
  skillLevel: string | null;
  levelAPlus: number;
  levelA: number;
  levelB: number;
  levelC: number;
  levelD: number;
  skillDebt: number;
  classroomPoints: number | null;
  modulePoints: number | null;
  attendancePct: number | null;
}

export interface SpiRecordSummary {
  students: number;
  campuses: number;
  avgSpi: number | null;
  levelAPlus: number;
  levelA: number;
  levelB: number;
  levelC: number;
  levelD: number;
  skillDebt: number;
  attendancePct: number | null;
}

const SPI_LEVEL_SQL = `CASE
  WHEN classroom_avg IS NULL AND module_avg IS NULL THEN 'Ab'
  WHEN LEAST(IFNULL(classroom_avg, 100), IFNULL(module_avg, 100)) < 50 THEN 'F'
  WHEN LEAST(IFNULL(classroom_avg, 100), IFNULL(module_avg, 100)) >= 90 THEN 'A+'
  WHEN LEAST(IFNULL(classroom_avg, 100), IFNULL(module_avg, 100)) >= 80 THEN 'A'
  WHEN LEAST(IFNULL(classroom_avg, 100), IFNULL(module_avg, 100)) >= 70 THEN 'B'
  WHEN LEAST(IFNULL(classroom_avg, 100), IFNULL(module_avg, 100)) >= 60 THEN 'C'
  ELSE 'D'
END`;

const SPI_COMPONENT_POINTS_SQL = (column: string) => `CASE
  WHEN ${column} IS NULL OR ${column} < 50 THEN 0
  WHEN ${column} >= 90 THEN 10
  WHEN ${column} >= 80 THEN 9
  WHEN ${column} >= 70 THEN 8
  WHEN ${column} >= 60 THEN 7
  ELSE 6
END`;

function spiRecordGrainSql(grain: SpiRecordGrain): { select: string; group: string } {
  switch (grain) {
    case "all":
      return {
        select: `'All campuses' AS label, CAST(NULL AS STRING) AS university, CAST(NULL AS STRING) AS semester, CAST(NULL AS STRING) AS section_name, CAST(NULL AS STRING) AS student_id, CAST(NULL AS STRING) AS student_name`,
        group: "",
      };
    case "semester":
      return {
        select: `semester_title AS label, university, semester_title AS semester, CAST(NULL AS STRING) AS section_name, CAST(NULL AS STRING) AS student_id, CAST(NULL AS STRING) AS student_name`,
        group: "university, semester_title",
      };
    case "section":
      return {
        select: `section_name AS label, university, CAST(NULL AS STRING) AS semester, section_name, CAST(NULL AS STRING) AS student_id, CAST(NULL AS STRING) AS student_name`,
        group: "university, section_name",
      };
    case "student":
      return {
        select: `ANY_VALUE(student_name) AS label, university, semester_title AS semester, section_name, student_user_id AS student_id, ANY_VALUE(student_name) AS student_name`,
        group: "university, semester_title, section_name, student_user_id",
      };
    default:
      return {
        select: `university AS label, university, CAST(NULL AS STRING) AS semester, CAST(NULL AS STRING) AS section_name, CAST(NULL AS STRING) AS student_id, CAST(NULL AS STRING) AS student_name`,
        group: "university",
      };
  }
}

/**
 * SPI Record dashboard. Points match Reports: (classroom×10 + module×15) / 100 / 10.
 * A missing quiz counts as 0 and stays in the average. Skill level is the
 * weaker of classroom and module under SPI plan §3.2. Below 50 is F and a
 * missing attempt is Ab; both are Skill Debt.
 */
export async function searchSpiStudents(
  scope: SessionScope,
  opts: {
    search: string;
    campuses?: string[];
    sections?: { campus: string; section: string }[];
    limit?: number;
  },
): Promise<{ studentId: string; studentName: string; campus: string; section: string }[]> {
  const params: Record<string, unknown> = {};
  const where = scopeClause(scope, params, { currentSemester: false });
  params["q"] = `%${opts.search.trim()}%`;
  params["lim"] = Math.min(opts.limit ?? 20, 50);
  let extra = "";
  if (opts.campuses?.length) {
    params["filterCampuses"] = opts.campuses;
    extra += " AND TRIM(institute_name) IN UNNEST(@filterCampuses)";
  }
  if (opts.sections?.length) {
    params["sectionCampuses"] = opts.sections.map((pair) => pair.campus);
    params["sectionNames"] = opts.sections.map((pair) => pair.section);
    extra += ` AND EXISTS (
      SELECT 1 FROM UNNEST(@sectionCampuses) AS section_campus WITH OFFSET pos
      JOIN UNNEST(@sectionNames) AS section_name WITH OFFSET pos2 ON pos = pos2
      WHERE section_campus = TRIM(institute_name)
        AND section_name = COALESCE(NULLIF(TRIM(batch_section_name), ''), 'Unassigned')
    )`;
  }
  const rows = await bqQuery<{
    student_user_id: string;
    student_name: string;
    institute_name: string;
    section_name: string;
  }>(
    `SELECT
       student_user_id,
       ANY_VALUE(student_name) AS student_name,
       TRIM(institute_name) AS institute_name,
       COALESCE(NULLIF(TRIM(ANY_VALUE(batch_section_name)), ''), 'Unassigned') AS section_name
     FROM ${ATTENDANCE_TABLE}
     WHERE ${where}
       ${extra}
       AND institute_name IS NOT NULL
       AND (
         LOWER(student_name) LIKE LOWER(@q)
         OR LOWER(CAST(student_user_id AS STRING)) LIKE LOWER(@q)
       )
     GROUP BY student_user_id, TRIM(institute_name)
     ORDER BY student_name
     LIMIT @lim`,
    params,
    BQ_LOCATION,
    BQ_HEAVY_QUERY_TIMEOUT_MS,
  );
  return rows.map((row) => ({
    studentId: row.student_user_id,
    studentName: row.student_name,
    campus: row.institute_name,
    section: row.section_name,
  }));
}

export async function getSpiRecord(
  scope: SessionScope,
  opts: {
    grain: SpiRecordGrain;
    semester?: string;
    allSemesters?: boolean;
    campus?: string;
    section?: string;
    campuses?: string[];
    semesters?: string[];
    sections?: { campus: string; section: string }[];
    studentIds?: string[];
    attendanceRange?: "semester_to_date" | "last_30" | "custom" | "all_dates";
    attendanceFrom?: string;
    attendanceTo?: string;
  },
): Promise<{ summary: SpiRecordSummary; rows: SpiRecordRow[] }> {
  const params: Record<string, unknown> = {};
  const semesters = (opts.semesters?.filter(Boolean) ?? []).length
    ? opts.semesters!.filter(Boolean)
    : opts.semester
      ? [opts.semester]
      : [];
  const where = scopeClause(scope, params, {
    semester: semesters.length === 1 ? semesters[0] : undefined,
    currentSemester: semesters.length === 1 ? undefined : false,
  });
  let dimensionExtra = "";
  let semesterExtra = "";
  const campuses = opts.campuses?.filter(Boolean) ?? (opts.campus ? [opts.campus] : []);
  if (campuses.length) {
    params["filterCampuses"] = campuses;
    dimensionExtra += " AND TRIM(institute_name) IN UNNEST(@filterCampuses)";
  }
  const sections = opts.sections?.filter((pair) => pair.campus && pair.section) ?? (opts.section ? [{ campus: opts.campus ?? "", section: opts.section }] : []);
  if (opts.section && !opts.sections && !opts.campus) {
    params["filterSection"] = opts.section;
    dimensionExtra += " AND COALESCE(NULLIF(TRIM(batch_section_name), ''), 'Unassigned') = @filterSection";
  } else if (sections.length && sections.every((pair) => pair.campus)) {
    params["sectionCampuses"] = sections.map((pair) => pair.campus);
    params["sectionNames"] = sections.map((pair) => pair.section);
    dimensionExtra += ` AND EXISTS (
      SELECT 1 FROM UNNEST(@sectionCampuses) AS section_campus WITH OFFSET pos
      JOIN UNNEST(@sectionNames) AS section_name WITH OFFSET pos2 ON pos = pos2
      WHERE section_campus = TRIM(institute_name)
        AND section_name = COALESCE(NULLIF(TRIM(batch_section_name), ''), 'Unassigned')
    )`;
  }
  if (opts.studentIds?.length) {
    params["studentIds"] = opts.studentIds;
    dimensionExtra += " AND student_user_id IN UNNEST(@studentIds)";
  }
  if (semesters.length > 1) {
    params["semesters"] = semesters;
    semesterExtra += " AND semester_title IN UNNEST(@semesters)";
  }
  const attendanceParams: Record<string, unknown> = {};
  const attendanceScope = scopeClause(scope, attendanceParams, { currentSemester: false });
  let attendanceWindow = "";
  const attendanceRange = opts.attendanceRange ?? "semester_to_date";
  if (attendanceRange === "semester_to_date") {
    attendanceWindow = " AND is_current_semester = 1 AND DATE(date) <= CURRENT_DATE('Asia/Kolkata')";
  } else if (attendanceRange === "last_30") {
    attendanceWindow = " AND DATE(date) >= DATE_SUB(CURRENT_DATE('Asia/Kolkata'), INTERVAL 30 DAY) AND DATE(date) <= CURRENT_DATE('Asia/Kolkata')";
  } else if (attendanceRange === "custom" && opts.attendanceFrom && opts.attendanceTo) {
    attendanceParams["attendanceFrom"] = opts.attendanceFrom;
    attendanceParams["attendanceTo"] = opts.attendanceTo;
    attendanceWindow = " AND DATE(date) >= DATE(@attendanceFrom) AND DATE(date) <= DATE(@attendanceTo)";
  }
  Object.assign(params, attendanceParams);
  const grain = spiRecordGrainSql(opts.grain);
  const groupBy = grain.group ? `GROUP BY ${grain.group}` : "";
  const rows = await bqQuery<{
    university: string | null;
    semester: string | null;
    section_name: string | null;
    student_id: string | null;
    student_name: string | null;
    students: string;
    avg_spi: string | null;
    classroom_points: string | null;
    module_points: string | null;
    sections: string;
    skill_level: string | null;
    level_a_plus: string;
    level_a: string;
    level_b: string;
    level_c: string;
    level_d: string;
    skill_debt: string;
    campuses: string;
    attendance_pct: string | null;
  }>(
    `WITH roster AS (
      SELECT
        student_user_id,
        ANY_VALUE(student_name) AS student_name,
        TRIM(institute_name) AS university,
        COALESCE(NULLIF(TRIM(${opts.grain === "section" || opts.grain === "student" ? "batch_section_name" : "ANY_VALUE(batch_section_name)"}), ''), 'Unassigned') AS section_name,
        COALESCE(NULLIF(TRIM(semester_title), ''), 'Unknown') AS semester_title
      FROM ${ATTENDANCE_TABLE}
      WHERE ${where}
        ${dimensionExtra}
        ${semesterExtra}
        AND institute_name IS NOT NULL
        AND TRIM(institute_name) != ''
      GROUP BY student_user_id, TRIM(institute_name), semester_title${opts.grain === "section" || opts.grain === "student" ? ", COALESCE(NULLIF(TRIM(batch_section_name), ''), 'Unassigned')" : ""}
    ),
    people AS (
      SELECT
        student_user_id,
        university,
        ANY_VALUE(student_name) AS student_name,
        ${opts.grain === "campus" || opts.grain === "all" ? "ANY_VALUE(section_name) AS section_name" : "section_name"},
        ${opts.grain === "campus" || opts.grain === "all" ? "ANY_VALUE(semester_title) AS semester_title" : "semester_title"}
      FROM roster
      GROUP BY student_user_id, university${opts.grain === "campus" || opts.grain === "all" ? "" : ", semester_title, section_name"}
    ),
    quiz AS (
      SELECT
        people.student_user_id,
        AVG(IF(UPPER(q.derived_unit_type) LIKE '%MODULE%', NULL,
          IFNULL(SAFE_CAST(q.avg_best_attempt_percentage_score AS FLOAT64), 0))) AS classroom_avg,
        AVG(IF(UPPER(q.derived_unit_type) LIKE '%MODULE%',
          IFNULL(SAFE_CAST(q.avg_best_attempt_percentage_score AS FLOAT64), 0), NULL)) AS module_avg
      FROM people
      INNER JOIN ${QUIZ_TABLE} q
        ON LOWER(REPLACE(CAST(q.user_id AS STRING), '-', ''))
         = LOWER(REPLACE(CAST(people.student_user_id AS STRING), '-', ''))
      GROUP BY people.student_user_id
    ),
    attendance AS (
      SELECT
        student_user_id,
        TRIM(institute_name) AS university,
        ROUND(SAFE_DIVIDE(COUNTIF(${ATTENDED_SQL}), COUNT(*)) * 100, 1) AS attendance_pct
      FROM ${ATTENDANCE_TABLE}
      WHERE ${attendanceScope}
        ${dimensionExtra}
        ${attendanceWindow}
        AND institute_name IS NOT NULL
        AND TRIM(institute_name) != ''
      GROUP BY student_user_id, TRIM(institute_name)
    ),
    scored AS (
      SELECT
        people.university,
        people.section_name,
        people.semester_title,
        people.student_user_id,
        people.student_name,
        quiz.classroom_avg,
        quiz.module_avg,
        attendance.attendance_pct,
        ${SPI_POINTS_SQL} AS spi_points,
        ${SPI_LEVEL_SQL} AS skill_level
      FROM people
      LEFT JOIN quiz USING (student_user_id)
      LEFT JOIN attendance USING (student_user_id, university)
    )
    SELECT
      ${grain.select},
      COUNT(*) AS students,
      AVG(spi_points) AS avg_spi,
      AVG(${SPI_COMPONENT_POINTS_SQL("classroom_avg")}) AS classroom_points,
      AVG(${SPI_COMPONENT_POINTS_SQL("module_avg")}) AS module_points,
      COUNT(DISTINCT section_name) AS sections,
      COUNT(DISTINCT university) AS campuses,
      ${opts.grain === "student" ? "ANY_VALUE(skill_level)" : "CAST(NULL AS STRING)"} AS skill_level,
      COUNTIF(skill_level = 'A+') AS level_a_plus,
      COUNTIF(skill_level = 'A') AS level_a,
      COUNTIF(skill_level = 'B') AS level_b,
      COUNTIF(skill_level = 'C') AS level_c,
      COUNTIF(skill_level = 'D') AS level_d,
      COUNTIF(skill_level IN ('F', 'Ab')) AS skill_debt,
      AVG(attendance_pct) AS attendance_pct
    FROM scored
    ${groupBy}
    ORDER BY 1`,
    params,
    BQ_LOCATION,
    BQ_HEAVY_QUERY_TIMEOUT_MS,
  );

  const mapped = rows
    .filter((r) => !isExcludedInstitute(r.university))
    .map((r) => {
      const avg = r.avg_spi == null ? null : Math.round(Number(r.avg_spi) * 10) / 10;
      const points = (value: string | null) =>
        value == null ? null : Math.round(Number(value) * 10) / 10;
      return {
        university: r.university,
        semester: r.semester,
        section: r.section_name,
        studentId: r.student_id,
        studentName: r.student_name,
        students: Number(r.students),
        avgSpi: Number.isFinite(avg as number) ? avg : null,
        classroomPoints: points(r.classroom_points),
        modulePoints: points(r.module_points),
        sections: Number(r.sections),
        skillLevel: r.skill_level,
        levelAPlus: Number(r.level_a_plus),
        levelA: Number(r.level_a),
        levelB: Number(r.level_b),
        levelC: Number(r.level_c),
        levelD: Number(r.level_d),
        skillDebt: Number(r.skill_debt),
        attendancePct: r.attendance_pct == null ? null : Math.round(Number(r.attendance_pct) * 10) / 10,
      };
    });

  const avgDen = mapped.reduce((sum, row) => sum + row.students, 0);
  const avgNum = mapped.reduce((sum, row) => sum + (row.avgSpi ?? 0) * row.students, 0);
  const attNum = mapped.reduce((sum, row) => sum + (row.attendancePct ?? 0) * row.students, 0);
  const summary: SpiRecordSummary = {
    students: avgDen,
    campuses: campuses.length === 1 ? 1 : opts.grain === "campus" ? mapped.length : Number(rows[0]?.campuses ?? 0),
    avgSpi: avgDen > 0 ? Math.round((avgNum / avgDen) * 10) / 10 : null,
    attendancePct: avgDen > 0 ? Math.round((attNum / avgDen) * 10) / 10 : null,
    levelAPlus: mapped.reduce((sum, row) => sum + row.levelAPlus, 0),
    levelA: mapped.reduce((sum, row) => sum + row.levelA, 0),
    levelB: mapped.reduce((sum, row) => sum + row.levelB, 0),
    levelC: mapped.reduce((sum, row) => sum + row.levelC, 0),
    levelD: mapped.reduce((sum, row) => sum + row.levelD, 0),
    skillDebt: mapped.reduce((sum, row) => sum + row.skillDebt, 0),
  };

  return { summary, rows: mapped };
}


export interface CampusSummaryItem {
  instituteName: string;
  /** Distinct students in the selected semester (not the date window). */
  studentCount: number;
  sectionCount: number;
  subjectCount: number;
  /** Distinct students with at least one present row in the date window. */
  presentCount: number;
  /** Distinct classes held, not attendance row count. */
  totalCount: number;
  /** SPI attendance: sessions attended / sessions scheduled. */
  pct: number;
  presentRecordCount: number;
  totalRecordCount: number;
  /** Same as pct ΓÇö kept so existing clients keep working. */
  recordPct: number;
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
  opts: { dateRange?: DateRangeFilter; semester?: string } = {},
): Promise<CampusSummaryItem[]> {
  const params: Record<string, unknown> = {};
  const rosterWhere = scopeClause(scope, params, { semester: opts.semester });
  const inWindow = dateWindowPredicate(opts.dateRange, params);
  // Single scan: roster metrics over the semester scope; windowed metrics
  // gated by inWindow (TRUE when "All dates") — avoids a second full-table CTE.
  const rows = await bqQuery<
    AttendanceRollupRow & {
      institute_name: string;
      section_count: string;
      subject_count: string;
    }
  >(
    `SELECT
      TRIM(institute_name) AS institute_name,
      COUNT(DISTINCT student_user_id) AS student_count,
      COUNT(DISTINCT batch_section_name) AS section_count,
      COUNT(DISTINCT subject_title) AS subject_count,
      COUNT(DISTINCT IF((${inWindow}) AND ${ATTENDED_SQL}, student_user_id, NULL)) AS present_student_count,
      COUNT(DISTINCT IF(${inWindow}, ${SESSION_IDENTITY_SQL}, NULL)) AS session_count,
      COUNTIF((${inWindow}) AND ${ATTENDED_SQL}) AS present_record_count,
      COUNTIF(${inWindow}) AS total_record_count
    FROM ${ATTENDANCE_TABLE}
    WHERE ${rosterWhere}
    GROUP BY TRIM(institute_name)
    ORDER BY institute_name`,
    params,
    BQ_LOCATION,
    BQ_HEAVY_QUERY_TIMEOUT_MS,
  );
  return rows.filter((r) => !isExcludedInstitute(r.institute_name)).map((r) => ({
    instituteName: r.institute_name,
    sectionCount: Number(r.section_count),
    subjectCount: Number(r.subject_count),
    ...mapAttendanceRollup(r),
  }));
}

export async function getSectionSummary(
  scope: SessionScope,
  opts: { dateRange?: DateRangeFilter } = {},
): Promise<SectionSummaryItem[]> {
  const params: Record<string, unknown> = {};
  const where = scopeClause(scope, params);
  const inWindow = dateWindowPredicate(opts.dateRange, params);
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
      COUNTIF((${inWindow}) AND ${ATTENDED_SQL}) AS present_count,
      COUNTIF(${inWindow}) AS total_count
    FROM ${ATTENDANCE_TABLE}
    WHERE ${where}
    GROUP BY institute_name, COALESCE(batch_section_name, 'Unknown')
    ORDER BY institute_name, batch_section_name`,
    params,
    BQ_LOCATION,
    BQ_HEAVY_QUERY_TIMEOUT_MS,
  );
  return rows.filter((r) => !isExcludedInstitute(r.institute_name)).map((r) => {
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
  /** Distinct students in the selected semester (not the date window). */
  studentCount: number;
  /** Distinct students with at least one present row in the date window. */
  presentCount: number;
  /** Distinct classes held, not attendance row count. */
  totalCount: number;
  /** SPI attendance: sessions attended / sessions scheduled. */
  pct: number;
  presentRecordCount: number;
  totalRecordCount: number;
  /** Same as pct ΓÇö kept so existing clients keep working. */
  recordPct: number;
}

export async function getSubjectSummary(
  scope: SessionScope,
  opts: { campus?: string; dateRange?: DateRangeFilter; semester?: string } = {},
): Promise<SubjectSummaryItem[]> {
  const params: Record<string, unknown> = {};
  let campusFilter = "";
  if (opts.campus) {
    params["filterCampus"] = opts.campus;
    campusFilter = " AND institute_name = @filterCampus";
  }
  const rosterWhere =
    scopeClause(scope, params, { semester: opts.semester }) + campusFilter;
  const inWindow = dateWindowPredicate(opts.dateRange, params);
  const rows = await bqQuery<
    AttendanceRollupRow & { subject_title: string | null }
  >(
    `SELECT
      subject_title,
      COUNT(DISTINCT student_user_id) AS student_count,
      COUNT(DISTINCT IF((${inWindow}) AND ${ATTENDED_SQL}, student_user_id, NULL)) AS present_student_count,
      COUNT(DISTINCT IF(${inWindow}, ${SESSION_IDENTITY_SQL}, NULL)) AS session_count,
      COUNTIF((${inWindow}) AND ${ATTENDED_SQL}) AS present_record_count,
      COUNTIF(${inWindow}) AS total_record_count
    FROM ${ATTENDANCE_TABLE}
    WHERE ${rosterWhere}
    GROUP BY subject_title
    ORDER BY SAFE_DIVIDE(
      COUNTIF((${inWindow}) AND ${ATTENDED_SQL}),
      NULLIF(COUNTIF(${inWindow}), 0)
    ) ASC`,
    params,
    BQ_LOCATION,
    BQ_HEAVY_QUERY_TIMEOUT_MS,
  );
  return rows.map((r) => ({
    subjectTitle: r.subject_title?.trim() || "Unassigned subject",
    ...mapAttendanceRollup(r),
  }));
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
 * (session type + slot time, date) so a session repeated on different days
 * stays distinct. Scope-filtered like every other dashboard query.
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
      ${SESSION_TITLE_SQL} AS session_title,
      CAST(date AS STRING) AS date,
      COUNT(DISTINCT student_user_id) AS student_count,
      COUNTIF(${ATTENDED_SQL}) AS present_count,
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
 * Every session at one campus, flattened across subjects ΓÇö the campus
 * drill-down table. Ordered by subject then worst attendance first, so the
 * sessions needing attention surface at the top of each subject group.
 */
export async function getCampusSessions(
  scope: SessionScope,
  opts: {
    campus: string;
    section?: string;
    dateRange?: DateRangeFilter;
    semester?: string;
  },
): Promise<CampusSessionRow[]> {
  const params: Record<string, unknown> = { campus: opts.campus };
  const where =
    scopeClause(scope, params, { semester: opts.semester }) +
    dateRangeClause(opts.dateRange, params);
  let extra = " AND institute_name = @campus";
  extra += " AND NULLIF(TRIM(subject_title), '') IS NOT NULL";
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
      ${SESSION_TITLE_SQL} AS session_title,
      CAST(date AS STRING) AS date,
      COUNT(DISTINCT student_user_id) AS student_count,
      COUNTIF(${ATTENDED_SQL}) AS present_count,
      COUNT(*) AS total_count
    FROM ${ATTENDANCE_TABLE}
    WHERE ${where}${extra}
    GROUP BY subject_title, session_title, date
    ORDER BY
      subject_title,
      SAFE_DIVIDE(
        COUNTIF(${ATTENDED_SQL}),
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
 * Per-student attendance for one session of one subject ΓÇö who attended and
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
    semester?: string;
  },
): Promise<SessionStudentItem[]> {
  const params: Record<string, unknown> = {
    subject: opts.subject,
    sessionTitle: opts.sessionTitle,
  };
  const where = scopeClause(scope, params, { semester: opts.semester });
  let extra =
    " AND subject_title = @subject" +
    ` AND ${SESSION_TITLE_SQL} = @sessionTitle`;
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
  return rows.filter((r) => !isExcludedInstitute(r.institute_name)).map((r) => ({
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
        COUNTIF(${ATTENDED_SQL}) AS present_count,
        COUNT(*) AS total_count,
        SAFE_DIVIDE(COUNTIF(${ATTENDED_SQL}), COUNT(*)) * 100 AS subject_pct
      FROM ${ATTENDANCE_TABLE}
      WHERE ${where}
        AND institute_name = @campus
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
      SAFE_DIVIDE(COUNTIF(${ATTENDED_SQL}), COUNT(*)) * 100 AS subject_pct
    FROM ${ATTENDANCE_TABLE}
    WHERE ${where}
      AND institute_name = @campus
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
       COUNTIF(${ATTENDED_SQL}) AS present_count,
       COUNT(*) AS total_count,
       SAFE_DIVIDE(COUNTIF(${ATTENDED_SQL}), COUNT(*)) * 100 AS subject_pct
     FROM ${ATTENDANCE_TABLE}
     WHERE ${where}
       AND institute_name = @campus
       AND subject_title = @subject
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

/** Prefer semester_course_title, then course_title ΓÇö CQ and MQ store the subject in different columns. */
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
 * and subject only ΓÇö subject matches either quiz title column.
 */
function quizScopeClause(
  scope: SessionScope,
  params: Record<string, unknown>,
  quizAlias = "",
): string {
  const col = quizAlias ? `${quizAlias}.` : "";
  const clauses: string[] = [excludeInstituteSql(`${col}institute_name`)];
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
  classroomStudentCompleted: number;
  classroomStudentTotal: number;
  moduleStudentCompleted: number;
  moduleStudentTotal: number;
  classroomPct: number;
  modulePct: number;
  completionPct: number;
}

export interface AssessmentCampusItem extends AssessmentCountRow {
  instituteName: string;
  studentCount: number;
  subjectCount: number;
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
  cq_student_completed?: string;
  cq_student_total?: string;
  mq_student_completed?: string;
  mq_student_total?: string;
}): AssessmentCountRow {
  const classroomCompleted = Number(row.cq_completed ?? 0);
  const classroomTotal = Number(row.cq_total ?? 0);
  const moduleCompleted = Number(row.mq_completed ?? 0);
  const moduleTotal = Number(row.mq_total ?? 0);
  const classroomStudentCompleted = Number(
    row.cq_student_completed ?? row.cq_completed ?? 0,
  );
  const classroomStudentTotal = Number(
    row.cq_student_total ?? row.cq_total ?? 0,
  );
  const moduleStudentCompleted = Number(
    row.mq_student_completed ?? row.mq_completed ?? 0,
  );
  const moduleStudentTotal = Number(row.mq_student_total ?? row.mq_total ?? 0);
  return {
    classroomCompleted,
    classroomTotal,
    moduleCompleted,
    moduleTotal,
    totalCompleted: classroomCompleted + moduleCompleted,
    totalAssigned: classroomTotal + moduleTotal,
    classroomStudentCompleted,
    classroomStudentTotal,
    moduleStudentCompleted,
    moduleStudentTotal,
    classroomPct: pct(classroomStudentCompleted, classroomStudentTotal),
    modulePct: pct(moduleStudentCompleted, moduleStudentTotal),
    completionPct: pct(
      classroomStudentCompleted + moduleStudentCompleted,
      classroomStudentTotal + moduleStudentTotal,
    ),
  };
}

const SUBJECT_UNIQUE_SELECT = `LEAST(CAST(ROUND(AVG(cq_completed)) AS INT64), CAST(MAX(cq_total) AS INT64)) AS cq_completed,
        CAST(MAX(cq_total) AS INT64) AS cq_total,
        LEAST(CAST(ROUND(AVG(mq_completed)) AS INT64), CAST(MAX(mq_total) AS INT64)) AS mq_completed,
        CAST(MAX(mq_total) AS INT64) AS mq_total,
        SUM(cq_completed) AS cq_student_completed,
        SUM(cq_total) AS cq_student_total,
        SUM(mq_completed) AS mq_student_completed,
        SUM(mq_total) AS mq_student_total`;

interface AssessmentQueryOpts {
  campus?: string;
  semester?: string;
}

function assessmentScopeSql(
  scope: SessionScope,
  opts: AssessmentQueryOpts,
  params: Record<string, unknown>,
): { attWhere: string; quizWhere: string } {
  const attWhere = scopeClause(scope, params, {
    semester: opts.semester,
  });
  const quizWhere = quizScopeClause(scope, params, "q");
  return { attWhere, quizWhere };
}

function assessmentEnrolledSql(attWhere: string, extra = ""): string {
  return `enrolled AS (
      SELECT DISTINCT
        institute_name,
        LOWER(REPLACE(CAST(student_user_id AS STRING), '-', '')) AS student_key,
        subject_title
      FROM ${ATTENDANCE_TABLE}
      WHERE ${attWhere}
        AND institute_name IS NOT NULL
        AND TRIM(institute_name) != ''
        AND student_user_id IS NOT NULL
        ${extra}
    )`;
}

function assessmentQuizStudentSubjectSql(quizWhere: string): string {
  return `quiz_student_subject AS (
      SELECT
        q.institute_name,
        ${quizSubjectTitleSql("q")} AS subject_title,
        q.user_id,
        ${quizPivotSelect("q")}
      FROM ${QUIZ_TABLE} q
      INNER JOIN enrolled e
        ON e.institute_name = q.institute_name
       AND e.student_key = LOWER(REPLACE(CAST(q.user_id AS STRING), '-', ''))
       AND ${quizMatchesSubjectSql("e.subject_title", "q")}
      WHERE ${quizWhere}
        AND q.institute_name IS NOT NULL
        AND TRIM(q.institute_name) != ''
      GROUP BY q.institute_name, subject_title, q.user_id
    )`;
}

/**
 * Campus rollup: unique CQ/MQ counts (sum of per-subject typical quizzes)
 * plus student completion % from all student-quiz assignments.
 * Semester comes from attendance enrolment ΓÇö the quiz table has no date.
 */
export async function getAssessmentCampusSummary(
  scope: SessionScope,
  opts: AssessmentQueryOpts = {},
): Promise<AssessmentCampusItem[]> {
  const params: Record<string, unknown> = {};
  const { attWhere, quizWhere } = assessmentScopeSql(scope, opts, params);
  let extra = "";
  if (opts.campus) {
    params["filterCampus"] = opts.campus;
    extra += " AND institute_name = @filterCampus";
  }
  const rows = await bqQuery<{
    institute_name: string;
    student_count: string;
    subject_count: string;
    cq_completed: string;
    cq_total: string;
    mq_completed: string;
    mq_total: string;
    cq_student_completed: string;
    cq_student_total: string;
    mq_student_completed: string;
    mq_student_total: string;
  }>(
    `WITH ${assessmentEnrolledSql(attWhere, extra)},
    ${assessmentQuizStudentSubjectSql(quizWhere)},
    subject_rollups AS (
      SELECT
        institute_name,
        subject_title,
        ${SUBJECT_UNIQUE_SELECT}
      FROM quiz_student_subject
      GROUP BY institute_name, subject_title
    ),
    campus_quiz AS (
      SELECT
        institute_name,
        SUM(cq_completed) AS cq_completed,
        SUM(cq_total) AS cq_total,
        SUM(mq_completed) AS mq_completed,
        SUM(mq_total) AS mq_total,
        SUM(cq_student_completed) AS cq_student_completed,
        SUM(cq_student_total) AS cq_student_total,
        SUM(mq_student_completed) AS mq_student_completed,
        SUM(mq_student_total) AS mq_student_total
      FROM subject_rollups
      GROUP BY institute_name
    ),
    campuses AS (
      SELECT
        institute_name,
        COUNT(DISTINCT student_key) AS student_count,
        COUNT(DISTINCT subject_title) AS subject_count
      FROM enrolled
      GROUP BY institute_name
    )
    SELECT
      campuses.institute_name,
      campuses.student_count,
      campuses.subject_count,
      IFNULL(campus_quiz.cq_completed, 0) AS cq_completed,
      IFNULL(campus_quiz.cq_total, 0) AS cq_total,
      IFNULL(campus_quiz.mq_completed, 0) AS mq_completed,
      IFNULL(campus_quiz.mq_total, 0) AS mq_total,
      IFNULL(campus_quiz.cq_student_completed, 0) AS cq_student_completed,
      IFNULL(campus_quiz.cq_student_total, 0) AS cq_student_total,
      IFNULL(campus_quiz.mq_student_completed, 0) AS mq_student_completed,
      IFNULL(campus_quiz.mq_student_total, 0) AS mq_student_total
    FROM campuses
    LEFT JOIN campus_quiz ON campus_quiz.institute_name = campuses.institute_name
    ORDER BY campuses.institute_name`,
    params,
  );
  return rows.filter((r) => !isExcludedInstitute(r.institute_name)).map((r) => ({
    instituteName: r.institute_name,
    studentCount: Number(r.student_count),
    subjectCount: Number(r.subject_count),
    ...mapAssessmentCounts(r),
  }));
}

/** Subject rollup of unique quiz counts and student completion at one campus. */
export async function getAssessmentSubjects(
  scope: SessionScope,
  opts: { campus: string; semester?: string },
): Promise<AssessmentSubjectItem[]> {
  const params: Record<string, unknown> = { filterCampus: opts.campus };
  const { attWhere, quizWhere } = assessmentScopeSql(scope, opts, params);
  const extra = " AND institute_name = @filterCampus";
  const rows = await bqQuery<{
    subject_title: string;
    student_count: string;
    cq_completed: string;
    cq_total: string;
    mq_completed: string;
    mq_total: string;
    cq_student_completed: string;
    cq_student_total: string;
    mq_student_completed: string;
    mq_student_total: string;
  }>(
    `WITH ${assessmentEnrolledSql(attWhere, extra)},
    ${assessmentQuizStudentSubjectSql(quizWhere)},
    subjects AS (
      SELECT
        subject_title,
        COUNT(DISTINCT student_key) AS student_count
      FROM enrolled
      GROUP BY subject_title
    ),
    subject_quiz AS (
      SELECT
        subject_title,
        ${SUBJECT_UNIQUE_SELECT}
      FROM quiz_student_subject
      GROUP BY subject_title
    )
    SELECT
      subjects.subject_title,
      subjects.student_count,
      IFNULL(subject_quiz.cq_completed, 0) AS cq_completed,
      IFNULL(subject_quiz.cq_total, 0) AS cq_total,
      IFNULL(subject_quiz.mq_completed, 0) AS mq_completed,
      IFNULL(subject_quiz.mq_total, 0) AS mq_total,
      IFNULL(subject_quiz.cq_student_completed, 0) AS cq_student_completed,
      IFNULL(subject_quiz.cq_student_total, 0) AS cq_student_total,
      IFNULL(subject_quiz.mq_student_completed, 0) AS mq_student_completed,
      IFNULL(subject_quiz.mq_student_total, 0) AS mq_student_total
    FROM subjects
    LEFT JOIN subject_quiz ON subject_quiz.subject_title = subjects.subject_title
    ORDER BY subjects.subject_title`,
    params,
  );
  return rows.map((r) => ({
    subjectTitle: r.subject_title,
    studentCount: Number(r.student_count),
    ...mapAssessmentCounts(r),
  }));
}

/** Per-student classroom + module quiz counts, scoped to attendance semester. */
export async function getAssessmentStudents(
  scope: SessionScope,
  opts: {
    campus?: string;
    subject?: string;
    semester?: string;
    search?: string;
    limit?: number;
  } = {},
): Promise<AssessmentStudentItem[]> {
  const params: Record<string, unknown> = {};
  const { attWhere, quizWhere } = assessmentScopeSql(scope, opts, params);
  let extra = "";
  if (opts.campus) {
    params["filterCampus"] = opts.campus;
    extra += " AND institute_name = @filterCampus";
  }
  if (opts.subject) {
    params["subject"] = opts.subject;
    extra += " AND subject_title = @subject";
  }
  let searchFilter = "";
  if (opts.search) {
    params["q"] = `%${opts.search}%`;
    searchFilter =
      "AND (LOWER(COALESCE(names.student_name, '')) LIKE LOWER(@q) OR LOWER(CAST(enrolled.student_key AS STRING)) LIKE LOWER(@q))";
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
    `WITH ${assessmentEnrolledSql(attWhere, extra)},
    names AS (
      SELECT
        LOWER(REPLACE(CAST(student_user_id AS STRING), '-', '')) AS student_key,
        MAX(student_name) AS student_name,
        MAX(batch_section_name) AS section_name
      FROM ${ATTENDANCE_TABLE}
      WHERE ${attWhere}
        AND student_name IS NOT NULL
        AND TRIM(student_name) != ''
        ${extra}
      GROUP BY 1
    ),
    quiz AS (
      SELECT
        q.user_id,
        ANY_VALUE(q.institute_name) AS institute_name,
        ${quizPivotSelect("q")}
      FROM ${QUIZ_TABLE} q
      INNER JOIN enrolled e
        ON e.institute_name = q.institute_name
       AND e.student_key = LOWER(REPLACE(CAST(q.user_id AS STRING), '-', ''))
       AND ${quizMatchesSubjectSql("e.subject_title", "q")}
      WHERE ${quizWhere}
      GROUP BY q.user_id
    )
    SELECT
      enrolled.student_key AS student_user_id,
      COALESCE(names.student_name, '') AS student_name,
      enrolled.institute_name,
      names.section_name,
      IFNULL(quiz.cq_completed, 0) AS cq_completed,
      IFNULL(quiz.cq_total, 0) AS cq_total,
      IFNULL(quiz.mq_completed, 0) AS mq_completed,
      IFNULL(quiz.mq_total, 0) AS mq_total
    FROM (
      SELECT DISTINCT student_key, institute_name FROM enrolled
    ) enrolled
    LEFT JOIN names ON names.student_key = enrolled.student_key
    LEFT JOIN quiz
      ON LOWER(REPLACE(CAST(quiz.user_id AS STRING), '-', '')) = enrolled.student_key
    WHERE TRUE
      ${searchFilter}
    ORDER BY
      SAFE_DIVIDE(
        IFNULL(quiz.cq_completed, 0) + IFNULL(quiz.mq_completed, 0),
        IFNULL(quiz.cq_total, 0) + IFNULL(quiz.mq_total, 0)
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
 * joined only for name/section and display % ΓÇö it does not gate the list.
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
        COUNTIF(${ATTENDED_SQL}) AS present_count,
        COUNT(*) AS total_count,
        SAFE_DIVIDE(COUNTIF(${ATTENDED_SQL}), COUNT(*)) * 100 AS subject_pct
      FROM ${ATTENDANCE_TABLE}
      WHERE ${attWhere}
        AND institute_name = @campus
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
        COUNTIF(${ATTENDED_SQL}) AS present_count,
        COUNT(*) AS total_count,
        SAFE_DIVIDE(COUNTIF(${ATTENDED_SQL}), COUNT(*)) * 100 AS subject_pct
      FROM ${ATTENDANCE_TABLE}
      WHERE ${attWhere}
        AND institute_name = @campus
        AND subject_title = @subject
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
    // The recovery instructor account this session is assigned to, if any --
    // lets the frontend tell whether the logged-in instructor may report on
    // this specific session (matched against their own user id).
    instructorId: string | null;
    // Instructor's own notes from filing the recovery report, and any QA
    // report links they attached -- surfaced in the session tracker table.
    remarks: string;
    qaReportUrls: string[];
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
 * grouped by subject and ordered by the date it was first scheduled ΓÇö the
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
  semester?: string,
): Promise<Set<string>> {
  const params: Record<string, unknown> = { campus, subjectTitle };
  const semesterClause = semester
    ? "sched.semester_title = @semester"
    : "sched.is_current_semester = 1";
  if (semester) params["semester"] = semester;

  const rows = await bqQuery<{ session_name: string }>(
    `SELECT DISTINCT sched.session_title AS session_name
     FROM ${PROD_SEQUENCE_TABLE} sched
     WHERE sched.institute_name = @campus
       AND sched.course_title = @subjectTitle
       AND sched.session_type = 'LECTURE'
       AND sched.session_status = 'COMPLETED'
       AND ${semesterClause}`,
    params,
  );
  return new Set(rows.map((r) => r.session_name));
}

/**
 * Attendance aggregated by session_id rather than session title.
 *
 * The attendance table names individual deliveries ("For Loop", "Coding
 * Practice Walkthrough | Part 1") while the prod sequence table names
 * modules ("Programming with Python") -- a title join silently drops rows
 * wherever the two strings don't happen to coincide, which is most campuses.
 * Both tables carry session_id, so that's the reliable join key. Pair this
 * with getSubjectProdSequence, whose rows already carry sessionId.
 */
export async function getAttendanceBySessionId(
  campus: string,
  subject: string,
  semester?: string,
  section?: string,
): Promise<Map<string, RecoveryTopicAttendance>> {
  const params: Record<string, unknown> = { campus, subject };
  const semesterClause = semester
    ? "semester_title = @semester"
    : "is_current_semester = 1";
  const sectionClause = section ? "AND batch_section_name = @section" : "";
  if (semester) params["semester"] = semester;
  if (section) params["section"] = section;

  const rows = await bqQuery<{
    session_id: string;
    present_count: string;
    total_count: string;
  }>(
    `SELECT
       session_id,
       COUNTIF(${ATTENDED_SQL}) AS present_count,
       COUNT(*) AS total_count
     FROM ${ATTENDANCE_TABLE}
     WHERE institute_name = @campus
       AND ${excludeInstituteSql()}
       AND subject_title = @subject
       AND ${semesterClause}
       ${sectionClause}
       AND session_id IS NOT NULL
     GROUP BY session_id`,
    params,
  );

  const map = new Map<string, RecoveryTopicAttendance>();
  for (const row of rows) {
    map.set(row.session_id, {
      presentCount: Number(row.present_count),
      totalCount: Number(row.total_count),
    });
  }
  return map;
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
      instructorId: recoverySessionsTable.instructorId,
      wasCovered: sessionTopicsTable.wasCovered,
      sessionStatus: recoverySessionsTable.status,
      section: recoverySessionsTable.section,
      remarks: recoverySessionsTable.remarks,
      qaReportUrls: recoverySessionsTable.qaReportUrls,
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
    if (!delivered) {
      status = "not_taught";
    
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
            instructorId: recovery.instructorId,
            remarks: recovery.remarks,
            qaReportUrls: recovery.qaReportUrls,
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
 *
 * Attendance is looked up by session_id (see getAttendanceBySessionId), and
 * the caller is expected to have sourced `attendanceBySessionId` from there
 * -- not by title, which is where the 0%-attendance bug came from.
 *
 * The recovery-curriculum overlay still matches by topic title against
 * Postgres `recovery_topics`, which is safe: sync-recovery-curriculum.ts
 * copies BigQuery's session_title verbatim into that table, so the titles
 * are guaranteed to agree. Only the BigQuery-to-BigQuery attendance join
 * needed the session_id fix.
 */
export async function getProdSequenceSessionTracker(
  campus: string,
  subject: string,
  attendanceBySessionId: ReadonlyMap<string, RecoveryTopicAttendance>,
  section?: string,
  semester?: string,
  recoverySubject?: string,
): Promise<SessionTrackerRow[]> {
  const allSessions = await getSubjectProdSequence(
    campus,
    subject,
    semester,
    section,
    "LECTURE",
  );
  // Only sessions BigQuery has actually marked COMPLETED belong in the
  // tracker -- future/not-yet-delivered lectures aren't shown at all rather
  // than listed as "not_taught".
  const sequence = allSessions.filter((item) => item.completed);

  let recoveryByTitle = new Map<string, SessionTrackerRow>();
  if (recoverySubject) {
    // deliveredTitles drives the Postgres-side "not_taught" check directly
    // off the live schedule, so passing an empty attendance map into
    // getSessionTracker here is fine -- we only read status/unitId/
    // recoverySession off its rows, never its attendance numbers.
    const deliveredTitles = await getDeliveredTopicTitles(
      campus,
      subject,
      semester,
    );
    const recoveryRows = await getSessionTracker(
      campus,
      recoverySubject,
      new Map<string, RecoveryTopicAttendance>(),
      section,
      deliveredTitles,
    );
    recoveryByTitle = new Map(
      recoveryRows.map((row) => [row.topicTitle, row]),
    );
  }

  return sequence.map((item) => {
    const attendance = attendanceBySessionId.get(item.sessionId);
    const attendancePct =
      attendance && attendance.totalCount > 0
        ? Math.round((attendance.presentCount / attendance.totalCount) * 1000) /
          10
        : null;
    const recovery = recoveryByTitle.get(item.topicTitle);

    // item.completed is always true here (sequence is pre-filtered above),
    // so this only ever resolves to needs_recovery / recovery_scheduled /
    // recovered -- never not_taught.
    let status: SessionTrackerStatus;
    if (recovery?.status === "recovered") {
      status = "recovered";
    } else if (recovery?.status === "recovery_scheduled") {
      status = "recovery_scheduled";
    } else {
      status = "needs_recovery";
    }

    return {
      sequenceNo: item.order,
      weekNo: item.week,
      topicTitle: item.topicTitle,
      unitId: recovery?.unitId ?? null,
      attendancePct,
      presentCount: attendance?.presentCount ?? null,
      totalCount: attendance?.totalCount ?? null,
      status,
      prodStatus: "completed",
      completedAt: item.completedAt,
      recoverySession: recovery?.recoverySession ?? null,
    };
  });
}

/**
 * Recovery progress for one campus and curriculum subject.
 *
 * The caller supplies `totalTopics`/`topicsRecovered` -- computed from the
 * live BigQuery-backed session tracker (getProdSequenceSessionTracker), the
 * same source the session-tracker table itself uses -- rather than this
 * function deriving them from the Postgres recovery_topics/recovery_progress
 * cache. That keeps the summary card's counts consistent with the table
 * below it: "topics recovered" here means completed lecture sessions whose
 * status came back "recovered" in the tracker, and per the org's no-threshold
 * recovery policy every completed lecture counts (there is no "below
 * threshold" subset anymore).
 */
export async function getRecoveryProgress(
  campus: string,
  subject: string,
  totalTopics: number,
  topicsRecovered: number,
): Promise<RecoveryProgressSummary> {
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

  return {
    campus,
    subject,
    totalTopics,
    topicsBelowThreshold: totalTopics,
    topicsRecovered,
    topicsRemaining: Math.max(totalTopics - topicsRecovered, 0),
    recoveryCompletionPct:
      totalTopics > 0
        ? Math.round((topicsRecovered / totalTopics) * 1000) / 10
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

export interface ScheduleRecoverySessionInput {
  campus: string;
  /** Already resolved to the curriculum/recovery subject, not the raw BigQuery subject_title. */
  subject: string;
  section?: string;
  scheduledDate: string;
  startTime?: string;
  endTime?: string;
  instructorName: string;
  /**
   * Identity from BigQuery's `niat_instructor_details` roster -- populated
   * when the instructor was picked from the scheduler's picker (which
   * sources from that roster), omitted for a freehand name.
   */
  instructorUserId?: string;
  /** The NxtWave employee id (e.g. "NW0004304") from the same roster row. */
  employeeId?: string;
  /** True when picked via the "backup instructor" (all-campuses) roster rather than this campus's own. */
  isBackupInstructor?: boolean;
  studentsExpected?: number;
  /** Topic titles as shown in the session tracker; matched against recovery_topics. */
  topicTitles: string[];
}

export interface ScheduledRecoverySession {
  id: string;
  campus: string;
  subject: string;
  section: string | null;
  scheduledDate: string;
  startTime: string;
  endTime: string;
  instructorName: string;
  instructorType: "campus" | "backup" | "unknown";
  status: string;
  topicsScheduled: string[];
}

export type ScheduleRecoverySessionOutcome =
  | { ok: true; session: ScheduledRecoverySession }
  | { ok: false; error: string };

export interface CampusInstructorOption {
  instructorUserId: string;
  employeeId: string;
  name: string;
  category: string;
  role: string;
  /** Which campus this instructor is normally on staff at. */
  institute: string;
}

interface InstructorDetailsRow {
  instructor_user_id: string;
  instructor_category: string | null;
  instructor_name: string;
  instructor_role: string | null;
  nw_instructor_id: string | null;
  institute_name: string | null;
}

function toInstructorOption(
  row: InstructorDetailsRow,
  fallbackInstitute: string,
): CampusInstructorOption {
  return {
    instructorUserId: row.instructor_user_id,
    employeeId: row.nw_instructor_id ?? "",
    name: row.instructor_name,
    category: row.instructor_category ?? "",
    role: row.instructor_role ?? "",
    institute: row.institute_name ?? fallbackInstitute,
  };
}

/**
 * Active instructors on staff at one campus -- what the scheduler's
 * instructor picker lists by default. Sourced from BigQuery's
 * `niat_instructor_details`, the real NxtWave staff roster (identified by
 * `nw_instructor_id` / `instructor_user_id`), not this app's own login
 * accounts -- most instructors never get a login here, so that table only
 * ever had the handful who do.
 */
export async function getCampusInstructorRoster(
  campus: string,
): Promise<CampusInstructorOption[]> {
  const rows = await bqQuery<InstructorDetailsRow>(
    `SELECT instructor_user_id, instructor_category, instructor_name, instructor_role, nw_instructor_id, institute_name
     FROM ${INSTRUCTOR_DETAILS_TABLE}
     WHERE institute_name = @campus AND ${excludeInstituteSql()} AND instructor_status = 'ACTIVE'
     ORDER BY instructor_name`,
    { campus },
  );
  return rows.map((row) => toInstructorOption(row, campus));
}

/**
 * The "backup instructor" escape hatch: every active instructor in the
 * roster regardless of campus, so a scheduler can bring in someone from
 * another campus to cover a session their own campus can't staff.
 */
export async function getAllActiveInstructors(): Promise<CampusInstructorOption[]> {
  const rows = await bqQuery<InstructorDetailsRow>(
    `SELECT instructor_user_id, instructor_category, instructor_name, instructor_role, nw_instructor_id, institute_name
     FROM ${INSTRUCTOR_DETAILS_TABLE}
     WHERE instructor_status = 'ACTIVE'
     ORDER BY instructor_name`,
  );
  return rows
    .filter((row) => !isExcludedInstitute(row.institute_name))
    .map((row) => toInstructorOption(row, row.institute_name ?? ""));
}

/** Just the campus/subject a recovery session belongs to -- used for scope checks before deleting one. */
export async function getRecoverySessionScope(
  sessionId: string,
): Promise<{ campus: string; subject: string } | null> {
  const [row] = await db
    .select({
      campus: recoverySessionsTable.campus,
      subject: recoverySessionsTable.subject,
    })
    .from(recoverySessionsTable)
    .where(eq(recoverySessionsTable.id, sessionId))
    .limit(1);
  return row ?? null;
}

/**
 * Cancels a mistakenly-booked recovery session -- only while it's still
 * "planned" (nothing reported on it yet). Any topic this session had pushed
 * to "scheduled" reverts to "pending" so it re-enters the recovery queue to
 * be rebooked; a topic already "completed" by some other session is left
 * alone.
 */
export async function cancelRecoverySession(
  sessionId: string,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const [existing] = await db
    .select()
    .from(recoverySessionsTable)
    .where(eq(recoverySessionsTable.id, sessionId))
    .limit(1);
  if (!existing) {
    return { ok: false, error: "Recovery session not found", status: 404 };
  }
  if (existing.status !== "planned") {
    return {
      ok: false,
      error: "Only a planned session can be deleted",
      status: 409,
    };
  }

  await db.transaction(async (tx) => {
    await tx
      .update(recoverySessionsTable)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(eq(recoverySessionsTable.id, sessionId));

    const topics = await tx
      .select({ topicId: sessionTopicsTable.topicId })
      .from(sessionTopicsTable)
      .where(eq(sessionTopicsTable.sessionId, sessionId));

    for (const { topicId } of topics) {
      const sectionClause =
        existing.section == null
          ? isNull(recoveryProgressTable.section)
          : eq(recoveryProgressTable.section, existing.section);
      await tx
        .update(recoveryProgressTable)
        .set({ status: "pending", updatedAt: new Date() })
        .where(
          and(
            eq(recoveryProgressTable.campus, existing.campus),
            eq(recoveryProgressTable.subject, existing.subject),
            eq(recoveryProgressTable.topicId, topicId),
            sectionClause,
            eq(recoveryProgressTable.status, "scheduled"),
          ),
        );
    }
  });

  return { ok: true };
}

/**
 * Books a future recovery session for a set of curriculum topics. Topics are
 * matched by title against `recovery_topics` for the campus+subject -- the
 * same title-based join `getSessionTracker`'s recovery overlay relies on --
 * so the caller (the session tracker UI) can pass back the exact titles it
 * already displayed. Any title that doesn't resolve fails the whole request
 * rather than silently dropping it, since a partially-scheduled session with
 * missing topics would be confusing to spot later.
 *
 * Sets each covered topic's `recovery_progress` to "scheduled" (pooled,
 * section-less) so the tracker immediately reflects the booking, without
 * touching topics that are already "completed".
 */
export async function scheduleRecoverySession(
  input: ScheduleRecoverySessionInput,
): Promise<ScheduleRecoverySessionOutcome> {
  const uniqueTitles = [...new Set(input.topicTitles)];
  if (uniqueTitles.length === 0) {
    return { ok: false, error: "Select at least one topic" };
  }

  const topics = await db
    .select({
      id: recoveryTopicsTable.id,
      topicTitle: recoveryTopicsTable.topicTitle,
    })
    .from(recoveryTopicsTable)
    .where(
      and(
        eq(recoveryTopicsTable.campus, input.campus),
        eq(recoveryTopicsTable.subject, input.subject),
        eq(recoveryTopicsTable.isActive, true),
      ),
    );
  const byTitle = new Map(topics.map((t) => [t.topicTitle, t.id]));
  const missing = uniqueTitles.filter((title) => !byTitle.has(title));
  if (missing.length > 0) {
    return {
      ok: false,
      error: `Could not match these topics to the curriculum: ${missing.join(", ")}`,
    };
  }

  const section = input.section || null;

  // Best-effort link to a platform login account, purely so that instructor
  // can later self-report on this session from the "mark complete" button --
  // there's no shared id between this app's own users and the BigQuery
  // instructor roster, so an exact (case/whitespace-insensitive) name match
  // is the only signal available. No match just means only an admin can
  // mark/cancel the session later, same as before self-service existed.
  const [matchedUser] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(
      and(
        eq(usersTable.role, "instructor"),
        sql`LOWER(TRIM(${usersTable.name})) = LOWER(TRIM(${input.instructorName}))`,
      ),
    )
    .limit(1);

  const created = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(recoverySessionsTable)
      .values({
        campus: input.campus,
        subject: input.subject,
        section,
        instructorName: input.instructorName,
        instructorId: matchedUser?.id ?? null,
        employeeId: input.employeeId ?? null,
        bigqueryInstructorUserId: input.instructorUserId ?? null,
        instructorType: input.isBackupInstructor
          ? "backup"
          : input.instructorUserId
            ? "campus"
            : "unknown",
        scheduledDate: input.scheduledDate,
        startTime: input.startTime ?? "",
        endTime: input.endTime ?? "",
        status: "planned",
        studentsExpected: input.studentsExpected,
      })
      .returning();
    if (!inserted) throw new Error("Failed to create recovery session");

    await tx.insert(sessionTopicsTable).values(
      uniqueTitles.map((title, index) => ({
        sessionId: inserted.id,
        topicId: byTitle.get(title)!,
        orderInSession: index,
      })),
    );

    for (const title of uniqueTitles) {
      const topicId = byTitle.get(title)!;
      const sectionClause =
        section == null
          ? isNull(recoveryProgressTable.section)
          : eq(recoveryProgressTable.section, section);
      const existing = await tx
        .select({
          id: recoveryProgressTable.id,
          status: recoveryProgressTable.status,
        })
        .from(recoveryProgressTable)
        .where(
          and(
            eq(recoveryProgressTable.campus, input.campus),
            eq(recoveryProgressTable.subject, input.subject),
            eq(recoveryProgressTable.topicId, topicId),
            sectionClause,
          ),
        )
        .limit(1);
      if (existing[0]) {
        if (existing[0].status === "pending") {
          await tx
            .update(recoveryProgressTable)
            .set({ status: "scheduled", updatedAt: new Date() })
            .where(eq(recoveryProgressTable.id, existing[0].id));
        }
      } else {
        await tx.insert(recoveryProgressTable).values({
          campus: input.campus,
          subject: input.subject,
          section,
          topicId,
          status: "scheduled",
        });
      }
    }

    return inserted;
  });

  return {
    ok: true,
    session: {
      id: created.id,
      campus: created.campus,
      subject: created.subject,
      section: created.section,
      scheduledDate: created.scheduledDate,
      startTime: created.startTime,
      endTime: created.endTime,
      instructorName: created.instructorName,
      instructorType: created.instructorType,
      status: created.status,
      topicsScheduled: uniqueTitles,
    },
  };
}

/**
 * Fixed, hardcoded per-session incentive rate for recovery-session
 * instructors (₹500). Not admin-configurable by design -- see the Incentive
 * Tracker feature.
 */
export const RECOVERY_INCENTIVE_PER_SESSION = 500;

export interface IncentiveSessionRow {
  id: string;
  campus: string;
  subject: string;
  /** Curriculum topic(s) assigned to this session, in delivery order. */
  topics: string[];
  scheduledDate: string;
  status: "conducted" | "partial" | "cancelled" | "no_show";
  instructorName: string;
  employeeId: string | null;
  bigqueryInstructorUserId: string | null;
  instructorType: "campus" | "backup" | "unknown";
  amount: number;
  incentiveApproved: boolean;
  incentiveApprovedByName: string | null;
  incentiveApprovedAt: string | null;
  incentivePaid: boolean;
  incentivePaidByName: string | null;
  incentivePaidAt: string | null;
  /**
   * The single yes/no/na status this campus's staff actually track:
   * "yes" -- the incentive has been paid out; "no" -- this session earned an
   * incentive (Completed/Partially Completed, delivered by a campus
   * instructor) and it hasn't been paid yet, whether or not the BOA has
   * approved it so far; "na" -- either this session was cancelled or the
   * instructor didn't take it (no_show), or it was covered by a confirmed
   * backup instructor, who is never paid this incentive.
   */
  incentiveProcessed: "yes" | "no" | "na";
}

export interface IncentiveInstructorSummary {
  /** employeeId when known, else a normalized-name fallback key. */
  key: string;
  employeeId: string | null;
  bigqueryInstructorUserId: string | null;
  instructorName: string;
  instructorType: "campus" | "backup" | "unknown";
  /** True when this instructor has no canonical employee id yet -- the
   * historical/free-text-name case the "Fix instructor" action resolves. */
  needsIdentityReview: boolean;
  sessionsCompleted: number;
  sessionsApproved: number;
  sessionsPaid: number;
  amountPendingApproval: number;
  amountOwed: number;
  amountPaid: number;
  sessions: IncentiveSessionRow[];
}

export interface IncentiveCampusGroup {
  campus: string;
  instructors: IncentiveInstructorSummary[];
  totals: {
    sessionsCompleted: number;
    amountPendingApproval: number;
    amountOwed: number;
    amountPaid: number;
  };
}

/**
 * Every resolved, non-cancelled recovery session (Completed, Partially
 * Completed, or Not Completed/no-show -- everything except a still-`planned`
 * future session or a `cancelled` one), grouped first by campus and then by
 * instructor (keyed on the BigQuery employee id when the session has one,
 * since that's the canonical identity money should be owed against;
 * sessions still carrying only a free-text name are grouped by that
 * normalized name instead and flagged `needsIdentityReview`).
 *
 * Cancelled sessions never earn an incentive and were never actually
 * delivered, so they're left out of this tracker entirely rather than shown
 * as a no-op row. No-show sessions are still included (tagged
 * `incentiveProcessed: "na"`) since the instructor was scheduled and the
 * session simply wasn't taken; neither ever counts toward any instructor's
 * totals below -- only Completed/Partially Completed sessions do.
 *
 * `campuses` scopes the result the same way every other recovery query does:
 * `undefined` (superadmin/admin/hod) means every campus, an array (BOA)
 * restricts to just those.
 */
export async function getIncentiveTracker(
  campuses?: string[],
): Promise<IncentiveCampusGroup[]> {
  const filters = [
    inArray(recoverySessionsTable.status, [
      "conducted",
      "partial",
      "no_show",
    ]),
  ];
  if (campuses && campuses.length > 0) {
    filters.push(inArray(recoverySessionsTable.campus, campuses));
  }

  const rows = await db
    .select({
      id: recoverySessionsTable.id,
      campus: recoverySessionsTable.campus,
      subject: recoverySessionsTable.subject,
      scheduledDate: recoverySessionsTable.scheduledDate,
      status: recoverySessionsTable.status,
      instructorName: recoverySessionsTable.instructorName,
      employeeId: recoverySessionsTable.employeeId,
      bigqueryInstructorUserId: recoverySessionsTable.bigqueryInstructorUserId,
      instructorType: recoverySessionsTable.instructorType,
      incentiveApproved: recoverySessionsTable.incentiveApproved,
      incentiveApprovedBy: recoverySessionsTable.incentiveApprovedBy,
      incentiveApprovedAt: recoverySessionsTable.incentiveApprovedAt,
      incentivePaid: recoverySessionsTable.incentivePaid,
      incentivePaidBy: recoverySessionsTable.incentivePaidBy,
      incentivePaidAt: recoverySessionsTable.incentivePaidAt,
    })
    .from(recoverySessionsTable)
    .where(and(...filters))
    .orderBy(desc(recoverySessionsTable.scheduledDate));

  const approverIds = [
    ...new Set(
      rows
        .flatMap((r) => [r.incentiveApprovedBy, r.incentivePaidBy])
        .filter((v): v is string => Boolean(v)),
    ),
  ];
  const userNames = new Map<string, string>();
  if (approverIds.length > 0) {
    const users = await db
      .select({ id: usersTable.id, name: usersTable.name })
      .from(usersTable)
      .where(inArray(usersTable.id, approverIds));
    for (const u of users) userNames.set(u.id, u.name);
  }

  // Batch-fetch every session's assigned topic(s) in one query rather than
  // one query per session.
  const sessionIds = rows.map((r) => r.id);
  const topicsBySession = new Map<string, string[]>();
  if (sessionIds.length > 0) {
    const topicRows = await db
      .select({
        sessionId: sessionTopicsTable.sessionId,
        title: recoveryTopicsTable.topicTitle,
      })
      .from(sessionTopicsTable)
      .innerJoin(
        recoveryTopicsTable,
        eq(recoveryTopicsTable.id, sessionTopicsTable.topicId),
      )
      .where(inArray(sessionTopicsTable.sessionId, sessionIds))
      .orderBy(asc(sessionTopicsTable.orderInSession));
    for (const t of topicRows) {
      const list = topicsBySession.get(t.sessionId) ?? [];
      list.push(t.title);
      topicsBySession.set(t.sessionId, list);
    }
  }

  const campusGroups = new Map<
    string,
    Map<string, IncentiveInstructorSummary>
  >();

  for (const row of rows) {
    if (isExcludedInstitute(row.campus)) continue;
    const campusGroup =
      campusGroups.get(row.campus) ??
      new Map<string, IncentiveInstructorSummary>();
    campusGroups.set(row.campus, campusGroup);

    const key = row.employeeId
      ? `emp:${row.employeeId}`
      : `name:${row.instructorName.trim().toLowerCase()}`;
    const summary = campusGroup.get(key) ?? {
      key,
      employeeId: row.employeeId,
      bigqueryInstructorUserId: row.bigqueryInstructorUserId,
      instructorName: row.instructorName,
      instructorType: row.instructorType,
      needsIdentityReview: !row.employeeId,
      sessionsCompleted: 0,
      sessionsApproved: 0,
      sessionsPaid: 0,
      amountPendingApproval: 0,
      amountOwed: 0,
      amountPaid: 0,
      sessions: [],
    };

    // Backup instructors (confirmed non-campus, e.g. covering for an exited
    // campus instructor) are never paid the recovery incentive -- their
    // sessions still show up here for visibility, but always as "na".
    // Instructors still pending identity review ("unknown") stay eligible
    // until they're actually confirmed as backup.
    const eligible =
      (row.status === "conducted" || row.status === "partial") &&
      row.instructorType !== "backup";
    const amount = eligible ? RECOVERY_INCENTIVE_PER_SESSION : 0;
    const incentiveProcessed: "yes" | "no" | "na" = !eligible
      ? "na"
      : row.incentivePaid
        ? "yes"
        : "no";

    if (eligible) {
      summary.sessionsCompleted += 1;
      if (row.incentiveApproved) {
        summary.sessionsApproved += 1;
        if (row.incentivePaid) {
          summary.sessionsPaid += 1;
          summary.amountPaid += amount;
        } else {
          summary.amountOwed += amount;
        }
      } else {
        summary.amountPendingApproval += amount;
      }
    }

    summary.sessions.push({
      id: row.id,
      campus: row.campus,
      subject: row.subject,
      topics: topicsBySession.get(row.id) ?? [],
      scheduledDate: row.scheduledDate,
      status: row.status as "conducted" | "partial" | "cancelled" | "no_show",
      instructorName: row.instructorName,
      employeeId: row.employeeId,
      bigqueryInstructorUserId: row.bigqueryInstructorUserId,
      instructorType: row.instructorType,
      amount,
      incentiveApproved: row.incentiveApproved,
      incentiveApprovedByName: row.incentiveApprovedBy
        ? (userNames.get(row.incentiveApprovedBy) ?? null)
        : null,
      incentiveApprovedAt: row.incentiveApprovedAt?.toISOString() ?? null,
      incentivePaid: row.incentivePaid,
      incentivePaidByName: row.incentivePaidBy
        ? (userNames.get(row.incentivePaidBy) ?? null)
        : null,
      incentivePaidAt: row.incentivePaidAt?.toISOString() ?? null,
      incentiveProcessed,
    });

    campusGroup.set(key, summary);
  }

  return [...campusGroups.entries()]
    .map(([campus, instructorMap]) => {
      const instructors = [...instructorMap.values()].sort((a, b) =>
        a.instructorName.localeCompare(b.instructorName),
      );
      const totals = instructors.reduce(
        (acc, i) => ({
          sessionsCompleted: acc.sessionsCompleted + i.sessionsCompleted,
          amountPendingApproval:
            acc.amountPendingApproval + i.amountPendingApproval,
          amountOwed: acc.amountOwed + i.amountOwed,
          amountPaid: acc.amountPaid + i.amountPaid,
        }),
        {
          sessionsCompleted: 0,
          amountPendingApproval: 0,
          amountOwed: 0,
          amountPaid: 0,
        },
      );
      return { campus, instructors, totals };
    })
    .sort((a, b) => a.campus.localeCompare(b.campus));
}

/**
 * Admin-only correction: rewrites one session's stored instructor identity
 * (e.g. to fix a historical free-text name that never got matched to the
 * BigQuery roster, or to correct an outright mistake). Used both by the
 * Incentive Tracker's "Fix instructor" action and, indirectly, informs the
 * one-time backfill script's approach for bulk historical corrections.
 */
export async function setRecoverySessionInstructorIdentity(
  sessionId: string,
  identity: {
    instructorName: string;
    employeeId: string | null;
    bigqueryInstructorUserId: string | null;
    instructorType: "campus" | "backup" | "unknown";
  },
): Promise<RecoverySession | null> {
  const now = new Date();
  const [updated] = await db
    .update(recoverySessionsTable)
    .set({
      instructorName: identity.instructorName,
      employeeId: identity.employeeId,
      bigqueryInstructorUserId: identity.bigqueryInstructorUserId,
      instructorType: identity.instructorType,
      instructorTypeReviewedAt: now,
      updatedAt: now,
    })
    .where(eq(recoverySessionsTable.id, sessionId))
    .returning();
  return updated ?? null;
}

/**
 * The BOA (or admin/superadmin) confirmation step: "yes, this session was
 * actually delivered, pay the instructor for it." Only a Completed/Partially
 * Completed session is eligible. Revoking approval also clears `paid` --
 * paid can never be true while approved is false.
 */
export async function setRecoverySessionIncentiveApproval(
  sessionId: string,
  approved: boolean,
  approvedBy: string,
): Promise<
  | { ok: true; session: RecoverySession }
  | { ok: false; error: string; status: number }
> {
  const [existing] = await db
    .select()
    .from(recoverySessionsTable)
    .where(eq(recoverySessionsTable.id, sessionId))
    .limit(1);
  if (!existing) {
    return { ok: false, error: "Recovery session not found", status: 404 };
  }
  if (existing.status !== "conducted" && existing.status !== "partial") {
    return {
      ok: false,
      error:
        "Only a Completed or Partially Completed session can have its incentive approved",
      status: 409,
    };
  }

  const now = new Date();
  const [updated] = await db
    .update(recoverySessionsTable)
    .set({
      incentiveApproved: approved,
      incentiveApprovedBy: approved ? approvedBy : null,
      incentiveApprovedAt: approved ? now : null,
      ...(approved
        ? {}
        : { incentivePaid: false, incentivePaidBy: null, incentivePaidAt: null }),
      updatedAt: now,
    })
    .where(eq(recoverySessionsTable.id, sessionId))
    .returning();
  return { ok: true, session: updated! };
}

/**
 * Admin/superadmin-only: records that an already-approved session's
 * incentive has actually been paid out. Cannot be set on a session whose
 * incentive was never approved.
 */
export async function setRecoverySessionIncentivePaid(
  sessionId: string,
  paid: boolean,
  paidBy: string,
): Promise<
  | { ok: true; session: RecoverySession }
  | { ok: false; error: string; status: number }
> {
  const [existing] = await db
    .select()
    .from(recoverySessionsTable)
    .where(eq(recoverySessionsTable.id, sessionId))
    .limit(1);
  if (!existing) {
    return { ok: false, error: "Recovery session not found", status: 404 };
  }
  if (paid && !existing.incentiveApproved) {
    return {
      ok: false,
      error: "Approve this session's incentive before marking it paid",
      status: 409,
    };
  }

  const now = new Date();
  const [updated] = await db
    .update(recoverySessionsTable)
    .set({
      incentivePaid: paid,
      incentivePaidBy: paid ? paidBy : null,
      incentivePaidAt: paid ? now : null,
      updatedAt: now,
    })
    .where(eq(recoverySessionsTable.id, sessionId))
    .returning();
  return { ok: true, session: updated! };
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
    if (!delivered) status = "not_taught";
    
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
    `SELECT DISTINCT institute_name FROM ${ATTENDANCE_TABLE} WHERE is_current_semester = 1 AND ${excludeInstituteSql()} ORDER BY institute_name`,
  );
  return rows
    .map((r) => r.institute_name)
    .filter((name) => Boolean(name) && !isExcludedInstitute(name));
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
       AND ${excludeInstituteSql()}
     GROUP BY institute_name
     ORDER BY institute_name`,
  );
  return rows
    .filter((r) => Boolean(r.institute_name) && !isExcludedInstitute(r.institute_name))
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
       AND ${excludeInstituteSql()}
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

export type AttendanceGrain =
  | "university"
  | "university_subject"
  | "university_section"
  | "university_student";

export interface AttendanceGroupRow {
  university: string;
  subject: string | null;
  section: string | null;
  studentId: string | null;
  studentName: string | null;
  overallPct: number;
  grainPct: number;
  present: number;
  scheduled: number;
  sessions: number;
  students: number;
  absences: number;
  eligible: number;
  recoveryEligible: number;
  atRisk: number;
  ineligible: number;
}

/**
 * One closed scope. A date range does not also keep the current semester,
 * so a single day cannot include sessions from other days.
 */
export async function getAttendanceGroupStats(
  scope: SessionScope,
  opts: {
    grain: AttendanceGrain;
    campus?: string;
    semester?: string;
    dateFrom?: string;
    dateTo?: string;
  },
): Promise<AttendanceGroupRow[]> {
  const params: Record<string, unknown> = {};
  const clauses = [excludeInstituteSql()];
  if (opts.dateFrom && opts.dateTo) {
    params["dateFrom"] = opts.dateFrom;
    params["dateTo"] = opts.dateTo;
    clauses.push(
      "DATE(date) >= DATE(@dateFrom) AND DATE(date) <= DATE(@dateTo)",
    );
  }
  if (opts.semester) {
    params["semester"] = opts.semester;
    clauses.push("semester_title = @semester");
  } else {
    clauses.push("is_current_semester = 1");
  }
  if (scope.campuses && scope.campuses.length > 0) {
    params["campuses"] = scope.campuses;
    clauses.push("institute_name IN UNNEST(@campuses)");
  }
  if (scope.subjects && scope.subjects.length > 0) {
    params["subjects"] = scope.subjects;
    clauses.push("subject_title IN UNNEST(@subjects)");
  }
  if (opts.campus) {
    params["filterCampus"] = opts.campus;
    clauses.push("institute_name = @filterCampus");
  }
  const where = clauses.join(" AND ");
  const grain =
    opts.grain === "university_subject"
      ? {
          keys: "university, subject",
          rollKeys: "university, subject, student_id",
          select: "university, subject, CAST(NULL AS STRING) AS section, CAST(NULL AS STRING) AS student_id, CAST(NULL AS STRING) AS student_name",
          sessionKeys: "university, subject",
        }
      : opts.grain === "university_section"
        ? {
            keys: "university, section",
            rollKeys: "university, section, student_id",
            select: "university, CAST(NULL AS STRING) AS subject, section, CAST(NULL AS STRING) AS student_id, CAST(NULL AS STRING) AS student_name",
            sessionKeys: "university, section",
          }
        : opts.grain === "university_student"
          ? {
              keys: "university, student_id",
              rollKeys: "university, student_id",
              select: "university, CAST(NULL AS STRING) AS subject, ANY_VALUE(section) AS section, student_id, ANY_VALUE(student_name) AS student_name",
              sessionKeys: "university, student_id",
            }
          : {
              keys: "university",
              rollKeys: "university, student_id",
              select: "university, CAST(NULL AS STRING) AS subject, CAST(NULL AS STRING) AS section, CAST(NULL AS STRING) AS student_id, CAST(NULL AS STRING) AS student_name",
              sessionKeys: "university",
            };

  const rows = await bqQuery<{
    university: string;
    subject: string | null;
    section: string | null;
    student_id: string | null;
    student_name: string | null;
    overall_pct: string;
    grain_pct: string;
    present_n: string;
    scheduled_n: string;
    sessions_n: string;
    students_n: string;
    eligible_n: string;
    recovery_n: string;
    at_risk_n: string;
    ineligible_n: string;
  }>(
    `WITH base AS (
      SELECT
        TRIM(institute_name) AS university,
        NULLIF(TRIM(subject_title), '') AS subject,
        COALESCE(NULLIF(TRIM(batch_section_name), ''), 'Unknown') AS section,
        student_user_id AS student_id,
        student_name,
        ${SESSION_IDENTITY_SQL} AS session_key,
        ${ATTENDED_SQL} AS is_present
      FROM ${ATTENDANCE_TABLE}
      WHERE ${where}
        AND institute_name IS NOT NULL
        AND TRIM(institute_name) != ''
    ),
    per_student AS (
      SELECT
        university, subject, section, student_id,
        ANY_VALUE(student_name) AS student_name,
        COUNTIF(is_present) AS present_n,
        COUNT(*) AS scheduled_n
      FROM base
      GROUP BY university, subject, section, student_id
    ),
    uni AS (
      SELECT university,
        ROUND(SAFE_DIVIDE(SUM(present_n), SUM(scheduled_n)) * 100, 1) AS overall_pct
      FROM per_student
      GROUP BY university
    ),
    student_roll AS (
      SELECT ${grain.rollKeys},
        ANY_VALUE(student_name) AS student_name,
        ${grain.rollKeys.includes("subject") ? "" : "ANY_VALUE(subject) AS subject,"}
        ${grain.rollKeys.includes("section") ? "" : "ANY_VALUE(section) AS section,"}
        SUM(present_n) AS present_n,
        SUM(scheduled_n) AS scheduled_n
      FROM per_student
      GROUP BY ${grain.rollKeys}
    ),
    at_grain AS (
      SELECT ${grain.select},
        SUM(present_n) AS present_n,
        SUM(scheduled_n) AS scheduled_n,
        COUNT(*) AS students_n,
        COUNTIF(SAFE_DIVIDE(present_n, scheduled_n) * 100 >= 80) AS eligible_n,
        COUNTIF(SAFE_DIVIDE(present_n, scheduled_n) * 100 >= 60 AND SAFE_DIVIDE(present_n, scheduled_n) * 100 < 80) AS recovery_n,
        COUNTIF(SAFE_DIVIDE(present_n, scheduled_n) * 100 >= 50 AND SAFE_DIVIDE(present_n, scheduled_n) * 100 < 60) AS at_risk_n,
        COUNTIF(SAFE_DIVIDE(present_n, scheduled_n) * 100 < 50) AS ineligible_n
      FROM student_roll
      GROUP BY ${grain.keys}
    ),
    sessions AS (
      SELECT ${grain.sessionKeys}, COUNT(DISTINCT session_key) AS sessions_n
      FROM base
      GROUP BY ${grain.sessionKeys}
    )
    SELECT
      g.university, g.subject, g.section, g.student_id, g.student_name,
      uni.overall_pct,
      ROUND(SAFE_DIVIDE(g.present_n, g.scheduled_n) * 100, 1) AS grain_pct,
      g.present_n, g.scheduled_n, IFNULL(s.sessions_n, 0) AS sessions_n,
      g.students_n, g.eligible_n, g.recovery_n, g.at_risk_n, g.ineligible_n
    FROM at_grain g
    JOIN uni USING (university)
    LEFT JOIN sessions s USING (${grain.sessionKeys})
    ORDER BY g.university, grain_pct`,
    params,
    BQ_LOCATION,
    BQ_HEAVY_QUERY_TIMEOUT_MS,
  );

  return rows
    .filter((row) => !isExcludedInstitute(row.university))
    .map((row) => {
      const present = Number(row.present_n);
      const scheduled = Number(row.scheduled_n);
      return {
        university: row.university,
        subject: row.subject,
        section: row.section,
        studentId: row.student_id,
        studentName: row.student_name,
        overallPct: Number(row.overall_pct) || 0,
        grainPct: Number(row.grain_pct) || 0,
        present,
        scheduled,
        sessions: Number(row.sessions_n) || 0,
        students: Number(row.students_n) || 0,
        absences: Math.max(scheduled - present, 0),
        eligible: Number(row.eligible_n) || 0,
        recoveryEligible: Number(row.recovery_n) || 0,
        atRisk: Number(row.at_risk_n) || 0,
        ineligible: Number(row.ineligible_n) || 0,
      };
    });
}
