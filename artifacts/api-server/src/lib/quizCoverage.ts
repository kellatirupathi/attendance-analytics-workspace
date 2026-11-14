import { bqQuery, BQ_HEAVY_QUERY_TIMEOUT_MS, BQ_LOCATION, PROD_SEQUENCE_TABLE } from "./bigquery.js";
import { excludeInstituteSql, isExcludedInstitute } from "./excludedInstitutes.js";
import { attendanceSource, LATEST_SEMESTER_SQL, quizSource, REPORT_ROSTER_SQL } from "./queries.js";
import { createSnapshot, type Snapshot } from "./snapshot.js";
import { buildQuizCoveragePlanSql, buildQuizCoverageRowsSql, type QuizCoverageTables, type QuizType } from "./quizCoverageSql.js";
import { restrictToReportCourses, scopePlanToStudentColleges, type QuizCoverageModel, type QuizRow } from "./quizCoverageModel.js";
import { loadReportCourses, loadSavedReports } from "./reportCourses.js";
import { plainCourseName } from "./reportRemovedCourses.js";

/**
 * Shared copy of the Assessments tab data, one per tab (Classroom Quiz, Module Quiz, Skill Assessment),
 * refreshed in the background (snapshot.ts). The tab's cards, tables, student panel and downloads all read
 * this copy and filter it in memory, so changing a filter never waits for BigQuery.
 */
export type CoverageType = QuizType | "SKILL_ASSESSMENT";

const WORKSPACE = "kossip-helpers.niat_post_onboarding_engagement_ai_analytics_workspace";
const RESOURCE_TYPES = `\`${WORKSPACE}.niat_session_wise_resource_details\``;

const tables = (): QuizCoverageTables => ({
  attendance: attendanceSource(),
  quiz: quizSource(),
  prodSequence: PROD_SEQUENCE_TABLE,
  resourceTypes: RESOURCE_TYPES,
});

const num = (v: unknown) => Number(v) || 0;
const text = (v: unknown) => (v == null ? null : String(v));

async function loadQuiz(type: QuizType): Promise<QuizCoverageModel> {
  const t = tables();
  // The report's students and semester: current, or a batch between semesters on its last ended one (as Attendance Stats).
  const attWhere = `${excludeInstituteSql()} AND ${REPORT_ROSTER_SQL} AND ${LATEST_SEMESTER_SQL}`;
  const endedSections = `SELECT DISTINCT CONCAT(LOWER(REPLACE(CAST(section_id AS STRING), '-', '')), CHR(9), TRIM(CAST(semester_title AS STRING)))
    FROM ${t.attendance} WHERE is_current_semester = 0 AND ${attWhere}`;
  const [rows, plan] = await Promise.all([
    bqQuery<Record<string, unknown>>(
      buildQuizCoverageRowsSql(t, type, attWhere, excludeInstituteSql("q.institute_name")),
      {},
      BQ_LOCATION,
      BQ_HEAVY_QUERY_TIMEOUT_MS,
    ),
    bqQuery<Record<string, unknown>>(
      buildQuizCoveragePlanSql(t, type, excludeInstituteSql("p.institute_name"), endedSections),
      {},
      BQ_LOCATION,
      BQ_HEAVY_QUERY_TIMEOUT_MS,
    ),
  ]);
  const studentRows = rows.map((r) => ({
    campus: String(r["campus"]),
    section: String(r["section"] ?? ""),
    semester: text(r["semester"])?.trim() || null,
    batch: text(r["batch"])?.trim() || null,
    ended: r["ended"] === true || r["ended"] === "true",
    studentId: String(r["student_id"]),
    studentName: text(r["student_name"])?.trim() || null,
    subject: String(r["subject"]),
    category: text(r["category"]),
    scheduled: num(r["scheduled"]),
    // "completed" holds quizzes attempted (capped at held): the shared quiz rule, see quizScoreSql.ts.
    completed: num(r["attempted"]),
    avgScore: r["avg_score"] == null ? null : Number(r["avg_score"]),
    points: Number(r["points"] ?? 0) || 0,
    weight: num(r["scheduled"]),
  }));
  const planRows = plan.map((r) => ({
    campus: String(r["campus"]),
    section: String(r["section"] ?? ""),
    semester: text(r["semester"])?.trim() || null,
    batch: text(r["batch"])?.trim() || null,
    ended: r["ended"] === true || r["ended"] === "true",
    sectionId: String(r["section_id"] ?? ""),
    subject: String(r["subject"]),
    category: text(r["category"]),
    resourceId: String(r["resource_id"]),
    firstDate: String(r["first_date"] ?? ""),
  }));
  // The courses the student report shows (the report decides them; this only reads the result).
  const report = await loadReportCourses();
  const model = report ? restrictToReportCourses({ rows: studentRows, plan: planRows }, report) : { rows: studentRows, plan: planRows };
  return { rows: model.rows, plan: scopePlanToStudentColleges(model.rows, model.plan), ...(report?.names ? { reportCourses: report.names } : {}) };
}

/** "Takshasila University Batch 1-S-003" → "S-003", so the section filter reads the same on every tab. */
const shortSection = (batchSection: string | null): string => {
  const s = (batchSection ?? "").trim();
  const m = s.match(/(S-\d+)$/i);
  return m ? m[1]!.toUpperCase() : s.includes("-") ? s.slice(s.lastIndexOf("-") + 1) : s;
};

/**
 * Skill Assessment rows, one per student × course, taken from the saved reports: the assessments held and attempted
 * and the course's best score are exactly what the student's report shows. Colleges whose assessment data is not linked
 * to report courses have no rows (the tab says so).
 */
async function loadSkill(): Promise<QuizCoverageModel> {
  const [reports, categories, classroom] = await Promise.all([
    loadSavedReports(),
    bqQuery<{ campus: string; subject: string; category: string | null }>(
      `SELECT TRIM(institute_name) AS campus, TRIM(course_title) AS subject, ANY_VALUE(UPPER(TRIM(CAST(category AS STRING)))) AS category
       FROM ${PROD_SEQUENCE_TABLE} WHERE is_current_semester = 1 AND course_title IS NOT NULL GROUP BY campus, subject`,
      {},
      BQ_LOCATION,
      BQ_HEAVY_QUERY_TIMEOUT_MS,
    ),
    quizCoverageSnapshot("CLASSROOM_QUIZ").get(),
  ]);
  if (!reports) throw new Error("The saved student reports could not be loaded for the Skill Assessment tab");
  const categoryOf = new Map(categories.map((c) => [`${c.campus}\t${plainCourseName(c.subject)}`, c.category]));
  const sectionOf = new Map<string, { section: string; name: string | null; semester: string | null; batch: string | null; ended: boolean }>();
  for (const r of classroom.rows) {
    const key = r.studentId.toLowerCase().replace(/-/g, "");
    if (!sectionOf.has(key)) sectionOf.set(key, { section: r.section, name: r.studentName, semester: r.semester ?? null, batch: r.batch ?? null, ended: !!r.ended });
  }
  const rows: QuizRow[] = [];
  for (const report of reports) {
    const campus = (report.campus ?? "").trim();
    if (!campus || isExcludedInstitute(campus)) continue;
    const known = sectionOf.get(report.studentKey);
    for (const course of report.courses) {
      const skill = course.skill;
      if (!skill || skill.total <= 0) continue;
      rows.push({
        campus,
        section: known?.section || shortSection(report.section),
        semester: known?.semester ?? report.semester ?? null,
        batch: known?.batch ?? report.batch ?? null,
        ended: known?.ended ?? report.ended,
        studentId: report.studentKey,
        studentName: known?.name || report.name?.trim() || null,
        subject: course.name.trim(),
        category: categoryOf.get(`${campus}\t${plainCourseName(course.name)}`) ?? null,
        scheduled: skill.total,
        completed: Math.min(skill.attempted, skill.total),
        avgScore: skill.avgPct,
        // The report's Skill Assessment score of a course is its best score (0 when none was attempted): one point per row.
        points: skill.avgPct,
        weight: 1,
      });
    }
  }
  const reportCourses = new Map(reports.map((r) => [r.studentKey, r.courses.map((c) => c.name.trim())]));
  return { rows, plan: [], mode: "skill", reportCourses };
}

const snapshots = new Map<CoverageType, Snapshot<QuizCoverageModel>>();

/** The shared copy for one tab; created on first use (all three are warmed at start-up). */
export function quizCoverageSnapshot(type: CoverageType): Snapshot<QuizCoverageModel> {
  let s = snapshots.get(type);
  if (!s) {
    s = createSnapshot<QuizCoverageModel>(`assessments-${type.toLowerCase()}`, () => (type === "SKILL_ASSESSMENT" ? loadSkill() : loadQuiz(type)));
    snapshots.set(type, s);
  }
  return s;
}

// Warm every tab's copy with the other snapshots (startSnapshots runs every registered one).
quizCoverageSnapshot("CLASSROOM_QUIZ");
quizCoverageSnapshot("MODULE_QUIZ");
quizCoverageSnapshot("SKILL_ASSESSMENT");
