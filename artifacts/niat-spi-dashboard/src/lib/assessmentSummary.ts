/* ------------------------------------------------------------------ */
/*  Assessment summary: response shape for                            */
/*  GET /api/assessments/summary and a mock source for Phase 1.       */
/* ------------------------------------------------------------------ */
import {
  finishMetrics,
  rollUp,
  type AssessmentCountsRaw,
  type AssessmentMetrics,
} from "./assessmentMetrics";

export type SummaryType = "cq" | "mq" | "all";
export type SummaryGroupBy = "campus" | "subject" | "section" | "semester" | "student";
export type SummarySemester = "current" | "1" | "3" | "all";

export interface SummaryParams {
  type: SummaryType;
  groupBy: SummaryGroupBy;
  semester: SummarySemester;
  campuses: string[];
  /** "campus\tsection" ids. */
  sections: string[];
  subjects: string[];
  student: string;
}

export interface SemesterMetrics extends AssessmentMetrics {
  /** Stable id, e.g. "Aurora University\tAURORA Batch -1\tSemester 5". */
  id: string;
  campus: string;
  batch: string;
  /** Title as the campus names it, e.g. "Year 2 - Term 2". */
  title: string;
  /** Derived semester, e.g. "Semester 5". */
  semester: string;
  startDate: string;
  endDate: string;
  /** The institute runs terms/trimesters, not two semesters a year. */
  termWise: boolean;
}

export interface SummaryRow extends AssessmentMetrics {
  id: string;
  name: string;
  campus?: string;
  section?: string;
  semester?: string;
  batch?: string;
  semesterTitle?: string;
  startDate?: string;
  endDate?: string;
  termWise?: boolean;
  studentId?: string;
  spiPath?: string;
  semesters: SemesterMetrics[];
}

export interface AssessmentSummary {
  overall: AssessmentMetrics;
  rows: SummaryRow[];
  /** Every campus × batch-semester in scope (feeds the semester panel). */
  semesters: SemesterMetrics[];
  options: {
    campuses: string[];
    sections: { campus: string; section: string }[];
    subjects: string[];
  };
}

/* ---------------------------- mock data ---------------------------- */

interface MockPeriod {
  campus: string;
  batch: string;
  title: string;
  semester: string;
  start: string;
  end: string;
  termWise: boolean;
  sections: string[];
  subjects: string[];
}

const SUBJECTS_SEM1 = ["Applied Communicative English", "Logical Reasoning", "Probability and Statistics", "Statistical Computing Lab"];
const SUBJECTS_SEM3 = ["Back End Development", "Design and Analysis of Algorithms", "AI for Finance", "Logical Reasoning"];

const sections = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}-S-${String(i + 1).padStart(3, "0")}`);

/** Real current calendars (niat_institute_batch_section_semester_details, 13 Oct 2026). */
const PERIODS: MockPeriod[] = [
  { campus: "Aurora University", batch: "AURORA Batch -1", title: "Year 2 - Term 2", semester: "Semester 5", start: "2026-10-11", end: "2027-01-04", termWise: true, sections: sections("AURORA B1", 6), subjects: SUBJECTS_SEM3 },
  { campus: "Aurora University", batch: "AURORA Batch -2", title: "Year 1 - Term 1", semester: "Semester 1", start: "2026-09-15", end: "2026-12-10", termWise: true, sections: sections("AURORA B2", 3), subjects: SUBJECTS_SEM1 },
  { campus: "Crescent University", batch: "CU Batch-1", title: "Semester 3", semester: "Semester 3", start: "2026-07-15", end: "2026-11-24", termWise: false, sections: sections("CU B1", 3), subjects: SUBJECTS_SEM3 },
  { campus: "Crescent University", batch: "Crescent University Batch 2", title: "Semester 1", semester: "Semester 1", start: "2026-07-30", end: "2026-12-04", termWise: false, sections: sections("CU B2", 3), subjects: SUBJECTS_SEM1 },
  { campus: "Malla Reddy University", batch: "Malla Reddy University Batch 1", title: "Semester 1", semester: "Semester 1", start: "2026-08-04", end: "2026-12-24", termWise: false, sections: sections("MRU B1", 5), subjects: SUBJECTS_SEM1 },
  { campus: "NRI", batch: "NRI Batch-1", title: "Semester 3", semester: "Semester 3", start: "2026-06-10", end: "2026-11-30", termWise: false, sections: sections("NRI B1", 4), subjects: SUBJECTS_SEM3 },
  { campus: "NRI", batch: "NRI Batch 2", title: "Semester 1", semester: "Semester 1", start: "2026-08-31", end: "2026-12-15", termWise: false, sections: sections("NRI B2", 3), subjects: SUBJECTS_SEM1 },
  { campus: "S-VYASA", batch: "S-VYASA Batch-1", title: "Semester 3", semester: "Semester 3", start: "2026-08-10", end: "2026-12-21", termWise: false, sections: sections("SV B1", 4), subjects: SUBJECTS_SEM3 },
  { campus: "S-VYASA", batch: "S-VYASA Batch-2", title: "Semester 1", semester: "Semester 1", start: "2026-08-17", end: "2027-01-20", termWise: false, sections: sections("SV B2", 4), subjects: SUBJECTS_SEM1 },
  { campus: "Takshasila University", batch: "TU Batch-1", title: "Semester 3", semester: "Semester 3", start: "2026-08-01", end: "2026-12-01", termWise: false, sections: sections("TU B1", 4), subjects: SUBJECTS_SEM3 },
  { campus: "Takshasila University", batch: "Takshasila University Batch 2", title: "Semester 1", semester: "Semester 1", start: "2026-09-28", end: "2027-01-21", termWise: false, sections: sections("TU B2", 2), subjects: SUBJECTS_SEM1 },
  { campus: "Vivekananda global University", batch: "VGU Batch-1", title: "Semester 3", semester: "Semester 3", start: "2026-08-03", end: "2026-11-30", termWise: false, sections: sections("VGU B1", 5), subjects: SUBJECTS_SEM3 },
  { campus: "Vivekananda global University", batch: "VGU Batch-2", title: "Semester 1", semester: "Semester 1", start: "2026-08-17", end: "2026-11-30", termWise: false, sections: sections("VGU B2", 3), subjects: SUBJECTS_SEM1 },
  { campus: "Yenapoya University", batch: "YENEPOYA Batch-1 CSE AI", title: "Semester 3", semester: "Semester 3", start: "2026-08-03", end: "2026-12-04", termWise: false, sections: sections("YEN B1", 4), subjects: SUBJECTS_SEM3 },
  { campus: "Yenapoya University", batch: "YENEPOYA Batch-2 CSE AI", title: "Semester 1", semester: "Semester 1", start: "2026-07-27", end: "2026-12-04", termWise: false, sections: sections("YEN B2", 3), subjects: SUBJECTS_SEM1 },
];

/** Headline numbers from the brief (Classroom quizzes, all campuses). */
const TARGETS: Record<"cq" | "mq", { students: number; scheduled: number; conducted: number; expected: number; attempted: number; scoreSum: number }> = {
  // avg = 1,968,985 ÷ 34,580 = 56.9 · overall = 1,968,985 ÷ 45,189 = 43.6
  cq: { students: 16024, scheduled: 980, conducted: 465, expected: 45189, attempted: 34580, scoreSum: 1968985 },
  mq: { students: 16024, scheduled: 210, conducted: 96, expected: 9412, attempted: 6118, scoreSum: 371042 },
};

interface MockCell {
  period: MockPeriod;
  section: string;
  subject: string;
  students: number;
  cq: AssessmentCountsRaw;
  mq: AssessmentCountsRaw;
}

/** Deterministic pseudo-random in [0, 1) from a string. */
function seeded(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

/** Split `total` into integer parts proportional to `weights`, summing exactly to `total`. */
function apportion(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  const raw = weights.map((w) => (total * w) / sum);
  const out = raw.map(Math.floor);
  let rest = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((v, i) => [v - Math.floor(v), i] as const).sort((a, b) => b[0] - a[0]);
  for (let k = 0; rest > 0; k = (k + 1) % order.length, rest--) out[order[k]![1]]! += 1;
  return out;
}

function buildCells(): MockCell[] {
  const keys = PERIODS.flatMap((p) => p.sections.flatMap((s) => p.subjects.map((subj) => ({ p, s, subj }))));
  const sectionKeys = PERIODS.flatMap((p) => p.sections.map((s) => `${p.campus}\t${s}`));
  const sectionStudents = new Map(
    apportion(TARGETS.cq.students, sectionKeys.map((k) => 0.6 + seeded(k))).map((n, i) => [sectionKeys[i]!, n]),
  );
  const unitKeys = [...new Set(keys.map(({ p, subj }) => `${p.campus}\t${p.batch}\t${subj}`))];

  const build = (type: "cq" | "mq") => {
    const t = TARGETS[type];
    const scheduled = new Map(apportion(t.scheduled, unitKeys.map((k) => 0.7 + seeded(type + k))).map((n, i) => [unitKeys[i]!, n]));
    const conducted = new Map<string, number>(unitKeys.map((k) => [k, 0]));
    apportion(t.conducted, unitKeys.map((k) => scheduled.get(k)! * (0.6 + seeded(`c${type}${k}`)))).forEach((n, i) =>
      conducted.set(unitKeys[i]!, Math.min(n, scheduled.get(unitKeys[i]!)!)),
    );
    const expected = apportion(t.expected, keys.map(({ p, s, subj }) => sectionStudents.get(`${p.campus}\t${s}`)! * (0.5 + seeded(`e${type}${s}${subj}`))));
    const rates = keys.map(({ p, s, subj }) => 0.55 + 0.4 * seeded(`r${type}${p.campus}${s}${subj}`));
    const attempted = apportion(t.attempted, expected.map((e, i) => e * rates[i]!)).map((a, i) => Math.min(a, expected[i]!));
    const scores = apportion(t.scoreSum, attempted.map((a, i) => a * (40 + 35 * seeded(`s${type}${keys[i]!.s}${keys[i]!.subj}`))));
    return { scheduled, conducted, expected, attempted, scores };
  };
  const cq = build("cq");
  const mq = build("mq");

  return keys.map(({ p, s, subj }, i) => {
    const unit = `${p.campus}\t${p.batch}\t${subj}`;
    // Assessment counts belong to the campus-batch-subject unit; they are added once per unit on roll-up.
    const raw = (b: typeof cq, idx: number): AssessmentCountsRaw => ({
      scheduled: b.scheduled.get(unit)!,
      conducted: b.conducted.get(unit)!,
      students: 0,
      expectedAttempts: b.expected[idx]!,
      attempted: b.attempted[idx]!,
      scoreSum: b.scores[idx]!,
    });
    return { period: p, section: s, subject: subj, students: sectionStudents.get(`${p.campus}\t${s}`)!, cq: raw(cq, i), mq: raw(mq, i) };
  });
}

let CELLS: MockCell[] | null = null;
const cells = () => (CELLS ??= buildCells());

const periodId = (p: MockPeriod) => `${p.campus}\t${p.batch}\t${p.semester}`;

/** Sum cells, counting each section's students once and each campus-batch-subject's assessments once. */
function aggregate(list: MockCell[], type: SummaryType): AssessmentMetrics {
  const pick = (c: MockCell): AssessmentCountsRaw =>
    type === "cq" ? c.cq : type === "mq" ? c.mq : rollUp([c.cq, c.mq]);
  const seenSection = new Set<string>();
  const seenUnit = new Set<string>();
  let students = 0;
  let scheduled = 0;
  let conducted = 0;
  for (const c of list) {
    const sk = `${c.period.campus}\t${c.section}`;
    if (!seenSection.has(sk)) {
      seenSection.add(sk);
      students += c.students;
    }
    const uk = `${periodId(c.period)}\t${c.subject}`;
    if (!seenUnit.has(uk)) {
      seenUnit.add(uk);
      const r = pick(c);
      scheduled += r.scheduled;
      conducted += r.conducted;
    }
  }
  return rollUp(list.map(pick), { students, scheduled, conducted });
}

function semesterMetrics(list: MockCell[], type: SummaryType): SemesterMetrics[] {
  const byPeriod = new Map<string, MockCell[]>();
  for (const c of list) {
    const id = periodId(c.period);
    byPeriod.set(id, [...(byPeriod.get(id) ?? []), c]);
  }
  return [...byPeriod.entries()].map(([id, group]) => {
    const p = group[0]!.period;
    return {
      id,
      campus: p.campus,
      batch: p.batch,
      title: p.title,
      semester: p.semester,
      startDate: p.start,
      endDate: p.end,
      termWise: p.termWise,
      ...aggregate(group, type),
    };
  });
}

function groupBy<T>(list: T[], key: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of list) {
    const k = key(item);
    const bucket = out.get(k);
    if (bucket) bucket.push(item);
    else out.set(k, [item]);
  }
  return out;
}

/** Synthetic students for the student grain (no real names in mock data). */
function mockStudents(list: MockCell[], type: SummaryType): SummaryRow[] {
  const bySection = groupBy(list, (c) => `${c.period.campus}\t${c.section}`);
  const rows: SummaryRow[] = [];
  for (const [key, group] of bySection) {
    const [campus, section] = key.split("\t") as [string, string];
    const take = Math.min(12, group[0]!.students);
    for (let i = 0; i < take; i++) {
      const id = `${section}-${String(i + 1).padStart(3, "0")}`;
      const conducted = group.reduce((n, c) => n + (type === "mq" ? c.mq.conducted : type === "cq" ? c.cq.conducted : c.cq.conducted + c.mq.conducted), 0);
      const expected = Math.max(1, Math.round(conducted / 3));
      const attempted = Math.round(expected * (0.4 + 0.6 * seeded(`st${type}${id}`)));
      const avg = 30 + 65 * seeded(`sc${type}${id}`);
      rows.push({
        id,
        name: `Sample student ${id}`,
        studentId: id,
        campus,
        section,
        semester: group[0]!.period.semester,
        spiPath: undefined,
        semesters: [],
        ...finishMetrics({ scheduled: 0, conducted, students: 1, expectedAttempts: expected, attempted, scoreSum: attempted * avg }),
      });
    }
  }
  return rows;
}

const SEMESTER_FILTER: Record<SummarySemester, string | null> = { current: null, all: null, "1": "Semester 1", "3": "Semester 3" };

export function buildMockSummary(params: SummaryParams): AssessmentSummary {
  const all = cells();
  const semesterName = SEMESTER_FILTER[params.semester];
  const campusSet = new Set(params.campuses);
  const sectionSet = new Set(params.sections);
  const subjectSet = new Set(params.subjects);
  const scoped = all.filter(
    (c) =>
      (!campusSet.size || campusSet.has(c.period.campus)) &&
      (!semesterName || c.period.semester === semesterName) &&
      (!sectionSet.size || sectionSet.has(`${c.period.campus}\t${c.section}`)) &&
      (!subjectSet.size || subjectSet.has(c.subject)),
  );

  const semesters = semesterMetrics(scoped, params.type);
  const semestersOf = (campus: string) => semesters.filter((s) => s.campus === campus);

  let rows: SummaryRow[];
  switch (params.groupBy) {
    case "subject":
      rows = [...groupBy(scoped, (c) => c.subject)].map(([subject, group]) => ({
        id: subject,
        name: subject,
        semesters: semesterMetrics(group, params.type),
        ...aggregate(group, params.type),
      }));
      break;
    case "section":
      rows = [...groupBy(scoped, (c) => `${c.period.campus}\t${c.section}`)].map(([key, group]) => ({
        id: key,
        name: group[0]!.section,
        campus: group[0]!.period.campus,
        section: group[0]!.section,
        semester: group[0]!.period.semester,
        semesters: semesterMetrics(group, params.type),
        ...aggregate(group, params.type),
      }));
      break;
    case "semester":
      rows = [...groupBy(scoped, (c) => periodId(c.period))].map(([key, group]) => {
        const p = group[0]!.period;
        return {
          id: key,
          name: p.campus,
          campus: p.campus,
          batch: p.batch,
          semesterTitle: p.title,
          semester: p.semester,
          startDate: p.start,
          endDate: p.end,
          termWise: p.termWise,
          semesters: [],
          ...aggregate(group, params.type),
        };
      });
      break;
    case "student": {
      const term = params.student.trim().toLowerCase();
      rows = mockStudents(scoped, params.type).filter((r) => !term || r.name.toLowerCase().includes(term) || r.studentId!.toLowerCase().includes(term));
      break;
    }
    default:
      rows = [...groupBy(scoped, (c) => c.period.campus)].map(([campus, group]) => ({
        id: campus,
        name: campus,
        campus,
        semesters: semestersOf(campus),
        ...aggregate(group, params.type),
      }));
  }

  const overall = scoped.length ? aggregate(scoped, params.type) : finishMetrics({ scheduled: 0, conducted: 0, students: 0, expectedAttempts: 0, attempted: 0, scoreSum: 0 });
  const optionCells = all.filter((c) => !semesterName || c.period.semester === semesterName);
  return {
    overall,
    rows,
    semesters,
    options: {
      campuses: [...new Set(optionCells.map((c) => c.period.campus))].sort(),
      sections: [...new Map(optionCells.filter((c) => campusSet.has(c.period.campus)).map((c) => [`${c.period.campus}\t${c.section}`, { campus: c.period.campus, section: c.section }])).values()],
      subjects: [...new Set(optionCells.map((c) => c.subject))].sort(),
    },
  };
}
