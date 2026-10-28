import { bqQuery, BQ_HEAVY_QUERY_TIMEOUT_MS, BQ_LOCATION, PROD_SEQUENCE_TABLE } from "./bigquery.js";
import { excludeInstituteSql } from "./excludedInstitutes.js";
import { attendanceSource } from "./queries.js";
import { createSnapshot, type Snapshot } from "./snapshot.js";
import { buildQuizCoveragePlanSql, buildQuizCoverageRowsSql, type QuizCoverageTables, type QuizType } from "./quizCoverageSql.js";
import { restrictToReportCourses, scopePlanToStudentColleges, type QuizCoverageModel } from "./quizCoverageModel.js";
import { loadReportCourses } from "./reportCourses.js";

/**
 * Shared copy of the Assessments quiz-tab data, one per quiz type, refreshed in the background
 * (snapshot.ts). The tab's cards, tables, student panel and downloads all read this copy and filter
 * it in memory, so changing a filter never waits for BigQuery.
 */
const WORKSPACE = "kossip-helpers.niat_post_onboarding_engagement_ai_analytics_workspace";
const QUIZ_TABLE = `\`${WORKSPACE}.z_niat_students_classroom_and_module_quiz_details\``;
const RESOURCE_TYPES = `\`${WORKSPACE}.niat_session_wise_resource_details\``;

const tables = (): QuizCoverageTables => ({
  attendance: attendanceSource(),
  quiz: QUIZ_TABLE,
  prodSequence: PROD_SEQUENCE_TABLE,
  resourceTypes: RESOURCE_TYPES,
});

const num = (v: unknown) => Number(v) || 0;
const text = (v: unknown) => (v == null ? null : String(v));

async function load(type: QuizType): Promise<QuizCoverageModel> {
  const t = tables();
  const attWhere = `${excludeInstituteSql()} AND is_current_semester = 1`;
  const [rows, plan] = await Promise.all([
    bqQuery<Record<string, unknown>>(
      buildQuizCoverageRowsSql(t, type, attWhere, excludeInstituteSql("q.institute_name")),
      {},
      BQ_LOCATION,
      BQ_HEAVY_QUERY_TIMEOUT_MS,
    ),
    bqQuery<Record<string, unknown>>(
      buildQuizCoveragePlanSql(t, type, excludeInstituteSql("p.institute_name")),
      {},
      BQ_LOCATION,
      BQ_HEAVY_QUERY_TIMEOUT_MS,
    ),
  ]);
  const studentRows = rows.map((r) => ({
    campus: String(r["campus"]),
    section: String(r["section"] ?? ""),
    studentId: String(r["student_id"]),
    studentName: text(r["student_name"])?.trim() || null,
    subject: String(r["subject"]),
    category: text(r["category"]),
    scheduled: num(r["scheduled"]),
    completed: num(r["completed"]),
    avgScore: r["avg_score"] == null ? null : Number(r["avg_score"]),
  }));
  const planRows = plan.map((r) => ({
    campus: String(r["campus"]),
    section: String(r["section"] ?? ""),
    sectionId: String(r["section_id"] ?? ""),
    subject: String(r["subject"]),
    category: text(r["category"]),
    resourceId: String(r["resource_id"]),
    firstDate: String(r["first_date"] ?? ""),
  }));
  // The courses the student report shows (the report decides them; this only reads the result).
  const report = await loadReportCourses();
  const model = report ? restrictToReportCourses({ rows: studentRows, plan: planRows }, report) : { rows: studentRows, plan: planRows };
  return { rows: model.rows, plan: scopePlanToStudentColleges(model.rows, model.plan) };
}

const snapshots = new Map<QuizType, Snapshot<QuizCoverageModel>>();

/** The shared copy for one quiz type; created on first use (the Classroom Quiz copy is warmed at start-up). */
export function quizCoverageSnapshot(type: QuizType): Snapshot<QuizCoverageModel> {
  let s = snapshots.get(type);
  if (!s) {
    s = createSnapshot<QuizCoverageModel>(`quiz-coverage-${type.toLowerCase()}`, () => load(type));
    snapshots.set(type, s);
  }
  return s;
}

// Warm the Classroom Quiz copy with the other snapshots (startSnapshots runs every registered one).
quizCoverageSnapshot("CLASSROOM_QUIZ");
