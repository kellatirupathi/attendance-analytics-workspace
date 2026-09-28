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
}

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
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function rate(completed: number, total: number): number {
  if (total <= 0) return 0;
  return round1((completed / total) * 100);
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
  }
  return {
    classroomCompleted,
    classroomTotal,
    moduleCompleted,
    moduleTotal,
    totalCompleted: classroomCompleted + moduleCompleted,
    totalAssigned: classroomTotal + moduleTotal,
    classroomStudentCompleted,
    classroomStudentTotal,
    moduleStudentCompleted,
    moduleStudentTotal,
    classroomPct: rate(classroomStudentCompleted, classroomStudentTotal),
    modulePct: rate(moduleStudentCompleted, moduleStudentTotal),
    completionPct: rate(
      classroomStudentCompleted + moduleStudentCompleted,
      classroomStudentTotal + moduleStudentTotal,
    ),
  };
}

function namedSubject(subject: string): boolean {
  const name = subject.trim();
  return name.length > 0 && name.toLowerCase() !== "null";
}

export function filterSlots(slots: AssessmentSlot[], scope: AssessmentScope): AssessmentSlot[] {
  return slots.filter((slot) => {
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
  const summed = rows.reduce(
    (acc, row) => {
      acc.classroomCompleted += row.classroomCompleted;
      acc.classroomTotal += row.classroomTotal;
      acc.moduleCompleted += row.moduleCompleted;
      acc.moduleTotal += row.moduleTotal;
      acc.classroomStudentCompleted += row.classroomStudentCompleted;
      acc.classroomStudentTotal += row.classroomStudentTotal;
      acc.moduleStudentCompleted += row.moduleStudentCompleted;
      acc.moduleStudentTotal += row.moduleStudentTotal;
      return acc;
    },
    {
      classroomCompleted: 0,
      classroomTotal: 0,
      moduleCompleted: 0,
      moduleTotal: 0,
      totalCompleted: 0,
      totalAssigned: 0,
      classroomStudentCompleted: 0,
      classroomStudentTotal: 0,
      moduleStudentCompleted: 0,
      moduleStudentTotal: 0,
      classroomPct: 0,
      modulePct: 0,
      completionPct: 0,
    },
  );
  summed.totalCompleted = summed.classroomCompleted + summed.moduleCompleted;
  summed.totalAssigned = summed.classroomTotal + summed.moduleTotal;
  summed.classroomPct = rate(summed.classroomStudentCompleted, summed.classroomStudentTotal);
  summed.modulePct = rate(summed.moduleStudentCompleted, summed.moduleStudentTotal);
  summed.completionPct = rate(
    summed.classroomStudentCompleted + summed.moduleStudentCompleted,
    summed.classroomStudentTotal + summed.moduleStudentTotal,
  );
  return summed;
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
