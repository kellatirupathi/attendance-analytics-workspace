/**
 * SPI Record Dashboard: the interim SPI from the assessments held so far (agreed 2026-11-17).
 * Pure functions over the saved reports (directoryReport.ts), so the quiz and assessment numbers are the Student
 * Directory's own (Method A).
 *
 *   Course score   (CQ × 10 + MQ × 15 + SA × 25 [+ FSA × 50]) ÷ the weights of the parts used: only the parts picked in
 *                  "SPI up to" and held in that course (a part not held yet is left out), so the score is scaled to 100.
 *                  A plain weighted average: no "below 50 earns 0" rule in the interim score.
 *   Course points  the policy levels (§3.2) of the course score: 90+ A+ 10, 80+ A 9, 70+ B 8, 60+ C 7, 50+ D 6, else F 0.
 *   Student        interim score = simple average of their course scores; interim SPI = average of their course points
 *                  (equal course weights); a student with no scored course has neither.
 *   Group          students; CQ / MQ / SA = the simple average of every student × course score (as the Directory);
 *                  interim score and SPI = the average over the group's students; "≥ 70%" = students with a score ≥ 70.
 * No imports with side effects, so it can be tested on its own.
 */
import { batchOf, directoryRows, matches, plain, scoreAverage, subjectSet, type DirectoryCourse, type DirectoryFilter, type DirectoryPart, type DirectoryRow, type DirectoryStudent } from "./directoryReportModel.js";

export type SpiUpTo = "cq" | "cqmq" | "cqmqsa" | "all";
export const SPI_UP_TO: SpiUpTo[] = ["cq", "cqmq", "cqmqsa", "all"];
export type SpiGrain = "college" | "batch" | "section" | "student";
export const SPI_GRAINS: SpiGrain[] = ["college", "batch", "section", "student"];

/** The students with a score at or above this count in the "≥ 70%" card and column. */
export const SPI_TARGET = 70;

const WEIGHTS = { cq: 10, mq: 15, sa: 25, fsa: 50 } as const;
type Part = keyof typeof WEIGHTS;
const PARTS: Record<SpiUpTo, Part[]> = { cq: ["cq"], cqmq: ["cq", "mq"], cqmqsa: ["cq", "mq", "sa"], all: ["cq", "mq", "sa", "fsa"] };

export interface SpiFilter extends DirectoryFilter {
  upTo?: SpiUpTo;
  /** Interim score bounds, 0–100 (students without a score are left out when either is set). */
  scoreMin?: number;
  scoreMax?: number;
}

const held = (p: DirectoryPart | null | undefined): p is DirectoryPart => p != null && p.total > 0;
const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;

/** A course's score from the parts picked and held (scaled to 100); null when none of them is held yet. */
export function courseScore(c: Pick<DirectoryCourse, "classroom" | "module" | "skill"> & { fsa?: DirectoryPart | null }, upTo: SpiUpTo): number | null {
  const parts: Record<Part, DirectoryPart | null | undefined> = { cq: c.classroom, mq: c.module, sa: c.skill, fsa: c.fsa };
  let sum = 0;
  let weight = 0;
  for (const part of PARTS[upTo]) {
    const p = parts[part];
    if (!held(p)) continue;
    sum += p.avgPct * WEIGHTS[part];
    weight += WEIGHTS[part];
  }
  return weight > 0 ? r1(sum / weight) : null;
}

/** Policy levels (§3.2) and their points. */
export function levelOf(score: number): { level: "A+" | "A" | "B" | "C" | "D" | "F"; points: number } {
  if (score >= 90) return { level: "A+", points: 10 };
  if (score >= 80) return { level: "A", points: 9 };
  if (score >= 70) return { level: "B", points: 8 };
  if (score >= 60) return { level: "C", points: 7 };
  if (score >= 50) return { level: "D", points: 6 };
  return { level: "F", points: 0 };
}

export interface SpiStudentRow extends Pick<DirectoryRow, "studentId" | "name" | "college" | "batch" | "semester" | "section" | "classroom" | "module" | "skill" | "ended"> {
  parts: DirectoryRow["parts"];
  /** Interim score (0–100) and interim SPI (0–10); null with no scored course. */
  score: number | null;
  spi: number | null;
  level: string | null;
}

/** Every student in the filters with their interim score and SPI (score bounds applied). */
export function spiStudents(students: DirectoryStudent[], f: SpiFilter): SpiStudentRow[] {
  const upTo = f.upTo ?? "cqmqsa";
  const subjects = subjectSet(f);
  const kept = students.filter((s) => matches(s, f, subjects));
  const rows = directoryRows(kept, { ...f, q: "" });
  const out: SpiStudentRow[] = [];
  kept.forEach((s, i) => {
    const row = rows[i]!;
    const courses = subjects ? s.courses.filter((c) => subjects.has(plain(c.name))) : s.courses;
    const scores = courses.map((c) => courseScore(c, upTo)).filter((v): v is number => v != null);
    const score = scores.length ? r1(scores.reduce((a, v) => a + v, 0) / scores.length) : null;
    const spi = scores.length ? r2(scores.reduce((a, v) => a + levelOf(v).points, 0) / scores.length) : null;
    const lo = f.scoreMin ?? 0;
    const hi = f.scoreMax ?? 100;
    if (lo > 0 || hi < 100) {
      if (score == null || score < lo || score > hi) return;
    }
    out.push({
      studentId: row.studentId, name: row.name, college: row.college, batch: batchOf(s), semester: row.semester, section: row.section,
      classroom: row.classroom, module: row.module, skill: row.skill, parts: row.parts,
      ...(row.ended ? { ended: true } : {}),
      score, spi, level: score == null ? null : levelOf(score).level,
    });
  });
  return out;
}

export interface SpiGroupRow {
  key: string;
  college: string;
  batch: string | null;
  semester: string | null;
  section: string | null;
  students: number;
  /** Students whose semester ended (the Ended tag). */
  endedStudents: number;
  classroom: number | null;
  module: number | null;
  skill: number | null;
  score: number | null;
  spi: number | null;
  /** Students with a score ≥ SPI_TARGET, and their share of the group's students. */
  atTarget: number;
  atTargetPct: number | null;
}

const mean = (values: number[], round: (v: number) => number) => (values.length ? round(values.reduce((a, v) => a + v, 0) / values.length) : null);
const share = (n: number, of: number) => (of > 0 ? r1((n * 100) / of) : null);

/** College, batch or section rows (the most common semester of a batch or section is shown). */
export function spiGroups(rows: SpiStudentRow[], grain: Exclude<SpiGrain, "student">): SpiGroupRow[] {
  const by = new Map<string, SpiStudentRow[]>();
  for (const r of rows) {
    const key = grain === "college" ? r.college : grain === "batch" ? `${r.college}\t${r.batch}` : `${r.college}\t${r.batch}\t${r.section}`;
    (by.get(key) ?? by.set(key, []).get(key)!).push(r);
  }
  return [...by.entries()].map(([key, list]) => {
    const t = { cqSum: 0, cqCount: 0, mqSum: 0, mqCount: 0, saSum: 0, saCount: 0 };
    for (const r of list) for (const k of Object.keys(t) as (keyof typeof t)[]) t[k] += r.parts[k];
    const sems = new Map<string, number>();
    for (const r of list) sems.set(r.semester ?? "", (sems.get(r.semester ?? "") ?? 0) + 1);
    const semester = [...sems.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    const atTarget = list.filter((r) => r.score != null && r.score >= SPI_TARGET).length;
    return {
      key,
      college: list[0]!.college,
      batch: grain === "college" ? null : list[0]!.batch,
      semester: grain === "college" ? null : semester,
      section: grain === "section" ? list[0]!.section : null,
      students: list.length,
      endedStudents: list.filter((r) => r.ended).length,
      classroom: scoreAverage(t.cqSum, t.cqCount),
      module: scoreAverage(t.mqSum, t.mqCount),
      skill: scoreAverage(t.saSum, t.saCount),
      score: mean(list.map((r) => r.score).filter((v): v is number => v != null), r1),
      spi: mean(list.map((r) => r.spi).filter((v): v is number => v != null), r2),
      atTarget,
      atTargetPct: share(atTarget, list.length),
    };
  });
}

export interface SpiSummary {
  /** Students after every filter, and before the score filter (the "of N" of the cards). */
  students: number;
  allStudents: number;
  score: number | null;
  spi: number | null;
  atTarget: number;
  /** Share of all students in the filters (before the score filter). */
  atTargetPct: number | null;
  /** True when "All (with FSA)" can be picked: some report in the filters has a Final Skill Assessment score. */
  fsaAvailable: boolean;
}

export function spiSummary(rows: SpiStudentRow[], allRows: SpiStudentRow[]): SpiSummary {
  const atTarget = rows.filter((r) => r.score != null && r.score >= SPI_TARGET).length;
  return {
    students: rows.length,
    allStudents: allRows.length,
    score: mean(rows.map((r) => r.score).filter((v): v is number => v != null), r1),
    spi: mean(rows.map((r) => r.spi).filter((v): v is number => v != null), r2),
    atTarget,
    atTargetPct: share(atTarget, allRows.length),
    fsaAvailable: false,
  };
}

type SortValue = string | number | null;
const GROUP_SORT: Record<string, (r: SpiGroupRow) => SortValue> = {
  college: (r) => r.college, batch: (r) => r.batch, semester: (r) => r.semester, section: (r) => r.section, students: (r) => r.students,
  classroom: (r) => r.classroom, module: (r) => r.module, skill: (r) => r.skill, score: (r) => r.score, spi: (r) => r.spi, atTarget: (r) => r.atTarget,
};
const STUDENT_SORT: Record<string, (r: SpiStudentRow) => SortValue> = {
  name: (r) => r.name?.trim() || null, college: (r) => r.college, batch: (r) => r.batch, section: (r) => r.section,
  classroom: (r) => r.classroom, module: (r) => r.module, skill: (r) => r.skill, score: (r) => r.score, spi: (r) => r.spi, level: (r) => r.score,
};

/** Blanks last in either direction; ties by college, then the row's name or key. */
export function sortSpi<T extends SpiGroupRow | SpiStudentRow>(rows: T[], key: string, dir: 1 | -1, student: boolean): T[] {
  const table = (student ? STUDENT_SORT : GROUP_SORT) as Record<string, (r: T) => SortValue>;
  const get = table[key] ?? table["college"]!;
  const text = (a: SortValue, b: SortValue) => String(a ?? "").localeCompare(String(b ?? ""), undefined, { numeric: true, sensitivity: "base" });
  const tie = (r: T) => ("key" in r ? r.key : `${r.name ?? ""}\t${r.studentId}`);
  return rows.slice().sort((a, b) => {
    const x = get(a);
    const y = get(b);
    if (x == null && y == null) return text(a.college, b.college) || text(tie(a), tie(b));
    if (x == null) return 1;
    if (y == null) return -1;
    const c = typeof x === "number" && typeof y === "number" ? x - y : text(x, y);
    return c * dir || text(a.college, b.college) || text(tie(a), tie(b));
  });
}

/** Name or UUID search on student rows; college / batch / section search on group rows. */
export function searchSpi<T extends SpiGroupRow | SpiStudentRow>(rows: T[], q: string): T[] {
  const t = q.trim().toLowerCase();
  if (!t) return rows;
  return rows.filter((r) => {
    if ("key" in r) return r.key.toLowerCase().includes(t);
    return (r.name ?? "").toLowerCase().includes(t) || r.studentId.replace(/-/g, "").includes(t.replace(/-/g, ""));
  });
}
