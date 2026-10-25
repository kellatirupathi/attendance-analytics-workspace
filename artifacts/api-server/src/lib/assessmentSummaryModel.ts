import type { SummaryGroupBy } from "./assessmentSummarySql.js";

/**
 * In-memory version of buildAssessmentSummarySql. The shared snapshot holds the
 * query's `slots` rows (no page filters) and its quiz units; this file applies
 * scope and page filters and rebuilds the GROUPING SETS rows the SQL returns, so
 * getAssessmentSummary maps them exactly as before. Keep the two in step.
 */

/** One row per roster student × subject × section window, as the SQL `slots` CTE before filters. */
export interface AssessmentSlot {
  campus: string;
  section: string;
  sectionKey: string;
  subject: string;
  studentKey: string;
  studentId: string | null;
  studentName: string | null;
  startD: string | null;
  endD: string | null;
  batch: string;
  periodTitle: string;
  derived: string;
  termWise: boolean;
  periodKey: string;
  /** Classroom quiz slot sums: total, expected, attempted, score. */
  cq: [number, number, number, number];
  /** Module quiz slot sums, same order. */
  mq: [number, number, number, number];
}

export interface AssessmentUnit {
  unit: string;
  done: boolean;
  type: string;
}

export interface AssessmentModel {
  slots: AssessmentSlot[];
  /** Quiz units per unitWindowKey(section_key, subject, start_d, end_d). */
  units: Map<string, AssessmentUnit[]>;
}

export function unitWindowKey(sectionKey: string, subject: string, startD: string | null, endD: string | null): string {
  return `${sectionKey}\t${subject}\t${startD ?? ""}\t${endD ?? ""}`;
}

/** The row shape the summary SQL returns (numbers as strings, as BigQuery sends them). */
export interface SummarySqlRow {
  g: string | null;
  p: string | null;
  gg: string;
  gp: string;
  r_campus: string | null;
  r_section: string | null;
  r_subject: string | null;
  r_batch: string | null;
  r_period_title: string | null;
  r_derived: string | null;
  r_term_wise: boolean | string | null;
  r_start: string | null;
  r_end: string | null;
  r_student_id: string | null;
  r_student_name: string | null;
  students: string;
  campuses: string | null;
  expected_attempts: string | null;
  attempted: string | null;
  score_sum: string | null;
  scheduled: string | null;
  conducted: string | null;
  /**
   * Campus × subject pairs with quiz units, and how many of them have no quiz-table records.
   * Only the in-memory model fills these; the SQL fallback leaves them out.
   */
  unit_subjects?: string;
  uncovered_subjects?: string;
}

export interface ModelFilters {
  /** Quiz types to count (CLASSROOM_QUIZ, MODULE_QUIZ). */
  types: string[];
  /** User scope; trimmed names. Empty = all. */
  scopeCampuses: string[];
  campuses: string[];
  /** Derived semester label, "" for all current semesters. */
  semester: string;
  /** campus + TAB + section */
  sections: string[];
  subjects: string[];
  /** Trimmed student name / id search, "" for none. */
  student: string;
}

/** Slots inside the user's campus scope (no page filters): feeds the filter options. */
export function scopedSlots(model: AssessmentModel, scopeCampuses: string[]): AssessmentSlot[] {
  if (!scopeCampuses.length) return model.slots;
  const campuses = new Set(scopeCampuses);
  return model.slots.filter((slot) => campuses.has(slot.campus));
}

/** Same as the SQL FILTERS block. */
function pageFilter(filters: ModelFilters): (slot: AssessmentSlot) => boolean {
  const campuses = new Set(filters.campuses);
  const sections = new Set(filters.sections);
  const subjects = new Set(filters.subjects);
  const name = filters.student.toLowerCase();
  const key = filters.student.replaceAll("-", "").toLowerCase();
  return (slot) =>
    (!campuses.size || campuses.has(slot.campus))
    && (!filters.semester || slot.derived === filters.semester)
    && (!sections.size || sections.has(`${slot.campus}\t${slot.section}`))
    && (!subjects.size || subjects.has(slot.subject))
    && (!filters.student
      || (slot.studentName ?? "").toLowerCase().includes(name)
      || slot.studentKey.includes(key));
}

const GROUP_KEY: Record<SummaryGroupBy, (slot: AssessmentSlot) => string> = {
  campus: (slot) => slot.campus,
  subject: (slot) => slot.subject,
  section: (slot) => `${slot.campus}\t${slot.section}`,
  semester: (slot) => slot.periodKey,
  student: (slot) => slot.studentKey,
};

interface Acc {
  g: string | null;
  p: string | null;
  gg: string;
  gp: string;
  first: AssessmentSlot;
  students: Set<string>;
  campuses: Set<string>;
  total: number;
  expected: number;
  attempted: number;
  score: number;
  start: string | null;
  end: string | null;
  termWise: boolean;
  /** unit -> conducted in any of its sessions */
  units: Map<string, boolean>;
  /** campus + TAB + subject -> has quiz units, and the quiz-table rows it carries (total + expected) */
  pairs: Map<string, { hasUnits: boolean; quizRows: number }>;
}

/**
 * The rows buildAssessmentSummarySql would return for these filters: GROUPING SETS
 * (g), (g, p), (p), () — or (p), () for Semester-wise — with distinct students,
 * campuses and quiz units at every level.
 */
export function summarizeAssessmentModel(
  model: AssessmentModel,
  groupBy: SummaryGroupBy,
  filters: ModelFilters,
): SummarySqlRow[] {
  const passes = pageFilter(filters);
  const scope = filters.scopeCampuses.length ? new Set(filters.scopeCampuses) : null;
  const types = new Set(filters.types);
  const useCq = types.has("CLASSROOM_QUIZ");
  const useMq = types.has("MODULE_QUIZ");
  const byStudent = groupBy === "student";
  const bySemester = groupBy === "semester";
  const groupKey = GROUP_KEY[groupBy];
  const accs = new Map<string, Acc>();

  const accFor = (id: string, g: string | null, p: string | null, gg: string, gp: string, slot: AssessmentSlot): Acc => {
    let acc = accs.get(id);
    if (!acc) {
      acc = {
        g, p, gg, gp, first: slot,
        students: new Set(), campuses: new Set(),
        total: 0, expected: 0, attempted: 0, score: 0,
        start: null, end: null, termWise: false, units: new Map(), pairs: new Map(),
      };
      accs.set(id, acc);
    }
    return acc;
  };

  for (const slot of model.slots) {
    if (scope && !scope.has(slot.campus)) continue;
    if (!passes(slot)) continue;
    const sums = [0, 1, 2, 3].map((i) => (useCq ? slot.cq[i]! : 0) + (useMq ? slot.mq[i]! : 0));
    const unitList = (model.units.get(unitWindowKey(slot.sectionKey, slot.subject, slot.startD, slot.endD)) ?? [])
      .filter((unit) => types.has(unit.type));
    const g = groupKey(slot);
    const p = slot.periodKey;
    // [acc, takes units]: Student-wise counts units per period and overall only.
    const targets: [Acc, boolean][] = bySemester
      ? [
          [accFor(`P\t${p}`, p, p, "0", "1", slot), true],
          [accFor("O", null, null, "1", "1", slot), true],
        ]
      : [
          [accFor(`G\t${g}`, g, null, "0", "1", slot), !byStudent],
          [accFor(`GP\t${g}\t${p}`, g, p, "0", "0", slot), !byStudent],
          [accFor(`P\t${p}`, null, p, "1", "0", slot), true],
          [accFor("O", null, null, "1", "1", slot), true],
        ];
    for (const [acc, takesUnits] of targets) {
      acc.students.add(slot.studentKey);
      acc.campuses.add(slot.campus);
      acc.total += sums[0]!;
      acc.expected += sums[1]!;
      acc.attempted += sums[2]!;
      acc.score += sums[3]!;
      if (slot.startD && (!acc.start || slot.startD < acc.start)) acc.start = slot.startD;
      if (slot.endD && (!acc.end || slot.endD > acc.end)) acc.end = slot.endD;
      if (slot.termWise) acc.termWise = true;
      // Coverage: a subject whose quizzes were run but that has no quiz-table records at all.
      const pairKey = `${slot.campus}\t${slot.subject}`;
      const pair = acc.pairs.get(pairKey) ?? { hasUnits: false, quizRows: 0 };
      pair.hasUnits ||= unitList.length > 0;
      pair.quizRows += sums[0]! + sums[1]!;
      acc.pairs.set(pairKey, pair);
      if (takesUnits) {
        for (const unit of unitList) acc.units.set(unit.unit, (acc.units.get(unit.unit) ?? false) || unit.done);
      }
    }
  }

  return [...accs.values()].map((acc) => {
    let scheduled = 0;
    let conducted = 0;
    if (byStudent && acc.gg === "0") {
      // Student rows: the student's own slots.
      scheduled = acc.total;
      conducted = acc.expected;
    } else {
      scheduled = acc.units.size;
      for (const done of acc.units.values()) if (done) conducted += 1;
    }
    let unitSubjects = 0;
    let uncoveredSubjects = 0;
    for (const pair of acc.pairs.values()) {
      if (!pair.hasUnits) continue;
      unitSubjects += 1;
      if (pair.quizRows === 0) uncoveredSubjects += 1;
    }
    return {
      g: acc.g,
      p: acc.p,
      gg: acc.gg,
      gp: acc.gp,
      r_campus: acc.first.campus,
      r_section: acc.first.section,
      r_subject: acc.first.subject,
      r_batch: acc.first.batch,
      r_period_title: acc.first.periodTitle,
      r_derived: acc.first.derived,
      r_term_wise: acc.termWise,
      r_start: acc.start,
      r_end: acc.end,
      r_student_id: acc.first.studentId,
      r_student_name: acc.first.studentName,
      students: String(acc.students.size),
      campuses: String(acc.campuses.size),
      expected_attempts: String(acc.expected),
      attempted: String(acc.attempted),
      score_sum: String(acc.score),
      scheduled: String(scheduled),
      conducted: String(conducted),
      unit_subjects: String(unitSubjects),
      uncovered_subjects: String(uncoveredSubjects),
    };
  });
}
