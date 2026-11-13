/**
 * SQL for the Assessments "Classroom Quiz" tab (no imports, so it can be run on its own).
 *
 * Two result sets, loaded once into a shared snapshot (quizCoverage.ts) and filtered in memory:
 *   rows  one row per student × subject × quiz type, from the quiz table (z_niat_students_classroom_and_module_quiz_details):
 *         scheduled / completed quizzes and the best-attempt average score.
 *         Only the student's own semester's subjects are kept: a student's quiz rows for a course
 *         that is not in their section's semester (e.g. Semester 1 courses of a Semester 3 student) are
 *         dropped: the student's section comes from the attendance view and its courses from the prod
 *         sequence. The student's semester is the report's (attWhere): the current one, or for a student
 *         with no current rows (a batch between semesters) their last ended semester, whose courses are
 *         that semester's in the prod sequence (matched by title, since it is no longer current).
 *   plan  the quizzes planned in the prod sequence, one row per section × quiz (so the Available and
 *         Scheduled so far cards count a quiz once for every section that has it).
 */

export interface QuizCoverageTables {
  /** Eligible attendance rows (current semester roster, with niat_course_category). */
  attendance: string;
  quiz: string;
  prodSequence: string;
  resourceTypes: string;
}

const KEY = (column: string) => `LOWER(REPLACE(CAST(${column} AS STRING), '-', ''))`;

/** Quiz types the tab can show. Module quizzes keep real quizzes only (no "Cheat Sheet", "Reading Material"). */
export const QUIZ_TYPES = ["CLASSROOM_QUIZ", "MODULE_QUIZ"] as const;
export type QuizType = (typeof QUIZ_TYPES)[number];

/**
 * @param restrictToSemester false gives the unrestricted rows (every quiz row of the student), only used to
 *        measure what the semester restriction changes.
 */
export function buildQuizCoverageRowsSql(
  t: QuizCoverageTables,
  type: QuizType,
  attWhere: string,
  quizWhere: string,
  restrictToSemester = true,
): string {
  return `WITH stu AS (
    SELECT
      TRIM(a.institute_name) AS campus,
      ${KEY("a.student_user_id")} AS student_key,
      ${KEY("a.section_id")} AS section_key,
      ANY_VALUE(a.student_name) AS student_name,
      ANY_VALUE(TRIM(a.semester_title)) AS semester,
      -- The batch of the student's latest session (a transferred student's old rows keep the old college's batch).
      ARRAY_AGG(COALESCE(NULLIF(TRIM(a.batch_name), ''), 'Unknown') ORDER BY DATE(a.date) DESC LIMIT 1)[OFFSET(0)] AS batch,
      LOGICAL_AND(a.is_current_semester = 0) AS ended
    FROM ${t.attendance} a
    WHERE ${attWhere}
      AND a.institute_name IS NOT NULL AND TRIM(a.institute_name) != ''
      AND a.student_user_id IS NOT NULL
    GROUP BY campus, student_key, section_key
  ),
  courses AS (
    SELECT DISTINCT ${KEY("section_id")} AS section_key, LOWER(TRIM(course_title)) AS subject_key,
           is_current_semester = 1 AS is_cur, TRIM(CAST(semester_title AS STRING)) AS sem
    FROM ${t.prodSequence}
    WHERE course_title IS NOT NULL AND TRIM(course_title) != ''
  ),
  enrol AS (
    -- The student's own section's courses: the current semester's, or for an ended student that ended semester's.
    SELECT DISTINCT s.campus, s.student_key, c.subject_key
    FROM stu s JOIN courses c ON c.section_key = s.section_key
     AND ((NOT s.ended AND c.is_cur) OR (s.ended AND NOT c.is_cur AND c.sem = s.semester))
  ),
  student_names AS (
    SELECT campus, student_key, ANY_VALUE(student_name) AS student_name, ANY_VALUE(semester) AS semester,
           ANY_VALUE(batch) AS batch, LOGICAL_AND(ended) AS ended
    FROM stu GROUP BY campus, student_key
  ),
  cat AS (
    -- The current semester's category first; an ended semester's course keeps its own.
    SELECT TRIM(institute_name) AS campus, LOWER(TRIM(course_title)) AS subject_key,
           ARRAY_AGG(UPPER(TRIM(CAST(category AS STRING))) IGNORE NULLS ORDER BY is_current_semester DESC LIMIT 1)[SAFE_OFFSET(0)] AS category
    FROM ${t.prodSequence}
    GROUP BY campus, subject_key
  ),
  z AS (
    SELECT
      TRIM(q.institute_name) AS campus,
      TRIM(q.section_name) AS section,
      ${KEY("q.user_id")} AS student_key,
      ANY_VALUE(CAST(q.user_id AS STRING)) AS student_id,
      TRIM(q.semester_course_title) AS subject,
      SUM(IFNULL(SAFE_CAST(q.total_scheduled_quizes AS INT64), 0)) AS scheduled,
      SUM(IFNULL(SAFE_CAST(q.total_completed_quizzes AS INT64), 0)) AS completed,
      AVG(SAFE_CAST(q.avg_best_attempt_percentage_score AS FLOAT64)) AS avg_score
    FROM ${t.quiz} q
    WHERE ${quizWhere}
      AND UPPER(CAST(q.derived_unit_type AS STRING)) = '${type}'
      AND q.institute_name IS NOT NULL AND TRIM(q.institute_name) != ''
      AND q.semester_course_title IS NOT NULL AND TRIM(q.semester_course_title) != ''
    GROUP BY campus, section, student_key, subject
  )
  SELECT z.campus, z.section, z.student_id, z.subject, c.category, n.student_name, n.semester, n.batch, n.ended,
         z.scheduled, z.completed, z.avg_score
  FROM z
  ${restrictToSemester ? "JOIN" : "LEFT JOIN"} enrol e
    ON e.campus = z.campus AND e.student_key = z.student_key AND e.subject_key = LOWER(z.subject)
  LEFT JOIN student_names n ON n.campus = z.campus AND n.student_key = z.student_key
  LEFT JOIN cat c ON c.campus = z.campus AND c.subject_key = LOWER(z.subject)`;
}

/**
 * Planned quizzes of the current semester (and, with `endedSectionsSql`, of each ended section's last semester:
 * "section_key\tsemester title" keys), one row per section × quiz, with the date of its first session.
 * The prod sequence also holds colleges that are not NIAT campuses (the Intensive Offline ones, Training
 * Institute); quizCoverage.ts keeps only the colleges that have student rows (scopePlanToStudentColleges).
 */
export function buildQuizCoveragePlanSql(t: QuizCoverageTables, type: QuizType, planWhere: string, endedSectionsSql?: string): string {
  const moduleOnly = type === "MODULE_QUIZ" ? "AND rt.unit_type IN ('ASSESSMENT', 'EXAM')" : "";
  return `WITH quiz AS (
    SELECT DISTINCT rt.session_id, rt.resource_id
    FROM ${t.resourceTypes} rt
    WHERE UPPER(CAST(rt.derived_unit_type AS STRING)) = '${type}' ${moduleOnly}
  )
  SELECT
    TRIM(p.institute_name) AS campus,
    TRIM(p.section_name) AS section,
    ANY_VALUE(TRIM(p.semester_title)) AS semester,
    COALESCE(NULLIF(TRIM(p.batch_name), ''), 'Unknown') AS batch,
    LOGICAL_AND(p.is_current_semester = 0) AS ended,
    ${KEY("p.section_id")} AS section_id,
    TRIM(p.course_title) AS subject,
    UPPER(TRIM(CAST(p.category AS STRING))) AS category,
    ${KEY("q.resource_id")} AS resource_id,
    CAST(MIN(DATE(p.session_start_datetime)) AS STRING) AS first_date
  FROM ${t.prodSequence} p
  JOIN quiz q ON q.session_id = p.session_id
  WHERE ${endedSectionsSql
    ? `(p.is_current_semester = 1 OR CONCAT(${KEY("p.section_id")}, CHR(9), TRIM(CAST(p.semester_title AS STRING))) IN (${endedSectionsSql}))`
    : "p.is_current_semester = 1"} AND ${planWhere}
  GROUP BY campus, section, batch, section_id, subject, category, resource_id`;
}
