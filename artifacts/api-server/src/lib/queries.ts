import { bqQuery, pct, validateStudentId } from "./bigquery.js";
import type { SessionScope } from "./rbac.js";

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
      WHERE student_user_id = @studentId
        AND is_current_semester = 1
    )
    GROUP BY student_user_id`,
    { studentId },
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
    WHERE student_user_id = @studentId
      AND is_current_semester = 1
    GROUP BY subject_title
    ORDER BY subject_title`,
    { studentId },
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
    WHERE student_user_id = @studentId
      AND is_current_semester = 1
    ORDER BY date DESC
    LIMIT 500`,
    { studentId },
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
  const params: Record<string, unknown> = { q: `%${q}%`, exactId: q };
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
      AND (LOWER(student_name) LIKE LOWER(@q) OR student_user_id = @exactId)
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
      "AND (LOWER(student_name) LIKE LOWER(@q) OR student_user_id = @q)";
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
    LEFT JOIN quiz ON quiz.user_id = att.student_user_id
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
): Promise<SubjectSummaryItem[]> {
  const params: Record<string, unknown> = {};
  const where = scopeClause(scope, params);
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
    WHERE ${where}
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
    WHERE user_id = @studentId
    ORDER BY semester_course_title, course_title`,
    { studentId },
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
