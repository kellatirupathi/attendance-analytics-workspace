/**
 * In-memory model for the Assessments "Classroom Quiz" tab (Module Quiz reuses it with another snapshot).
 * Pure functions over the two result sets of quizCoverageSql.ts; no imports, so it can be tested on its own.
 *
 *   Completion rate  Σ completed ÷ Σ scheduled (the quiz table counts quizzes with status COMPLETED)
 *   Avg score        average of each student's best-attempt score per subject (blank scores are left out)
 *   Participation    students with at least one completed quiz ÷ students
 *   Available        quizzes planned in the prod sequence, counted once per section
 *   Scheduled so far the same, for quizzes whose first session is on or before today (IST)
 */

export interface QuizRow {
  campus: string;
  section: string;
  studentId: string;
  studentName: string | null;
  subject: string;
  category: string | null;
  scheduled: number;
  completed: number;
  avgScore: number | null;
}

export interface PlanRow {
  campus: string;
  section: string;
  sectionId: string;
  subject: string;
  category: string | null;
  resourceId: string;
  /** Date of the quiz's first session, YYYY-MM-DD. */
  firstDate: string;
}

export interface QuizCoverageModel {
  rows: QuizRow[];
  plan: PlanRow[];
}

export interface QuizFilter {
  /** Campuses the user may see (empty or missing: all). */
  scopeCampuses?: string[];
  /** Subjects the user may see (empty or missing: all). */
  scopeSubjects?: string[];
  college?: string;
  section?: string;
  category?: string;
  subject?: string;
}

const clean = (v: string | undefined) => (v ?? "").trim();

/** One predicate for quiz rows and plan rows: both carry campus, section, subject and category. */
function matcher(f: QuizFilter) {
  const scopeCampuses = new Set((f.scopeCampuses ?? []).map((c) => c.trim()));
  const scopeSubjects = new Set((f.scopeSubjects ?? []).map((c) => c.trim()));
  const college = clean(f.college);
  const section = clean(f.section);
  const category = clean(f.category).toUpperCase();
  const subject = clean(f.subject);
  return (r: { campus: string; section: string; subject: string; category: string | null }) =>
    (scopeCampuses.size === 0 || scopeCampuses.has(r.campus)) &&
    (scopeSubjects.size === 0 || scopeSubjects.has(r.subject)) &&
    (!college || r.campus === college) &&
    (!section || r.section === section) &&
    (!category || (r.category ?? "") === category) &&
    (!subject || r.subject === subject);
}

/** The courses each student's report shows (lib/reportCourses.ts), by plain lower-case name. */
export interface ReportCourses {
  /** Student id without hyphens, lower-cased → plain course names on that student's report. */
  byStudent: Map<string, Set<string>>;
  /** `college + tab + plain course name` for every course some student of that college sees on the report. */
  campusCourses: Set<string>;
}

const plainName = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");
const studentKeyOf = (id: string) => id.toLowerCase().replace(/-/g, "");

/**
 * Keeps only the courses the student report shows: a quiz row stays when its subject is on that student's
 * report, and a planned quiz stays when some student of its college sees that course on the report.
 * A student with no saved report (not synced yet) keeps their rows, so a late sync never hides students.
 */
export function restrictToReportCourses(model: QuizCoverageModel, report: ReportCourses): QuizCoverageModel {
  return {
    rows: model.rows.filter((r) => {
      const courses = report.byStudent.get(studentKeyOf(r.studentId));
      return !courses || courses.has(plainName(r.subject));
    }),
    plan: model.plan.filter((p) => report.campusCourses.has(`${p.campus}\t${plainName(p.subject)}`)),
  };
}

/**
 * Planned quizzes of the colleges that have student rows only: the same college scope as the student rows.
 * The prod sequence also holds colleges that are not NIAT campuses (the Intensive Offline ones, Training
 * Institute) and campuses with no quiz-table rows; counting their quizzes would not match the student numbers.
 */
export function scopePlanToStudentColleges(rows: QuizRow[], plan: PlanRow[]): PlanRow[] {
  const colleges = new Set(rows.map((r) => r.campus));
  return plan.filter((p) => colleges.has(p.campus));
}

export const filterRows = (model: QuizCoverageModel, f: QuizFilter): QuizRow[] => model.rows.filter(matcher(f));
export const filterPlan = (model: QuizCoverageModel, f: QuizFilter): PlanRow[] => model.plan.filter(matcher(f));

const r1 = (n: number) => Math.round(n * 10) / 10;
/** Percent with one decimal, or null when the base is 0. */
const pct = (part: number, whole: number): number | null => (whole > 0 ? r1((100 * part) / whole) : null);
const mean = (values: number[]): number | null => (values.length ? r1(values.reduce((a, b) => a + b, 0) / values.length) : null);

/** Today's date in India, YYYY-MM-DD. */
export function todayIst(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Distinct (section, quiz) pairs, and those scheduled on or before `today`. */
function planCounts(plan: PlanRow[], today: string): { available: number; scheduled: number } {
  const all = new Set<string>();
  const sofar = new Set<string>();
  for (const p of plan) {
    const key = `${p.sectionId}|${p.resourceId}`;
    all.add(key);
    // A quiz with no session date is planned but not scheduled yet.
    if (p.firstDate && p.firstDate <= today) sofar.add(key);
  }
  return { available: all.size, scheduled: sofar.size };
}

export interface QuizKpis {
  available: number;
  scheduledSoFar: number;
  completionRate: number | null;
  avgScore: number | null;
  participants: number;
  students: number;
  participation: number | null;
  /** Row counts of the three downloads for these filters. */
  counts: { campus: number; student: number; studentSubject: number };
}

export function quizKpis(model: QuizCoverageModel, f: QuizFilter, today = todayIst()): QuizKpis {
  const rows = filterRows(model, f);
  const { available, scheduled } = planCounts(filterPlan(model, f), today);
  let sch = 0;
  let comp = 0;
  const scores: number[] = [];
  const perStudent = new Map<string, number>();
  const campuses = new Set<string>();
  for (const r of rows) {
    sch += r.scheduled;
    comp += r.completed;
    if (r.avgScore != null) scores.push(r.avgScore);
    perStudent.set(r.studentId, (perStudent.get(r.studentId) ?? 0) + r.completed);
    campuses.add(r.campus);
  }
  const students = perStudent.size;
  const participants = [...perStudent.values()].filter((v) => v > 0).length;
  return {
    available,
    scheduledSoFar: scheduled,
    completionRate: pct(comp, sch),
    avgScore: mean(scores),
    participants,
    students,
    participation: pct(participants, students),
    counts: { campus: campuses.size, student: students, studentSubject: rows.length },
  };
}

export interface CampusRow {
  college: string;
  sections: number;
  students: number;
  scheduled: number;
  completionPct: number | null;
  avgScore: number | null;
  participationPct: number | null;
}

export function campusRows(model: QuizCoverageModel, f: QuizFilter, today = todayIst()): CampusRow[] {
  const planByCampus = new Map<string, PlanRow[]>();
  for (const p of filterPlan(model, f)) {
    const list = planByCampus.get(p.campus);
    if (list) list.push(p);
    else planByCampus.set(p.campus, [p]);
  }
  interface Acc { sections: Set<string>; sch: number; comp: number; scores: number[]; students: Map<string, number> }
  const by = new Map<string, Acc>();
  for (const r of filterRows(model, f)) {
    let a = by.get(r.campus);
    if (!a) by.set(r.campus, (a = { sections: new Set(), sch: 0, comp: 0, scores: [], students: new Map() }));
    a.sections.add(r.section);
    a.sch += r.scheduled;
    a.comp += r.completed;
    if (r.avgScore != null) a.scores.push(r.avgScore);
    a.students.set(r.studentId, (a.students.get(r.studentId) ?? 0) + r.completed);
  }
  return [...by.entries()].map(([college, a]) => {
    const participants = [...a.students.values()].filter((v) => v > 0).length;
    return {
      college,
      sections: a.sections.size,
      students: a.students.size,
      scheduled: planCounts(planByCampus.get(college) ?? [], today).scheduled,
      completionPct: pct(a.comp, a.sch),
      avgScore: mean(a.scores),
      participationPct: pct(participants, a.students.size),
    };
  });
}

export interface StudentRow {
  uid: string;
  name: string | null;
  college: string;
  section: string;
  scheduled: number;
  completed: number;
  completionPct: number | null;
  avgScore: number | null;
}

/** Students of the filtered rows; `search` matches the name or the start of the UID. */
export function studentRows(model: QuizCoverageModel, f: QuizFilter, search = ""): StudentRow[] {
  interface Acc { name: string | null; college: string; section: string; sch: number; comp: number; scores: number[] }
  const by = new Map<string, Acc>();
  for (const r of filterRows(model, f)) {
    let a = by.get(r.studentId);
    if (!a) by.set(r.studentId, (a = { name: r.studentName, college: r.campus, section: r.section, sch: 0, comp: 0, scores: [] }));
    a.sch += r.scheduled;
    a.comp += r.completed;
    if (r.avgScore != null) a.scores.push(r.avgScore);
  }
  const needle = search.trim().toLowerCase();
  const needleId = needle.replace(/-/g, "");
  const out: StudentRow[] = [];
  for (const [uid, a] of by) {
    if (needle && !((a.name ?? "").toLowerCase().includes(needle) || uid.toLowerCase().replace(/-/g, "").startsWith(needleId))) continue;
    out.push({ uid, name: a.name, college: a.college, section: a.section, scheduled: a.sch, completed: a.comp, completionPct: pct(a.comp, a.sch), avgScore: mean(a.scores) });
  }
  return out;
}

export interface StudentSubjectRow {
  uid: string;
  name: string | null;
  college: string;
  section: string;
  category: string | null;
  subject: string;
  scheduled: number;
  completed: number;
  completionPct: number | null;
  avgScore: number | null;
}

/** One row per student × subject (the student panel and the Student × subject download). */
export function studentSubjectRows(model: QuizCoverageModel, f: QuizFilter, uid?: string): StudentSubjectRow[] {
  const wanted = uid ? uid.toLowerCase().replace(/-/g, "") : "";
  return filterRows(model, f)
    .filter((r) => !wanted || r.studentId.toLowerCase().replace(/-/g, "") === wanted)
    .map((r) => ({
      uid: r.studentId,
      name: r.studentName,
      college: r.campus,
      section: r.section,
      category: r.category,
      subject: r.subject,
      scheduled: r.scheduled,
      completed: r.completed,
      completionPct: pct(r.completed, r.scheduled),
      avgScore: r.avgScore == null ? null : r1(r.avgScore),
    }));
}

export interface QuizFilterOptions {
  colleges: string[];
  sections: { college: string; section: string }[];
  categories: string[];
  subjects: { college: string; subject: string; category: string | null }[];
}

export function quizFilterOptions(model: QuizCoverageModel, f: Pick<QuizFilter, "scopeCampuses" | "scopeSubjects">): QuizFilterOptions {
  const rows = filterRows(model, f);
  const colleges = new Set<string>();
  const sections = new Map<string, { college: string; section: string }>();
  const categories = new Set<string>();
  const subjects = new Map<string, { college: string; subject: string; category: string | null }>();
  for (const r of rows) {
    colleges.add(r.campus);
    sections.set(`${r.campus}\t${r.section}`, { college: r.campus, section: r.section });
    if (r.category) categories.add(r.category);
    subjects.set(`${r.campus}\t${r.subject}`, { college: r.campus, subject: r.subject, category: r.category });
  }
  const byText = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
  return {
    colleges: [...colleges].sort(byText),
    sections: [...sections.values()].sort((a, b) => byText(a.college, b.college) || byText(a.section, b.section)),
    categories: [...categories].sort(byText),
    subjects: [...subjects.values()].sort((a, b) => byText(a.subject, b.subject) || byText(a.college, b.college)),
  };
}

/* ---- sorting ---- */

type SortValue = string | number | null;
const compare = (a: SortValue, b: SortValue): number => {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
};

/** Blanks always last, whatever the direction; ties by name. */
export function sortBy<T>(rows: T[], get: (row: T) => SortValue, dir: 1 | -1, tie: (row: T) => string): T[] {
  return rows.slice().sort((a, b) => {
    const x = get(a);
    const y = get(b);
    if (x == null || y == null) return compare(x, y);
    return compare(x, y) * dir || tie(a).localeCompare(tie(b), undefined, { numeric: true, sensitivity: "base" });
  });
}

export const CAMPUS_SORT: Record<string, (r: CampusRow) => SortValue> = {
  college: (r) => r.college,
  sections: (r) => r.sections,
  students: (r) => r.students,
  scheduled: (r) => r.scheduled,
  completion: (r) => r.completionPct,
  avg: (r) => r.avgScore,
  participation: (r) => r.participationPct,
};

export const STUDENT_SORT: Record<string, (r: StudentRow) => SortValue> = {
  // Students without a name sort last, in either direction.
  student: (r) => r.name?.trim() || null,
  uid: (r) => r.uid,
  section: (r) => r.section,
  scheduled: (r) => r.scheduled,
  completed: (r) => r.completed,
  completion: (r) => r.completionPct,
  avg: (r) => r.avgScore,
};
