import { sql, type SQL } from "drizzle-orm";
import { db } from "@workspace/db";
import { excludedInstituteNames } from "./excludedInstitutes.js";
import { getQuizRosterCounts, getStudentNames, type QuizRosterFilters } from "./queries.js";
import { getQuizQuestions } from "./spiQuiz.js";
import type { SessionScope } from "./rbac.js";
import { pageOf, type Page, type PageRequest } from "./pagination.js";

/**
 * SPI quiz analytics for staff: counts, scores and times from spi_quiz_attempts / spi_quiz_answers
 * (Postgres, aggregated in SQL), out of the current-semester students counted in BigQuery.
 * The date range applies to when a student first opened the report (India time).
 */
export interface QuizAnalyticsFilters extends QuizRosterFilters {
  from?: string;
  to?: string;
  includeTest: boolean;
}

export interface QuizGroupRow {
  name: string;
  students: number;
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
  status: "opened" | "started" | "completed";
  score: number | null;
  totalQuestions: number | null;
  seconds: number | null;
  openedAt: string;
  finishedAt: string | null;
}

export interface QuizAnalytics {
  totals: QuizGroupRow & { avgSeconds: number | null; questionCount: number };
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

const num = (v: unknown): number => Number(v ?? 0);
const numOrNull = (v: unknown): number | null => (v == null ? null : Number(v));
const list = (values: string[]) => sql.join(values.map((v) => sql`${v}`), sql`, `);

function whereFor(scope: SessionScope, f: QuizAnalyticsFilters, alias = ""): SQL {
  const col = (name: string) => sql.raw(alias ? `${alias}.${name}` : name);
  const parts: SQL[] = [sql`TRUE`];
  if (!f.includeTest) parts.push(sql`NOT ${col("is_test")}`);
  const excluded = excludedInstituteNames();
  if (excluded.length) parts.push(sql`LOWER(TRIM(COALESCE(${col("college")}, ''))) NOT IN (${list(excluded)})`);
  if (scope.campuses?.length) parts.push(sql`${col("college")} IN (${list(scope.campuses)})`);
  if (f.college) parts.push(sql`${col("college")} = ${f.college}`);
  if (f.semester) parts.push(sql`${col("semester")} = ${f.semester}`);
  if (f.section) parts.push(sql`${col("section")} = ${f.section}`);
  if (f.from) parts.push(sql`(${col("opened_at")} AT TIME ZONE 'Asia/Kolkata')::date >= ${f.from}::date`);
  if (f.to) parts.push(sql`(${col("opened_at")} AT TIME ZONE 'Asia/Kolkata')::date <= ${f.to}::date`);
  return sql.join(parts, sql` AND `);
}

const COUNTS = sql`COUNT(*) AS opened, COUNT(started_at) AS started, COUNT(finished_at) AS completed,
  AVG(score) FILTER (WHERE finished_at IS NOT NULL) AS avg_score`;

export async function getQuizAnalytics(
  scope: SessionScope,
  f: QuizAnalyticsFilters,
  pageRequest: PageRequest,
): Promise<QuizAnalytics> {
  const where = whereFor(scope, f);
  const groupBy = f.college ? "section" : "college";
  const rows = async (query: SQL) => (await db.execute(query)).rows as Row[];
  const [roster, totalsRows, groupRows, spreadRows, questionStatRows, studentRows, questions] = await Promise.all([
    getQuizRosterCounts(scope, { college: f.college, semester: f.semester, section: f.section }),
    rows(sql`SELECT ${COUNTS}, AVG(total_seconds) FILTER (WHERE finished_at IS NOT NULL) AS avg_seconds,
      MAX(total_questions) AS question_count FROM spi_quiz_attempts WHERE ${where}`),
    rows(sql`SELECT ${sql.raw(groupBy)} AS name, ${COUNTS} FROM spi_quiz_attempts WHERE ${where} GROUP BY 1`),
    rows(sql`SELECT score, COUNT(*) AS students FROM spi_quiz_attempts
      WHERE ${where} AND finished_at IS NOT NULL AND score IS NOT NULL GROUP BY score ORDER BY score`),
    rows(sql`SELECT a.question_id, COUNT(*) AS answered, AVG(CASE WHEN a.correct THEN 100.0 ELSE 0 END) AS correct_pct,
      AVG(a.seconds) AS avg_seconds
      FROM spi_quiz_answers a JOIN spi_quiz_attempts t ON t.student_id = a.student_id
      WHERE ${whereFor(scope, f, "t")} GROUP BY a.question_id`),
    rows(sql`SELECT student_id, college, semester, section, opened_at, started_at, finished_at, score, total_questions, total_seconds
      FROM spi_quiz_attempts WHERE ${where}
      ORDER BY COALESCE(finished_at, started_at, opened_at) DESC, student_id`),
    getQuizQuestions(),
  ]);

  const t = totalsRows[0] ?? {};
  const totals = {
    name: "All",
    students: roster.total,
    opened: num(t["opened"]),
    started: num(t["started"]),
    completed: num(t["completed"]),
    avgScore: numOrNull(t["avg_score"]),
    avgSeconds: numOrNull(t["avg_seconds"]),
    questionCount: numOrNull(t["question_count"]) ?? questions.length,
  };

  // Every college (or section) with students, plus any that only appear in the quiz data.
  const byName = new Map<string, QuizGroupRow>();
  for (const g of roster.groups) {
    byName.set(g.name, { name: g.name, students: g.students, opened: 0, started: 0, completed: 0, avgScore: null });
  }
  for (const r of groupRows) {
    const name = (r["name"] as string | null) ?? "Unknown";
    const row = byName.get(name) ?? { name, students: 0, opened: 0, started: 0, completed: 0, avgScore: null };
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
  const names = await getStudentNames(page.rows.map((r) => r["student_id"] as string)).catch(
    () => new Map<string, string>(),
  );
  const iso = (v: unknown) => (v == null ? null : new Date(v as string).toISOString());
  const students: Page<QuizStudentRow> = {
    ...page,
    rows: page.rows.map((r) => {
      const id = r["student_id"] as string;
      return {
        studentId: id,
        name: names.get(id) ?? null,
        college: (r["college"] as string | null) ?? null,
        semester: (r["semester"] as string | null) ?? null,
        section: (r["section"] as string | null) ?? null,
        status: r["finished_at"] ? "completed" : r["started_at"] ? "started" : "opened",
        score: numOrNull(r["score"]),
        totalQuestions: numOrNull(r["total_questions"]),
        seconds: numOrNull(r["total_seconds"]),
        openedAt: iso(r["opened_at"])!,
        finishedAt: iso(r["finished_at"]),
      };
    }),
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
