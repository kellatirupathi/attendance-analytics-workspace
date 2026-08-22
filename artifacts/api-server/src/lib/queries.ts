import {
  bqQuery,
  pct,
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
): string {
  const clauses: string[] = ["is_current_semester = 1"];
  if (scope.campuses && scope.campuses.length > 0) {
    clauses.push("institute_name IN UNNEST(@campuses)");
    params["campuses"] = scope.campuses;
  }
  if (scope.subjects && scope.subjects.length > 0) {
    clauses.push("subject_title IN UNNEST(@subjects)");
    params["subjects"] = scope.subjects;
  }
  return clauses.join(" AND ");
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
  } = {},
): Promise<StudentSearchResult[]> {
  const params: Record<string, unknown> = {};
  const where = scopeClause(scope, params);
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
          IF(SAFE_CAST(total_completed_quizzes AS INT64) > 0,
             SAFE_CAST(avg_best_attempt_percentage_score AS FLOAT64), NULL))) AS classroom_avg,
        AVG(IF(UPPER(derived_unit_type) LIKE '%MODULE%',
          IF(SAFE_CAST(total_completed_quizzes AS INT64) > 0,
             SAFE_CAST(avg_best_attempt_percentage_score AS FLOAT64), NULL), NULL)) AS module_avg
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
): Promise<CampusSummaryItem[]> {
  const params: Record<string, unknown> = {};
  const where = scopeClause(scope, params);
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
  opts: { campus?: string } = {},
): Promise<SubjectSummaryItem[]> {
  const params: Record<string, unknown> = {};
  const where = scopeClause(scope, params);
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
  opts: { subject: string; campus?: string; section?: string },
): Promise<SessionSummaryItem[]> {
  const params: Record<string, unknown> = { subject: opts.subject };
  const where = scopeClause(scope, params);
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
  opts: { campus: string; section?: string },
): Promise<CampusSessionRow[]> {
  const params: Record<string, unknown> = { campus: opts.campus };
  const where = scopeClause(scope, params);
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
): Promise<RecoveryCampusData> {
  const params: Record<string, unknown> = { campus };
  const where = scopeClause(scope, params);

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
    const attendancePct =
      attendance && attendance.totalCount > 0
        ? Math.round(
            (attendance.presentCount / attendance.totalCount) * 1000,
          ) / 10
        : null;
    const progressStatus = progressByTopic.get(topic.id)?.status;

    let status: SessionTrackerStatus;
    if (!hasAttendance || attendancePct === null) {
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
    // Average over quizzes the student actually attempted (score > 0),
    // including legitimate 0% scores; unattempted (Pending) rows are excluded.
    const attemptedItems = items.filter((q) => q.score > 0);
    const avgPct =
      attemptedItems.length > 0
        ? Math.round(
            (attemptedItems.reduce((s, q) => s + q.percentage, 0) /
              attemptedItems.length) *
              10,
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
