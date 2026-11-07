import type { SpiDetailRow } from "./spiRecordAggregate.js";

/**
 * The SPI Record Dashboard table: Campus-wise, Semester-wise, Section-wise and Student-wise,
 * built on the server from the cached SPI detail rows.
 *
 * Scores follow the student report (spiScorecardRules.ts, policy §3):
 * - CQ and MQ come from the quiz data (missed quizzes already count as 0).
 * - SA and FSA are not in the warehouse for these rows yet, so they are null.
 * - SPI and the grade need the Final (FSA); until it exists they stay null ("Pending").
 *   No SPI is worked out from partial data, and the old quiz-only formula is not used here.
 * `spiOf` is the one place to fill in once the Final and per-course credits are available.
 */

export type RecordGrain = "campus" | "semester" | "section" | "student";
export type RecordGrade = "A+" | "A" | "B" | "C" | "D" | "F";
export const RECORD_GRADES: RecordGrade[] = ["A+", "A", "B", "C", "D", "F"];

export interface StudentScores {
  cq: number | null;
  mq: number | null;
  sa: number | null;
  fsa: number | null;
  spi: number | null;
  /** Grade of the weighted course score (policy §3.2); null while Pending. */
  grade: RecordGrade | null;
  /** Weighted course score out of 100, used to grade an average; null while Pending. */
  score: number | null;
}

/** One student's scores. SA, FSA, SPI and grade stay null until the Final exists in the data. */
export function spiOf(row: SpiDetailRow): StudentScores {
  return { cq: row.classroomAvg, mq: row.moduleAvg, sa: null, fsa: null, spi: null, grade: null, score: null };
}

export interface RecordRow {
  university: string;
  semester: string | null;
  section: string | null;
  studentId: string | null;
  studentName: string | null;
  students: number;
  evaluated: number;
  cq: number | null;
  mq: number | null;
  sa: number | null;
  fsa: number | null;
  spi: number | null;
  grade: RecordGrade | null;
}

export interface RecordSummary {
  students: number;
  evaluated: number;
  avgSpi: number | null;
  grades: Record<RecordGrade, number>;
}

export interface RecordFilters {
  /** "" = every student; "Pending" = students without a grade; a grade keeps only students with it. */
  grade: string;
  /** Student name or id (hyphens ignored). */
  search: string;
}

const round1 = (value: number) => Math.round(value * 10) / 10;
const round2 = (value: number) => Math.round(value * 100) / 100;

function mean(values: (number | null)[], round: (value: number) => number): number | null {
  const list = values.filter((value): value is number => value != null);
  return list.length ? round(list.reduce((sum, value) => sum + value, 0) / list.length) : null;
}

const plainId = (id: string) => id.toLowerCase().replace(/-/g, "");

/** Credit-weighted grades are not possible yet, so an average is graded from the students' scores. */
function levelOfScore(score: number): RecordGrade {
  return score >= 90 ? "A+" : score >= 80 ? "A" : score >= 70 ? "B" : score >= 60 ? "C" : score >= 50 ? "D" : "F";
}

export function buildSpiRecordTable(
  detail: SpiDetailRow[],
  grain: RecordGrain,
  filters: RecordFilters,
): { summary: RecordSummary; rows: RecordRow[] } {
  const search = filters.search.trim().toLowerCase();
  const searchId = plainId(search);
  const seen = new Set<string>();
  const people: { row: SpiDetailRow; scores: StudentScores }[] = [];
  for (const row of detail) {
    const key = `${row.university}\t${row.semester}\t${row.section}\t${row.studentId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const scores = spiOf(row);
    if (filters.grade === "Pending" ? scores.grade != null : filters.grade && scores.grade !== filters.grade) continue;
    if (search && !row.studentName.toLowerCase().includes(search) && !plainId(row.studentId).includes(searchId)) continue;
    people.push({ row, scores });
  }

  const keyOf = (row: SpiDetailRow) =>
    grain === "campus" ? row.university
      : grain === "semester" ? `${row.university}\t${row.semester}`
        : grain === "section" ? `${row.university}\t${row.semester}\t${row.section}`
          : `${row.university}\t${row.semester}\t${row.section}\t${row.studentId}`;
  const buckets = new Map<string, typeof people>();
  for (const person of people) {
    const key = keyOf(person.row);
    const list = buckets.get(key);
    if (list) list.push(person);
    else buckets.set(key, [person]);
  }

  const rows: RecordRow[] = [...buckets.values()].map((members) => {
    const first = members[0]!.row;
    const evaluated = members.filter((person) => person.scores.spi != null);
    const avgScore = mean(evaluated.map((person) => person.scores.score), (value) => value);
    const single = grain === "student" ? members[0]!.scores : null;
    return {
      university: first.university,
      semester: grain === "campus" ? null : first.semester,
      section: grain === "section" || grain === "student" ? first.section : null,
      studentId: grain === "student" ? first.studentId : null,
      studentName: grain === "student" ? first.studentName : null,
      students: members.length,
      evaluated: evaluated.length,
      cq: mean(members.map((person) => person.scores.cq), round1),
      mq: mean(members.map((person) => person.scores.mq), round1),
      sa: mean(members.map((person) => person.scores.sa), round1),
      fsa: mean(members.map((person) => person.scores.fsa), round1),
      spi: single ? single.spi : mean(evaluated.map((person) => person.scores.spi), round2),
      grade: single ? single.grade : avgScore == null ? null : levelOfScore(avgScore),
    };
  });

  const grades = Object.fromEntries(RECORD_GRADES.map((grade) => [grade, 0])) as Record<RecordGrade, number>;
  for (const person of people) if (person.scores.grade) grades[person.scores.grade] += 1;
  const evaluatedAll = people.filter((person) => person.scores.spi != null);
  const summary: RecordSummary = {
    students: people.length,
    evaluated: evaluatedAll.length,
    avgSpi: mean(evaluatedAll.map((person) => person.scores.spi), round2),
    grades,
  };
  return { summary, rows };
}

export const RECORD_SORT_KEYS = ["university", "semester", "section", "studentName", "students", "evaluated", "cq", "mq", "sa", "fsa", "spi", "grade"] as const;
export type RecordSortKey = (typeof RECORD_SORT_KEYS)[number];

/** Default order is campus, semester, section, name; a chosen column sorts first, empty values last. */
export function sortRecordRows(rows: RecordRow[], key: RecordSortKey | "", dir: 1 | -1): RecordRow[] {
  const byName = (a: RecordRow, b: RecordRow) =>
    a.university.localeCompare(b.university)
    || (a.semester ?? "").localeCompare(b.semester ?? "", undefined, { numeric: true })
    || (a.section ?? "").localeCompare(b.section ?? "", undefined, { numeric: true })
    || (a.studentName ?? "").localeCompare(b.studentName ?? "")
    || (a.studentId ?? "").localeCompare(b.studentId ?? "");
  if (!key) return rows.slice().sort(byName);
  return rows.slice().sort((a, b) => {
    const x = a[key];
    const y = b[key];
    if (x == null && y == null) return byName(a, b);
    if (x == null) return 1;
    if (y == null) return -1;
    const order = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
    return order * dir || byName(a, b);
  });
}
