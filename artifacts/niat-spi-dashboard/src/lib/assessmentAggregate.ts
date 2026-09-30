export interface AssessmentSlot {
  instituteName: string;
  semester: string;
  section: string;
  subject: string;
  studentCount: number;
  quizN: number;
  cqCompletedSum: number;
  cqTotalMax: number;
  mqCompletedSum: number;
  mqTotalMax: number;
  cqStudentCompleted: number;
  cqStudentTotal: number;
  mqStudentCompleted: number;
  mqStudentTotal: number;
  cqScoreSum: number;
  cqScoreN: number;
  mqScoreSum: number;
  mqScoreN: number;
}

export interface AssessmentRosterRow {
  instituteName: string;
  semester: string;
  section: string;
  studentId: string;
  studentName: string;
}

export interface AssessmentCounts {
  classroomCompleted: number;
  classroomTotal: number;
  moduleCompleted: number;
  moduleTotal: number;
  totalCompleted: number;
  totalAssigned: number;
  classroomStudentCompleted: number;
  classroomStudentTotal: number;
  moduleStudentCompleted: number;
  moduleStudentTotal: number;
  classroomPct: number;
  modulePct: number;
  completionPct: number;
  /** Sum and count of per-student, per-subject average best-attempt scores (attempted quizzes only). */
  classroomScoreSum: number;
  classroomScoreN: number;
  moduleScoreSum: number;
  moduleScoreN: number;
  /** null when nobody has a score yet. */
  classroomAvgScore: number | null;
  moduleAvgScore: number | null;
  avgScore: number | null;
}

export type AssessmentType = "cq" | "mq";

export type AssessmentGrain = "campus" | "semester" | "section" | "subject" | "student";

export interface AssessmentViewRow {
  key: string;
  university: string;
  semester: string | null;
  section: string | null;
  subject: string | null;
  studentCount: number;
  counts: AssessmentCounts;
}

export interface AssessmentScope {
  campuses: string[];
  semesters: string[];
  sections: string[];
  subjects?: string[];
}

interface SubjectAcc {
  cqSum: number;
  mqSum: number;
  quizN: number;
  cqMax: number;
  mqMax: number;
  cqStudentCompleted: number;
  cqStudentTotal: number;
  mqStudentCompleted: number;
  mqStudentTotal: number;
  studentCount: number;
  cqScoreSum: number;
  cqScoreN: number;
  mqScoreSum: number;
  mqScoreN: number;
}

function emptyAcc(): SubjectAcc {
  return {
    cqSum: 0,
    mqSum: 0,
    quizN: 0,
    cqMax: 0,
    mqMax: 0,
    cqStudentCompleted: 0,
    cqStudentTotal: 0,
    mqStudentCompleted: 0,
    mqStudentTotal: 0,
    studentCount: 0,
    cqScoreSum: 0,
    cqScoreN: 0,
    mqScoreSum: 0,
    mqScoreN: 0,
  };
}

function addSlot(acc: SubjectAcc, slot: AssessmentSlot) {
  acc.cqSum += slot.cqCompletedSum;
  acc.mqSum += slot.mqCompletedSum;
  acc.quizN += slot.quizN;
  acc.cqMax = Math.max(acc.cqMax, slot.cqTotalMax);
  acc.mqMax = Math.max(acc.mqMax, slot.mqTotalMax);
  acc.cqStudentCompleted += slot.cqStudentCompleted;
  acc.cqStudentTotal += slot.cqStudentTotal;
  acc.mqStudentCompleted += slot.mqStudentCompleted;
  acc.mqStudentTotal += slot.mqStudentTotal;
  acc.studentCount += slot.studentCount;
  acc.cqScoreSum += slot.cqScoreSum ?? 0;
  acc.cqScoreN += slot.cqScoreN ?? 0;
  acc.mqScoreSum += slot.mqScoreSum ?? 0;
  acc.mqScoreN += slot.mqScoreN ?? 0;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function rate(completed: number, total: number): number {
  if (total <= 0) return 0;
  return round1((completed / total) * 100);
}

function avgOf(sum: number, n: number): number | null {
  return n > 0 ? round1(sum / n) : null;
}

/** Fills the percentage and average fields from the raw sums. */
export function finishCounts(
  base: Omit<AssessmentCounts, "totalCompleted" | "totalAssigned" | "classroomPct" | "modulePct" | "completionPct" | "classroomAvgScore" | "moduleAvgScore" | "avgScore">,
): AssessmentCounts {
  return {
    ...base,
    totalCompleted: base.classroomCompleted + base.moduleCompleted,
    totalAssigned: base.classroomTotal + base.moduleTotal,
    classroomPct: rate(base.classroomStudentCompleted, base.classroomStudentTotal),
    modulePct: rate(base.moduleStudentCompleted, base.moduleStudentTotal),
    completionPct: rate(
      base.classroomStudentCompleted + base.moduleStudentCompleted,
      base.classroomStudentTotal + base.moduleStudentTotal,
    ),
    classroomAvgScore: avgOf(base.classroomScoreSum, base.classroomScoreN),
    moduleAvgScore: avgOf(base.moduleScoreSum, base.moduleScoreN),
    avgScore: avgOf(base.classroomScoreSum + base.moduleScoreSum, base.classroomScoreN + base.moduleScoreN),
  };
}

/** Keeps only the chosen quiz types, so totals, completion and the average cover just those. */
export function selectTypes(counts: AssessmentCounts, types: AssessmentType[]): AssessmentCounts {
  const cq = types.includes("cq");
  const mq = types.includes("mq");
  if (cq && mq) return counts;
  return finishCounts({
    classroomCompleted: cq ? counts.classroomCompleted : 0,
    classroomTotal: cq ? counts.classroomTotal : 0,
    moduleCompleted: mq ? counts.moduleCompleted : 0,
    moduleTotal: mq ? counts.moduleTotal : 0,
    classroomStudentCompleted: cq ? counts.classroomStudentCompleted : 0,
    classroomStudentTotal: cq ? counts.classroomStudentTotal : 0,
    moduleStudentCompleted: mq ? counts.moduleStudentCompleted : 0,
    moduleStudentTotal: mq ? counts.moduleStudentTotal : 0,
    classroomScoreSum: cq ? counts.classroomScoreSum : 0,
    classroomScoreN: cq ? counts.classroomScoreN : 0,
    moduleScoreSum: mq ? counts.moduleScoreSum : 0,
    moduleScoreN: mq ? counts.moduleScoreN : 0,
  });
}

/** Score bound on a 0–100 scale. Blank or non-numeric input means no filter. */
export function parseScoreBound(op: string, a: string, b: string): { min: number; max: number } | null {
  const num = (value: string) => {
    if (!value.trim()) return null;
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : null;
  };
  const first = num(a);
  if (first == null) return null;
  if (op === "gte") return { min: first, max: Infinity };
  if (op === "lte") return { min: -Infinity, max: first };
  if (op !== "between") return null;
  const second = num(b);
  if (second == null) return null;
  return { min: Math.min(first, second), max: Math.max(first, second) };
}

export function passesScore(counts: AssessmentCounts, bound: { min: number; max: number } | null): boolean {
  if (!bound) return true;
  return counts.avgScore != null && counts.avgScore >= bound.min && counts.avgScore <= bound.max;
}

function uniquePair(sum: number, n: number, max: number): { completed: number; total: number } {
  if (n <= 0 || max <= 0) return { completed: 0, total: 0 };
  return { completed: Math.min(Math.round(sum / n), max), total: max };
}

function countsFromAccs(subjects: SubjectAcc[]): AssessmentCounts {
  let classroomCompleted = 0;
  let classroomTotal = 0;
  let moduleCompleted = 0;
  let moduleTotal = 0;
  let classroomStudentCompleted = 0;
  let classroomStudentTotal = 0;
  let moduleStudentCompleted = 0;
  let moduleStudentTotal = 0;
  let classroomScoreSum = 0;
  let classroomScoreN = 0;
  let moduleScoreSum = 0;
  let moduleScoreN = 0;
  for (const subject of subjects) {
    const classroom = uniquePair(subject.cqSum, subject.quizN, subject.cqMax);
    const module = uniquePair(subject.mqSum, subject.quizN, subject.mqMax);
    classroomCompleted += classroom.completed;
    classroomTotal += classroom.total;
    moduleCompleted += module.completed;
    moduleTotal += module.total;
    classroomStudentCompleted += subject.cqStudentCompleted;
    classroomStudentTotal += subject.cqStudentTotal;
    moduleStudentCompleted += subject.mqStudentCompleted;
    moduleStudentTotal += subject.mqStudentTotal;
    classroomScoreSum += subject.cqScoreSum;
    classroomScoreN += subject.cqScoreN;
    moduleScoreSum += subject.mqScoreSum;
    moduleScoreN += subject.mqScoreN;
  }
  return finishCounts({
    classroomCompleted,
    classroomTotal,
    moduleCompleted,
    moduleTotal,
    classroomStudentCompleted,
    classroomStudentTotal,
    moduleStudentCompleted,
    moduleStudentTotal,
    classroomScoreSum,
    classroomScoreN,
    moduleScoreSum,
    moduleScoreN,
  });
}

function namedSubject(subject: string): boolean {
  const name = subject.trim();
  return name.length > 0 && name.toLowerCase() !== "null";
}

export function filterSlots(slots: AssessmentSlot[], scope: AssessmentScope): AssessmentSlot[] {
  return slots.filter((slot) => {
    if (scope.subjects?.length && !scope.subjects.includes(slot.subject)) return false;
    if (scope.campuses.length && !scope.campuses.includes(slot.instituteName)) return false;
    if (scope.semesters.length && !scope.semesters.includes(slot.semester)) return false;
    if (scope.sections.length && !scope.sections.includes(`${slot.instituteName}\t${slot.section}`)) return false;
    return namedSubject(slot.subject);
  });
}

export function filterRoster(
  roster: AssessmentRosterRow[],
  scope: AssessmentScope,
  studentKeys: string[] = [],
): AssessmentRosterRow[] {
  return roster.filter((row) => {
    if (scope.campuses.length && !scope.campuses.includes(row.instituteName)) return false;
    if (scope.semesters.length && !scope.semesters.includes(row.semester)) return false;
    if (scope.sections.length && !scope.sections.includes(`${row.instituteName}\t${row.section}`)) return false;
    if (studentKeys.length && !studentKeys.includes(`${row.instituteName}\t${row.studentId}`)) return false;
    return true;
  });
}

export function distinctStudents(roster: AssessmentRosterRow[]): number {
  return new Set(roster.map((row) => `${row.instituteName}\t${row.studentId}`)).size;
}

function groupSubjects(slots: AssessmentSlot[]): SubjectAcc[] {
  const bySubject = new Map<string, SubjectAcc>();
  for (const slot of slots) {
    const key = slot.subject;
    const acc = bySubject.get(key) ?? emptyAcc();
    addSlot(acc, slot);
    bySubject.set(key, acc);
  }
  return [...bySubject.values()];
}

export function assessmentHeader(slots: AssessmentSlot[]): AssessmentCounts {
  return countsFromAccs(groupSubjects(slots));
}

/** Sum each student's own completed and assigned quizzes. */
export function countsFromStudentWork(rows: AssessmentCounts[]): AssessmentCounts {
  const base = {
    classroomCompleted: 0,
    classroomTotal: 0,
    moduleCompleted: 0,
    moduleTotal: 0,
    classroomStudentCompleted: 0,
    classroomStudentTotal: 0,
    moduleStudentCompleted: 0,
    moduleStudentTotal: 0,
    classroomScoreSum: 0,
    classroomScoreN: 0,
    moduleScoreSum: 0,
    moduleScoreN: 0,
  };
  for (const row of rows) {
    base.classroomCompleted += row.classroomCompleted;
    base.classroomTotal += row.classroomTotal;
    base.moduleCompleted += row.moduleCompleted;
    base.moduleTotal += row.moduleTotal;
    base.classroomStudentCompleted += row.classroomStudentCompleted;
    base.classroomStudentTotal += row.classroomStudentTotal;
    base.moduleStudentCompleted += row.moduleStudentCompleted;
    base.moduleStudentTotal += row.moduleStudentTotal;
    base.classroomScoreSum += row.classroomScoreSum;
    base.classroomScoreN += row.classroomScoreN;
    base.moduleScoreSum += row.moduleScoreSum;
    base.moduleScoreN += row.moduleScoreN;
  }
  return finishCounts(base);
}

function studentsIn(roster: AssessmentRosterRow[], match: (row: AssessmentRosterRow) => boolean): number {
  return distinctStudents(roster.filter(match));
}

export function buildAssessmentRows(
  slots: AssessmentSlot[],
  roster: AssessmentRosterRow[],
  grain: Exclude<AssessmentGrain, "student">,
): AssessmentViewRow[] {
  const groups = new Map<string, AssessmentSlot[]>();
  const add = (key: string, slot: AssessmentSlot) => {
    const list = groups.get(key);
    if (list) list.push(slot);
    else groups.set(key, [slot]);
  };
  for (const slot of slots) {
    if (grain === "campus") add(slot.instituteName, slot);
    else if (grain === "semester") add(`${slot.instituteName}\t${slot.semester}`, slot);
    else if (grain === "section") add(`${slot.instituteName}\t${slot.section}`, slot);
    else add(`${slot.instituteName}\t${slot.subject}`, slot);
  }

  if (grain === "campus") {
    for (const row of roster) {
      if (!groups.has(row.instituteName)) groups.set(row.instituteName, []);
    }
  }

  const rows: AssessmentViewRow[] = [];
  for (const [key, group] of groups) {
    const [university = "", second = ""] = key.split("\t");
    const subjectAcc = groupSubjects(group);
    const studentCount =
      grain === "subject"
        ? subjectAcc.reduce((sum, subject) => sum + subject.studentCount, 0)
        : studentsIn(roster, (row) => {
            if (row.instituteName !== university) return false;
            if (grain === "semester") return row.semester === second;
            if (grain === "section") return row.section === second;
            return true;
          });
    rows.push({
      key,
      university,
      semester: grain === "semester" ? second : null,
      section: grain === "section" ? second : null,
      subject: grain === "subject" ? second : null,
      studentCount,
      counts: countsFromAccs(subjectAcc),
    });
  }

  return rows.sort((left, right) => {
    const campus = left.university.localeCompare(right.university);
    if (campus !== 0 && grain !== "campus") return campus;
    const label = (row: AssessmentViewRow) =>
      row.subject ?? row.section ?? row.semester ?? row.university;
    return label(left).localeCompare(label(right), undefined, { numeric: true });
  });
}
