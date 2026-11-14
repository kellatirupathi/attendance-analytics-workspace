import { sql, type SQL } from "drizzle-orm";
import { db } from "@workspace/db";
import { excludedInstituteNames } from "./excludedInstitutes.js";
import { getQuizQuestions } from "./spiQuiz.js";
import type { SessionScope } from "./rbac.js";
import { pageOf, type Page, type PageRequest } from "./pagination.js";
import { cacheGet, cacheSet } from "./cache.js";

/**
 * SPI quiz analytics for staff: counts, scores and times from spi_quiz_attempts / spi_quiz_answers,
 * out of the students in the synced reports (spi_report_cache plus ended-semester students from
 * spi_report_history, as on Directory and Overview: names, college, semester, section).
 * All Postgres, aggregated in SQL; no BigQuery on this page.
 * The date range applies to when a student first opened the report (India time).
 * `score` keeps only students who completed the quiz with exactly that score.
 */
export interface QuizRosterFilters {
  colleges?: string[];
  /** "college\tbatch", as on Student Attendance Stats. */
  batches?: string[];
  /** Running: students on a current-semester report; ended: their semester ended (last report in history). */
  term?: "running" | "ended";
  semesters?: string[];
  sections?: string[];
}

/** "not_started" = never opened the report; the other three follow the student's attempt row. */
export type QuizStatus = "not_started" | "opened" | "started" | "completed";
export const QUIZ_STATUSES: QuizStatus[] = ["not_started", "opened", "started", "completed"];

export interface QuizAnalyticsFilters extends QuizRosterFilters {
  from?: string;
  to?: string;
  score?: number;
  includeTest: boolean;
  /** Keeps only students at these stages (students table and export); empty = every stage. */
  statuses?: QuizStatus[];
  /** Student search (students table and export): part of the name, or the start of the student ID (hyphens optional). */
  student?: string;
}

export interface QuizRosterOption {
  college: string;
  batch: string;
  semester: string;
  section: string;
  ended: boolean;
  students: number;
}

export interface QuizGroupRow {
  name: string;
  students: number;
  /** Students whose semester ended (their last report is in history). */
  endedStudents: number;
  opened: number;
  started: number;
  completed: number;
  avgScore: number | null;
}

export interface QuizStudentRow {
  studentId: string;
  name: string | null;
  college: string | null;
  semester: string | null;
  section: string | null;
  /** The student's semester ended. */
  ended: boolean;
  status: QuizStatus;
  score: number | null;
  totalQuestions: number | null;
  seconds: number | null;
  openedAt: string | null;
  finishedAt: string | null;
}

export interface QuizAnalytics {
  totals: QuizGroupRow & {
    avgSeconds: number | null;
    questionCount: number;
    /** Students who never opened the report. */
    notStarted: number;
    /** Students who have not seen their report: everyone who has not completed the quiz. */
    notSeen: number;
  };
  groupBy: "college" | "section";
  groups: QuizGroupRow[];
  scoreSpread: { score: number; students: number }[];
  questions: {
    id: string;
    position: number;
    topic: string;
    question: string;
    answered: number;
    correctPct: number | null;
    avgSeconds: number | null;
  }[];
  students: Page<QuizStudentRow>;
}

type Row = Record<string, unknown>;

/**
 * The student roster (name only from the report, not the whole report JSON, so the 8 queries of a request stay light):
 * the live cache plus students it no longer has because their semester ended (their latest
 * spi_report_history row), the same students as Directory and Overview. The quiz tables keep every student who
 * opened the report, ended semesters included, so a cache-only roster gave colleges such as Chaitanya more
 * completions than students (317%).
 */
const ROSTER_WITH_HISTORY = sql.raw(`(
  SELECT student_id, college, semester, section, batch, false AS ended, report->>'studentName' AS name FROM spi_report_cache
  UNION ALL
  (SELECT DISTINCT ON (h.student_id) h.student_id, h.college, h.semester, h.section, h.batch, true AS ended, h.report->>'studentName' AS name
   FROM spi_report_history h
   WHERE NOT EXISTS (SELECT 1 FROM spi_report_cache c WHERE c.student_id = h.student_id)
   ORDER BY h.student_id, h.built_at DESC)
) roster`);
const ROSTER_CACHE_ONLY = sql.raw("(SELECT student_id, college, semester, section, batch, false AS ended, report->>'studentName' AS name FROM spi_report_cache) roster");

/** The roster's batch as one key, the same text the page sends ("college\tbatch"). */
const BATCH_KEY = sql.raw(`CONCAT(college, E'\\t', COALESCE(NULLIF(TRIM(batch), ''), 'Unknown'))`);

/** Batch and running / ended tests on roster columns. */
function batchParts(f: QuizRosterFilters): SQL[] {
  const parts: SQL[] = [];
  if (f.batches?.length) parts.push(sql`${BATCH_KEY} IN (${list(f.batches)})`);
  if (f.term === "running") parts.push(sql`NOT ended`);
  if (f.term === "ended") parts.push(sql`ended`);
  return parts;
}

/** Runs a roster query with history; on a database without spi_report_history yet, with the live cache alone. */
async function rosterRows(query: (roster: SQL) => SQL): Promise<Row[]> {
  try {
    return (await db.execute(query(ROSTER_WITH_HISTORY))).rows as Row[];
  } catch {
    return (await db.execute(query(ROSTER_CACHE_ONLY))).rows as Row[];
  }
}

const num = (v: unknown): number => Number(v ?? 0);
const numOrNull = (v: unknown): number | null => (v == null ? null : Number(v));
const list = (values: string[]) => sql.join(values.map((v) => sql`${v}`), sql`, `);

/**
 * College / batch / semester / section filters and the user's campuses; shared by the roster and the quiz tables.
 * `on`: "roster" rows carry batch and ended; attempt rows do not, so they keep the students of those roster rows.
 */
function placementParts(
  scope: SessionScope,
  f: QuizRosterFilters,
  alias = "",
  on: "roster" | "attempts" = "roster",
  /** Attempts only: keep roster students alone (an attempt by a student with no report is not counted). */
  rosterOnly = false,
): SQL[] {
  const col = (name: string) => sql.raw(alias ? `${alias}.${name}` : name);
  const parts: SQL[] = [sql`TRUE`];
  const excluded = excludedInstituteNames();
  if (excluded.length) parts.push(sql`LOWER(TRIM(COALESCE(${col("college")}, ''))) NOT IN (${list(excluded)})`);
  if (scope.campuses?.length) parts.push(sql`${col("college")} IN (${list(scope.campuses)})`);
  if (f.colleges?.length) parts.push(sql`${col("college")} IN (${list(f.colleges)})`);
  if (f.semesters?.length) parts.push(sql`${col("semester")} IN (${list(f.semesters)})`);
  if (f.sections?.length) parts.push(sql`${col("section")} IN (${list(f.sections)})`);
  const batch = batchParts(f);
  if (on === "roster") {
    if (batch.length) parts.push(sql.join(batch, sql` AND `));
  } else if (batch.length || rosterOnly) {
    parts.push(sql`${col("student_id")} IN (SELECT student_id FROM ${ROSTER_WITH_HISTORY} WHERE ${batch.length ? sql.join(batch, sql` AND `) : sql`TRUE`})`);
  }
  return parts;
}

function whereFor(scope: SessionScope, f: QuizAnalyticsFilters, alias = ""): SQL {
  const col = (name: string) => sql.raw(alias ? `${alias}.${name}` : name);
  // Test logins have no report, so they are kept only when asked for; everyone else must be a roster student,
  // so the counts never include someone outside "All students" (1 such attempt in Prod, 2026-11-14).
  const parts = placementParts(scope, f, alias, "attempts", !f.includeTest);
  if (!f.includeTest) parts.push(sql`NOT ${col("is_test")}`);
  if (f.from) parts.push(sql`(${col("opened_at")} AT TIME ZONE 'Asia/Kolkata')::date >= ${f.from}::date`);
  if (f.to) parts.push(sql`(${col("opened_at")} AT TIME ZONE 'Asia/Kolkata')::date <= ${f.to}::date`);
  if (f.score != null) parts.push(sql`${col("finished_at")} IS NOT NULL AND ${col("score")} = ${f.score}`);
  return sql.join(parts, sql` AND `);
}

/** College × batch × semester × section choices for the filters, from the roster (ended semesters included). */
export async function getQuizFilterOptions(scope: SessionScope): Promise<QuizRosterOption[]> {
  const key = `spi-quiz-options:v1:${JSON.stringify(scope)}`;
  const cached = cacheGet<QuizRosterOption[]>(key);
  if (cached) return cached;
  const rows = await rosterRows((roster) => sql`SELECT college, COALESCE(NULLIF(TRIM(batch), ''), 'Unknown') AS batch, semester, section,
      BOOL_AND(ended) AS ended, COUNT(*) AS students FROM ${roster}
    WHERE ${sql.join(placementParts(scope, {}), sql` AND `)}
      AND college IS NOT NULL AND semester IS NOT NULL AND section IS NOT NULL
    GROUP BY 1, 2, 3, 4
    ORDER BY college, batch, semester, section`);
  const out = rows.map((r) => ({
    college: String(r["college"]),
    batch: String(r["batch"]),
    semester: String(r["semester"]),
    section: String(r["section"]),
    ended: r["ended"] === true || r["ended"] === "t" || r["ended"] === "true",
    students: num(r["students"]),
  }));
  cacheSet(key, out, 5 * 60 * 1000);
  return out;
}

/** Students in the roster: the total and one count per college (or per section once a college is chosen). */
async function getRosterCounts(
  scope: SessionScope,
  f: QuizRosterFilters,
  groupBy: "college" | "section",
): Promise<{ total: number; groups: { name: string; students: number; ended: number }[] }> {
  const rows = await rosterRows((roster) => sql`SELECT ${sql.raw(groupBy)} AS name, COUNT(*) AS students, COUNT(*) FILTER (WHERE ended) AS ended FROM ${roster}
    WHERE ${sql.join(placementParts(scope, f), sql` AND `)} GROUP BY 1`);
  const groups = rows
    .filter((r) => r["name"] != null)
    .map((r) => ({ name: r["name"] as string, students: num(r["students"]), ended: num(r["ended"]) }));
  return { total: rows.reduce((n, r) => n + num(r["students"]), 0), groups };
}

/** Test on the attempt row t (all its columns are null when the student never opened the report). */
function statusTest(statuses: QuizStatus[]): SQL {
  const tests: Record<QuizStatus, string> = {
    not_started: "t.student_id IS NULL",
    opened: "t.student_id IS NOT NULL AND t.started_at IS NULL AND t.finished_at IS NULL",
    started: "t.started_at IS NOT NULL AND t.finished_at IS NULL",
    completed: "t.finished_at IS NOT NULL",
  };
  return sql.raw(`(${statuses.map((x) => tests[x]).join(" OR ")})`);
}

/**
 * LIKE patterns for the student search: anywhere in the name (case ignored), or the start of the student ID
 * (stored lower-case without hyphens). Null when the search is empty.
 */
function studentSearch(text: string | undefined): { name: string; id: string } | null {
  const q = (text ?? "").trim().slice(0, 100);
  if (!q) return null;
  const escape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
  return { name: `%${escape(q)}%`, id: `${escape(q.toLowerCase().replaceAll("-", ""))}%` };
}

/**
 * The students list: every roster student with their attempt, if any. A student who never opened the report has no
 * attempt, so they are left out when a date or score filter is set (those filters describe the attempt).
 */
async function studentRowsQuery(scope: SessionScope, f: QuizAnalyticsFilters): Promise<Row[]> {
  const statuses = f.statuses?.length ? f.statuses : QUIZ_STATUSES;
  const attemptFiltered = Boolean(f.from || f.to || f.score != null);
  const wanted = attemptFiltered ? statuses.filter((x) => x !== "not_started") : statuses;
  if (wanted.length === 0) return [];
  const search = studentSearch(f.student);
  const run = (roster: SQL) => sql`SELECT r.student_id, r.college AS roster_college, r.semester AS roster_semester,
      r.section AS roster_section, r.name AS roster_name, r.ended AS roster_ended,
      t.opened_at, t.started_at, t.finished_at, t.score, t.total_questions, t.total_seconds
    FROM (SELECT student_id, college, semester, section, name, ended FROM ${roster}
          WHERE ${sql.join(placementParts(scope, f), sql` AND `)}) r
    LEFT JOIN (SELECT * FROM spi_quiz_attempts t WHERE ${whereFor(scope, f, "t")}) t ON t.student_id = r.student_id
    WHERE ${statusTest(wanted)}${search ? sql` AND (r.name ILIKE ${search.name} ESCAPE '\\' OR r.student_id LIKE ${search.id} ESCAPE '\\')` : sql``}
    ORDER BY COALESCE(t.finished_at, t.started_at, t.opened_at) DESC NULLS LAST, r.college, r.student_id`;
  try {
    return (await db.execute(run(ROSTER_WITH_HISTORY))).rows as Row[];
  } catch {
    return (await db.execute(run(ROSTER_CACHE_ONLY))).rows as Row[];
  }
}

// A finished quiz counts as started even when its started_at is empty (23 such rows in Prod, 2026-11-11), so
// "dropped midway" (started minus completed) is never short of the students who really stopped midway.
/** Roster students per stage for the current filters (status and score ignored), so the funnel matches the table and export. */
async function statusCounts(scope: SessionScope, f: QuizAnalyticsFilters): Promise<Record<QuizStatus, number>> {
  const run = (roster: SQL) => sql`SELECT
      COUNT(*) FILTER (WHERE ${statusTest(["not_started"])}) AS not_started,
      COUNT(*) FILTER (WHERE ${statusTest(["opened"])}) AS opened,
      COUNT(*) FILTER (WHERE ${statusTest(["started"])}) AS started,
      COUNT(*) FILTER (WHERE ${statusTest(["completed"])}) AS completed
    FROM (SELECT student_id, college, semester, section FROM ${roster}
          WHERE ${sql.join(placementParts(scope, f), sql` AND `)}) r
    LEFT JOIN (SELECT * FROM spi_quiz_attempts t WHERE ${whereFor(scope, { ...f, from: undefined, to: undefined, score: undefined }, "t")}) t
      ON t.student_id = r.student_id`;
  let row: Row | undefined;
  try {
    row = (await db.execute(run(ROSTER_WITH_HISTORY))).rows[0] as Row | undefined;
  } catch {
    row = (await db.execute(run(ROSTER_CACHE_ONLY))).rows[0] as Row | undefined;
  }
  return {
    not_started: num(row?.["not_started"]),
    opened: num(row?.["opened"]),
    started: num(row?.["started"]),
    completed: num(row?.["completed"]),
  };
}

const COUNTS = sql`COUNT(*) AS opened, COUNT(*) FILTER (WHERE started_at IS NOT NULL OR finished_at IS NOT NULL) AS started,
  COUNT(finished_at) AS completed,
  AVG(score) FILTER (WHERE finished_at IS NOT NULL) AS avg_score`;

export async function getQuizAnalytics(
  scope: SessionScope,
  f: QuizAnalyticsFilters,
  pageRequest: PageRequest,
): Promise<QuizAnalytics> {
  const where = whereFor(scope, f);
  // One college chosen: break it down by section; otherwise by college.
  const groupBy = f.colleges?.length === 1 ? "section" : "college";
  const rows = async (query: SQL) => (await db.execute(query)).rows as Row[];
  // One set of filters is read once every 30 s: paging, page size and the CSV reuse it instead of running the
  // 8 queries again (0.6–1.7 s each time). Quiz progress is live, so the window stays short.
  const cacheKey = `spi-quiz-analytics:v2:${JSON.stringify({ scope, f })}`;
  const load = () => Promise.all([
    getRosterCounts(scope, { colleges: f.colleges, batches: f.batches, term: f.term, semesters: f.semesters, sections: f.sections }, groupBy),
    rows(sql`SELECT ${COUNTS}, AVG(total_seconds) FILTER (WHERE finished_at IS NOT NULL) AS avg_seconds,
      MAX(total_questions) AS question_count FROM spi_quiz_attempts WHERE ${where}`),
    rows(sql`SELECT ${sql.raw(groupBy)} AS name, ${COUNTS} FROM spi_quiz_attempts WHERE ${where} GROUP BY 1`),
    rows(sql`SELECT score, COUNT(*) AS students FROM spi_quiz_attempts
      WHERE ${where} AND finished_at IS NOT NULL AND score IS NOT NULL GROUP BY score ORDER BY score`),
    rows(sql`SELECT a.question_id, COUNT(*) AS answered, AVG(CASE WHEN a.correct THEN 100.0 ELSE 0 END) AS correct_pct,
      AVG(a.seconds) AS avg_seconds
      FROM spi_quiz_answers a JOIN spi_quiz_attempts t ON t.student_id = a.student_id
      WHERE ${whereFor(scope, f, "t")} GROUP BY a.question_id`),
    studentRowsQuery(scope, f),
    getQuizQuestions(),
    statusCounts(scope, f),
  ]);
  type Loaded = Awaited<ReturnType<typeof load>>;
  let loaded = cacheGet<Loaded>(cacheKey);
  if (!loaded) {
    loaded = await load();
    cacheSet(cacheKey, loaded, 30 * 1000);
  }
  const [roster, totalsRows, groupRows, spreadRows, questionStatRows, studentRows, questions, stages] = loaded;

  const t = totalsRows[0] ?? {};
  const totals = {
    name: "All",
    students: roster.total,
    endedStudents: roster.groups.reduce((n, g) => n + g.ended, 0),
    opened: num(t["opened"]),
    started: num(t["started"]),
    completed: num(t["completed"]),
    avgScore: numOrNull(t["avg_score"]),
    avgSeconds: numOrNull(t["avg_seconds"]),
    notStarted: stages.not_started,
    notSeen: stages.not_started + stages.opened + stages.started,
    questionCount: numOrNull(t["question_count"]) ?? questions.length,
  };

  // Every college (or section) with students, plus any that only appear in the quiz data.
  const byName = new Map<string, QuizGroupRow>();
  for (const g of roster.groups) {
    byName.set(g.name, { name: g.name, students: g.students, endedStudents: g.ended, opened: 0, started: 0, completed: 0, avgScore: null });
  }
  for (const r of groupRows) {
    const name = (r["name"] as string | null) ?? "Unknown";
    const row = byName.get(name) ?? { name, students: 0, endedStudents: 0, opened: 0, started: 0, completed: 0, avgScore: null };
    row.opened = num(r["opened"]);
    row.started = num(r["started"]);
    row.completed = num(r["completed"]);
    row.avgScore = numOrNull(r["avg_score"]);
    byName.set(name, row);
  }
  const share = (g: QuizGroupRow) => (g.students ? g.completed / g.students : 0);
  const groups = [...byName.values()].sort(
    (a, b) => share(b) - share(a) || b.completed - a.completed || a.name.localeCompare(b.name),
  );

  const stats = new Map(questionStatRows.map((r) => [r["question_id"] as string, r]));
  const questionRows = questions
    .map((q, i) => {
      const r = stats.get(q.id);
      return {
        id: q.id,
        position: i + 1,
        topic: q.topic,
        question: q.question,
        answered: num(r?.["answered"]),
        correctPct: numOrNull(r?.["correct_pct"]),
        avgSeconds: numOrNull(r?.["avg_seconds"]),
      };
    })
    // Hardest first; questions nobody has answered yet go last.
    .sort((a, b) => (a.correctPct ?? 101) - (b.correctPct ?? 101) || a.position - b.position);

  const page = pageOf(studentRows, pageRequest);
  const iso = (v: unknown) => (v == null ? null : new Date(v as string).toISOString());
  const students: Page<QuizStudentRow> = {
    ...page,
    rows: page.rows.map((r) => ({
      studentId: r["student_id"] as string,
      name: (r["roster_name"] as string | null) ?? null,
      college: (r["roster_college"] as string | null) ?? null,
      semester: (r["roster_semester"] as string | null) ?? null,
      section: (r["roster_section"] as string | null) ?? null,
      ended: r["roster_ended"] === true || r["roster_ended"] === "t" || r["roster_ended"] === "true",
      status: r["finished_at"] ? "completed" : r["started_at"] ? "started" : r["opened_at"] ? "opened" : "not_started",
      score: numOrNull(r["score"]),
      totalQuestions: numOrNull(r["total_questions"]),
      seconds: numOrNull(r["total_seconds"]),
      openedAt: iso(r["opened_at"]),
      finishedAt: iso(r["finished_at"]),
    })),
  };

  return {
    totals,
    groupBy,
    groups,
    scoreSpread: spreadRows.map((r) => ({ score: num(r["score"]), students: num(r["students"]) })),
    questions: questionRows,
    students,
  };
}
