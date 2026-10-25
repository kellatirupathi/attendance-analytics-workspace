/**
 * SQL for GET /api/dashboard/assessments/summary (no imports, so it can be run on its own).
 *
 * Slot model, built from the quiz summary table (one row per student × course × quiz type):
 *   expected attempts = Σ total_scheduled_quizes        (one slot per student per conducted quiz)
 *   attempted         = Σ LEAST(total_completed_quizzes, total_scheduled_quizes)
 *   score sum         = Σ avg_best_attempt_percentage_score × attempted   (best attempt, already a %)
 * Rates are derived from these sums afterwards: sum first, divide last.
 *
 * Roster: eligible students enrolled in a subject this semester (attendance view), so a student
 * with no quiz rows still counts, with 0 expected attempts. Each section keeps its own current
 * semester window (attendance semester_start_date / semester_end_date), so batches of a term-wise
 * institute such as Aurora sit on different semesters at the same time.
 *
 * Distinct assessments (scheduled / conducted) come from the session resources: quiz units of the
 * section's current semester, conducted once the session date has passed or the session is marked
 * COMPLETED or PARTIALLY_COMPLETED (the Assessments definitions: "status is conducted or date has passed").
 * Student-wise rows carry the student's own slots as conducted / scheduled; the period and overall
 * rows still count distinct units.
 *
 * GROUPING SETS ((g), (g, p), (p), ()) returns rows, row × semester, the semester panel and the
 * overall roll-up in one pass; COUNT(DISTINCT) keeps student and assessment counts exact at every level.
 */

export type SummaryGroupBy = "campus" | "subject" | "section" | "semester" | "student";

export interface SummarySqlTables {
  attendance: string;
  quiz: string;
  semesterDetails: string;
  sessionResources: string;
  resourceTypes: string;
}

/** Session statuses that count a scheduled quiz as conducted. */
const CONDUCTED_STATUSES = ["COMPLETED", "PARTIALLY_COMPLETED"];

/** Row key per group-by, over the roster alias r. The period key is campus · batch · derived semester. */
const GROUP_KEY: Record<SummaryGroupBy, string> = {
  campus: "r.campus",
  subject: "r.subject",
  section: "CONCAT(r.campus, CHR(9), r.section)",
  semester: "r.period_key",
  student: "r.student_key",
};

const KEY = (column: string) => `LOWER(REPLACE(CAST(${column} AS STRING), '-', ''))`;

/** Shared CTEs: roster with its semester window, period labels and term-wise institutes. */
function baseCtes(t: SummarySqlTables, attWhere: string): string {
  return `
  period AS (
    -- Current semester per section: batch, title, derived semester (e.g. "Year 2 - Term 2" → "Semester 5")
    -- and the section's own dates. Keyed by campus + "batch-section" name, which the eligible-student
    -- source moves to the current campus for students who changed campus (their section_id stays old).
    SELECT
      TRIM(institute_name) AS campus,
      CONCAT(TRIM(batch_name), '-', TRIM(section_name)) AS batch_section,
      ANY_VALUE(${KEY("section_id")}) AS section_key,
      ANY_VALUE(TRIM(batch_name)) AS batch,
      ANY_VALUE(TRIM(semester_title)) AS period_title,
      ANY_VALUE(TRIM(COALESCE(NULLIF(derived_semester_title, ''), semester_title))) AS derived,
      MIN(semester_start_date) AS start_d,
      MAX(semester_end_date) AS end_d
    FROM ${t.semesterDetails}
    WHERE is_current_semester = 1 AND section_id IS NOT NULL
    GROUP BY campus, batch_section
  ),
  term_wise AS (
    -- Institutes on terms: "Term"/"Trimester" titles, or a batch starting a new period less than every 120 days
    -- (terms ~85 days apart; semesters 145–185).
    SELECT campus
    FROM (
      SELECT
        TRIM(institute_name) AS campus,
        COUNT(DISTINCT semester_id) AS n,
        DATE_DIFF(MAX(semester_start_date), MIN(semester_start_date), DAY) AS span,
        LOGICAL_OR(REGEXP_CONTAINS(LOWER(IFNULL(semester_title, '')), r'term|trimester')) AS titled
      FROM ${t.semesterDetails}
      WHERE semester_start_date IS NOT NULL
      GROUP BY campus, batch_id
    )
    GROUP BY campus
    HAVING LOGICAL_OR(titled OR (n >= 2 AND span / (n - 1) < 120))
  ),
  enrol AS (
    SELECT
      TRIM(a.institute_name) AS campus,
      COALESCE(NULLIF(TRIM(a.batch_section_name), ''), '—') AS section,
      ${KEY("a.section_id")} AS section_key,
      TRIM(a.subject_title) AS subject,
      ${KEY("a.student_user_id")} AS student_key,
      ANY_VALUE(CAST(a.student_user_id AS STRING)) AS student_id,
      ANY_VALUE(a.student_name) AS student_name,
      ANY_VALUE(TRIM(a.batch_name)) AS att_batch,
      ANY_VALUE(TRIM(a.semester_title)) AS att_semester,
      MIN(DATE(a.semester_start_date)) AS start_d,
      MAX(DATE(a.semester_end_date)) AS end_d
    FROM ${t.attendance} a
    WHERE ${attWhere}
      AND a.institute_name IS NOT NULL AND TRIM(a.institute_name) != ''
      AND a.student_user_id IS NOT NULL
      AND a.subject_title IS NOT NULL AND TRIM(a.subject_title) != '' AND UPPER(TRIM(a.subject_title)) != 'NULL'
    GROUP BY campus, section, section_key, subject, student_key
  ),
  roster AS (
    SELECT
      e.* REPLACE (
        COALESCE(p.section_key, e.section_key) AS section_key,
        COALESCE(p.start_d, e.start_d) AS start_d,
        COALESCE(p.end_d, e.end_d) AS end_d
      ),
      COALESCE(p.batch, e.att_batch, '—') AS batch,
      COALESCE(p.period_title, e.att_semester, '—') AS period_title,
      COALESCE(p.derived, e.att_semester, '—') AS derived,
      tw.campus IS NOT NULL AS term_wise,
      CONCAT(e.campus, CHR(9), COALESCE(p.batch, e.att_batch, '—'), CHR(9), COALESCE(p.derived, e.att_semester, '—')) AS period_key
    FROM enrol e
    LEFT JOIN period p ON p.campus = e.campus AND p.batch_section = e.section
    LEFT JOIN term_wise tw ON tw.campus = e.campus
  )`;
}

/** Page filters (campus, semester, section, subject, student search). Empty arrays mean "all". */
const FILTERS = `
      (IFNULL(ARRAY_LENGTH(@fCampuses), 0) = 0 OR campus IN UNNEST(@fCampuses))
      AND (@fSemester = '' OR derived = @fSemester)
      AND (IFNULL(ARRAY_LENGTH(@fSections), 0) = 0 OR CONCAT(campus, CHR(9), section) IN UNNEST(@fSections))
      AND (IFNULL(ARRAY_LENGTH(@fSubjects), 0) = 0 OR subject IN UNNEST(@fSubjects))
      AND (@fStudent = '' OR STRPOS(LOWER(IFNULL(student_name, '')), LOWER(@fStudent)) > 0 OR STRPOS(student_key, LOWER(REPLACE(@fStudent, '-', ''))) > 0)`;

export function buildAssessmentSummarySql(
  t: SummarySqlTables,
  groupBy: SummaryGroupBy,
  attWhere: string,
  quizWhere: string,
): string {
  const g = GROUP_KEY[groupBy];
  const byStudent = groupBy === "student";
  // Semester-wise rows are the periods themselves, so BigQuery folds (row_key) into (period_key):
  // group by the period only and tag each row as a row (gp = 1); the server reuses them for the panel.
  const bySemester = groupBy === "semester";
  const keys = bySemester
    ? { g: "period_key", gg: "GROUPING(period_key)", gp: "1", sets: "(period_key), ()" }
    : { g: "row_key", gg: "GROUPING(row_key)", gp: "GROUPING(period_key)", sets: "(row_key), (row_key, period_key), (period_key), ()" };
  return `WITH ${baseCtes(t, attWhere)},
  slots AS (
    -- One row per student × subject: the student's slots for the selected quiz types.
    SELECT
      r.*,
      -- Row key as its own column: grouping on it stays independent of period_key (same value for Semester-wise).
      ${g} AS row_key,
      SUM(IFNULL(SAFE_CAST(q.total_quizzes AS INT64), 0)) AS q_total,
      SUM(IFNULL(SAFE_CAST(q.total_scheduled_quizes AS INT64), 0)) AS q_expected,
      SUM(LEAST(IFNULL(SAFE_CAST(q.total_completed_quizzes AS INT64), 0), IFNULL(SAFE_CAST(q.total_scheduled_quizes AS INT64), 0))) AS q_attempted,
      SUM(IF(
        LEAST(IFNULL(SAFE_CAST(q.total_completed_quizzes AS INT64), 0), IFNULL(SAFE_CAST(q.total_scheduled_quizes AS INT64), 0)) > 0,
        IFNULL(SAFE_CAST(q.avg_best_attempt_percentage_score AS FLOAT64), 0)
          * LEAST(IFNULL(SAFE_CAST(q.total_completed_quizzes AS INT64), 0), IFNULL(SAFE_CAST(q.total_scheduled_quizes AS INT64), 0)),
        0)) AS q_score
    FROM roster r
    LEFT JOIN ${t.quiz} q
      ON TRIM(q.institute_name) = r.campus
     AND ${KEY("q.user_id")} = r.student_key
     AND (LOWER(TRIM(IFNULL(q.semester_course_title, ''))) = LOWER(r.subject) OR LOWER(TRIM(IFNULL(q.course_title, ''))) = LOWER(r.subject))
     AND UPPER(q.derived_unit_type) IN UNNEST(@types)
     AND ${quizWhere}
    WHERE ${FILTERS}
    GROUP BY row_key, ${["campus", "section", "section_key", "subject", "student_key", "student_id", "student_name", "att_batch", "att_semester", "start_d", "end_d", "batch", "period_title", "derived", "term_wise", "period_key"].map((c) => `r.${c}`).join(", ")}
  ),
  metrics AS (
    SELECT
      ${keys.g} AS g,
      period_key AS p,
      ${keys.gg} AS gg,
      ${keys.gp} AS gp,
      -- r_ prefix: an output alias equal to a grouped column would shadow it in GROUP BY.
      ANY_VALUE(campus) AS r_campus,
      ANY_VALUE(section) AS r_section,
      ANY_VALUE(subject) AS r_subject,
      ANY_VALUE(batch) AS r_batch,
      ANY_VALUE(period_title) AS r_period_title,
      ANY_VALUE(derived) AS r_derived,
      LOGICAL_OR(term_wise) AS r_term_wise,
      MIN(start_d) AS r_start,
      MAX(end_d) AS r_end,
      ANY_VALUE(student_id) AS r_student_id,
      ANY_VALUE(student_name) AS r_student_name,
      COUNT(DISTINCT student_key) AS students,
      COUNT(DISTINCT campus) AS campuses,
      SUM(q_total) AS slots_total,
      SUM(q_expected) AS expected_attempts,
      SUM(q_attempted) AS attempted,
      SUM(q_score) AS score_sum
    FROM slots
    GROUP BY GROUPING SETS (${keys.sets})
  ),
  units AS (
    -- Distinct quiz units of each section's current semester, matched to the roster's subjects.
    SELECT DISTINCT
      ${byStudent ? "" : "s.row_key, "}s.period_key,
      ${KEY("res.resource_id")} AS unit,
      (res.session_start_datetime <= CURRENT_DATETIME('Asia/Kolkata')
        OR UPPER(TRIM(IFNULL(res.session_status, ''))) IN (${CONDUCTED_STATUSES.map((s) => `'${s}'`).join(", ")})) AS done
    FROM ${t.sessionResources} res
    JOIN ${t.resourceTypes} rt
      ON rt.session_id = res.session_id AND rt.resource_id = res.resource_id
    JOIN (SELECT DISTINCT ${byStudent ? "" : "row_key, "}section_key, subject, period_key, start_d, end_d FROM slots) s
      ON s.section_key = ${KEY("res.section_id")}
     AND LOWER(TRIM(IFNULL(res.semester_course_title, ''))) = LOWER(s.subject)
    WHERE UPPER(rt.derived_unit_type) IN UNNEST(@types)
      AND DATE(res.session_start_datetime) BETWEEN s.start_d AND s.end_d
  ),
  unit_counts AS (
    -- Student-wise counts units per period and overall only; a unit list per student would be huge.
    SELECT
      ${byStudent ? "CAST(NULL AS STRING)" : keys.g} AS g,
      period_key AS p,
      ${byStudent ? "1" : keys.gg} AS gg,
      ${byStudent ? "GROUPING(period_key)" : keys.gp} AS gp,
      COUNT(DISTINCT unit) AS scheduled,
      COUNT(DISTINCT IF(done, unit, NULL)) AS conducted
    FROM units
    GROUP BY GROUPING SETS (${byStudent ? "(period_key), ()" : keys.sets})
  )
SELECT
  m.*,
  ${byStudent ? "IF(m.gg = 1, IFNULL(u.scheduled, 0), m.slots_total)" : "IFNULL(u.scheduled, 0)"} AS scheduled,
  ${byStudent ? "IF(m.gg = 1, IFNULL(u.conducted, 0), m.expected_attempts)" : "IFNULL(u.conducted, 0)"} AS conducted
FROM metrics m
LEFT JOIN unit_counts u
  ON u.gg = m.gg AND u.gp = m.gp AND IFNULL(u.g, '') = IFNULL(m.g, '') AND IFNULL(u.p, '') = IFNULL(m.p, '')`;
}

/** Quiz types the snapshot carries side by side. */
const SNAPSHOT_TYPES = ["CLASSROOM_QUIZ", "MODULE_QUIZ"];

/**
 * Snapshot rows for the in-memory summary: the `slots` rows of buildAssessmentSummarySql
 * with no page filters and no group key, carrying classroom (cq_) and module (mq_) slot sums
 * side by side. Summing one type's columns gives exactly that type's slots; adding both gives "all".
 */
export function buildAssessmentSlotsSnapshotSql(t: SummarySqlTables, attWhere: string, quizWhere: string): string {
  const completed = "LEAST(IFNULL(SAFE_CAST(q.total_completed_quizzes AS INT64), 0), IFNULL(SAFE_CAST(q.total_scheduled_quizes AS INT64), 0))";
  const sums = (prefix: string, type: string) => {
    const is = `UPPER(q.derived_unit_type) = '${type}'`;
    return `
      SUM(IF(${is}, IFNULL(SAFE_CAST(q.total_quizzes AS INT64), 0), 0)) AS ${prefix}_total,
      SUM(IF(${is}, IFNULL(SAFE_CAST(q.total_scheduled_quizes AS INT64), 0), 0)) AS ${prefix}_expected,
      SUM(IF(${is}, ${completed}, 0)) AS ${prefix}_attempted,
      SUM(IF(${is} AND ${completed} > 0, IFNULL(SAFE_CAST(q.avg_best_attempt_percentage_score AS FLOAT64), 0) * ${completed}, 0)) AS ${prefix}_score`;
  };
  const columns = ["campus", "section", "section_key", "subject", "student_key", "student_id", "student_name", "att_batch", "att_semester", "start_d", "end_d", "batch", "period_title", "derived", "term_wise", "period_key"].map((c) => `r.${c}`).join(", ");
  return `WITH ${baseCtes(t, attWhere)}
SELECT
  ${columns},${sums("cq", SNAPSHOT_TYPES[0]!)},${sums("mq", SNAPSHOT_TYPES[1]!)}
FROM roster r
LEFT JOIN ${t.quiz} q
  ON TRIM(q.institute_name) = r.campus
 AND ${KEY("q.user_id")} = r.student_key
 AND (LOWER(TRIM(IFNULL(q.semester_course_title, ''))) = LOWER(r.subject) OR LOWER(TRIM(IFNULL(q.course_title, ''))) = LOWER(r.subject))
 AND UPPER(q.derived_unit_type) IN (${SNAPSHOT_TYPES.map((s) => `'${s}'`).join(", ")})
 AND ${quizWhere}
GROUP BY ${columns}`;
}

/**
 * Snapshot of quiz units: for every roster section × subject × semester window, the distinct
 * quiz units in that window, whether each is conducted, and its type. Same matching as the
 * `units` CTE of buildAssessmentSummarySql.
 */
export function buildAssessmentUnitsSnapshotSql(t: SummarySqlTables, attWhere: string): string {
  return `WITH ${baseCtes(t, attWhere)},
  windows AS (SELECT DISTINCT section_key, subject, start_d, end_d FROM roster)
SELECT DISTINCT
  w.section_key, w.subject, w.start_d, w.end_d,
  UPPER(rt.derived_unit_type) AS unit_type,
  ${KEY("res.resource_id")} AS unit,
  (res.session_start_datetime <= CURRENT_DATETIME('Asia/Kolkata')
    OR UPPER(TRIM(IFNULL(res.session_status, ''))) IN (${CONDUCTED_STATUSES.map((s) => `'${s}'`).join(", ")})) AS done
FROM ${t.sessionResources} res
JOIN ${t.resourceTypes} rt
  ON rt.session_id = res.session_id AND rt.resource_id = res.resource_id
JOIN windows w
  ON w.section_key = ${KEY("res.section_id")}
 AND LOWER(TRIM(IFNULL(res.semester_course_title, ''))) = LOWER(w.subject)
WHERE UPPER(rt.derived_unit_type) IN (${SNAPSHOT_TYPES.map((s) => `'${s}'`).join(", ")})
  AND DATE(res.session_start_datetime) BETWEEN w.start_d AND w.end_d`;
}

/** Filter options for the page: campuses, current derived semesters, sections and subjects in scope. */
export function buildAssessmentOptionsSql(t: SummarySqlTables, attWhere: string): string {
  return `WITH ${baseCtes(t, attWhere)}
SELECT DISTINCT campus, derived, section, subject
FROM roster`;
}
