/**
 * Student Directory built from the saved student reports (spi_report_cache): every number is the one the
 * student's report shows, so the directory and the report always agree.
 *
 *  - Eligible: the report's attendance criterion is met (at least 80% in every course).
 *  - Attendance: the report's overall attendance (present ÷ held, all courses together).
 *  - Expected SPI: the report's SPI out of 10 (provisional until the Final Skill Assessment is in).
 *  - Skill debt: the report lists at least one skill-debt course.
 *  - Classroom / Module quiz average: best scores of the quizzes held ÷ quizzes held over the student's courses
 *    (a missed quiz counts as 0), the same "Overall score" as the Assessments page.
 *  - Skill Assessment average: the mean of the course best scores on the report.
 * Pure functions only; the route (routes/studentDirectory.ts) loads the data and pages the result.
 */

export interface DirectoryPart {
  avgPct: number;
  total: number;
}

export interface DirectoryCourse {
  name: string;
  classroom: DirectoryPart | null;
  module: DirectoryPart | null;
  skill: DirectoryPart | null;
  /** The course's own attendance %, its score out of 100, its level points (0–10) and whether it is level F (skill debt). */
  attendancePct?: number | null;
  score?: number | null;
  points?: number | null;
  levelF?: boolean;
}

export type AttendanceState = "met" | "not_met" | "not_available";
/** The report's attendance tier, from the student's weakest course (80 / 60 / 50). */
export type ReportTier = "eligible" | "recovery_eligible" | "at_risk" | "ineligible";

export interface DirectoryStudent {
  /** UUID with hyphens, as shown and used in the report link. */
  studentId: string;
  name: string | null;
  college: string;
  /** The batch on the report (the batch of the student's latest session); "Unknown" when the report has none. */
  batch?: string;
  semester: string | null;
  /** Short section, e.g. "S-005" (the same name repeats across the batches of a college). */
  section: string;
  attendancePct: number | null;
  attendanceState: AttendanceState;
  /** null when the student has no sessions yet. */
  tier?: ReportTier | null;
  /** Out of 10, or null when the report has none yet. */
  spi: number | null;
  skillDebt: boolean;
  /** True when the semester has ended: the row is the last saved report from spi_report_history. */
  ended?: boolean;
  courses: DirectoryCourse[];
}

export interface DirectoryFilter {
  /** Campuses and subjects the user may see (empty or missing: all). */
  scopeCampuses?: string[];
  scopeSubjects?: string[];
  college?: string;
  /** Several colleges (the page's College menu); `college` still works for one (Overview). */
  colleges?: string[];
  /** "college\tbatch" keys. */
  batches?: string[];
  /** Running: a current-semester report; ended: the last report of a semester that ended. */
  term?: "running" | "ended";
  semester?: string;
  section?: string;
  /** "batch\tsection" keys (a section name repeats across batches), or plain section names. */
  sections?: string[];
  subject?: string;
  /** The report's attendance tier. */
  tier?: ReportTier;
  /** Attendance % bounds, 0–100. */
  attMin?: number;
  attMax?: number;
  /** Name or UUID search. */
  q?: string;
}

export interface DirectoryRow {
  studentId: string;
  name: string | null;
  college: string;
  batch: string;
  semester: string | null;
  section: string;
  classroom: number | null;
  module: number | null;
  skill: number | null;
  spi: number | null;
  attendancePct: number | null;
  eligible: boolean;
  skillDebt: boolean;
  ended?: boolean;
}

export interface DirectorySummary {
  students: number;
  avgAttendance: number | null;
  eligible: number;
  notEligible: number;
  avgSpi: number | null;
  skillDebt: number;
}

export const plain = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
export const batchOf = (s: { batch?: string | null }) => (s.batch ?? "").trim() || "Unknown";
const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;
const mean = (values: number[], round: (n: number) => number): number | null => (values.length ? round(values.reduce((s, v) => s + v, 0) / values.length) : null);

/** "Takshasila University Batch 1-S-003" → "S-003". */
export function shortSection(section: string | null | undefined): string {
  const s = (section ?? "").trim();
  const m = s.match(/(S-\d+)$/i);
  return m ? m[1]!.toUpperCase() : s.includes("-") ? s.slice(s.lastIndexOf("-") + 1) : s;
}

/** 32 hex characters → UUID with hyphens; anything else is returned as it is. */
export function hyphenate(id: string): string {
  const s = id.replace(/-/g, "").toLowerCase();
  return /^[0-9a-f]{32}$/.test(s) ? `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}` : id;
}

/** The subject names a request is limited to: the filter's subject, else the user's own subjects; null = every course. */
export function subjectSet(f: DirectoryFilter): Set<string> | null {
  const scope = (f.scopeSubjects ?? []).map(plain).filter(Boolean);
  const chosen = plain(f.subject ?? "");
  if (chosen) return new Set(scope.length && !scope.includes(chosen) ? [] : [chosen]);
  return scope.length ? new Set(scope) : null;
}

export function matches(s: DirectoryStudent, f: DirectoryFilter, subjects: Set<string> | null): boolean {
  const campuses = f.scopeCampuses ?? [];
  if (campuses.length && !campuses.some((c) => c.trim() === s.college)) return false;
  if (f.college && s.college !== f.college.trim()) return false;
  if (f.colleges?.length && !f.colleges.some((c) => c.trim() === s.college)) return false;
  if (f.batches?.length && !f.batches.includes(`${s.college}\t${batchOf(s)}`)) return false;
  if (f.term === "running" && s.ended) return false;
  if (f.term === "ended" && !s.ended) return false;
  if (f.semester && (s.semester ?? "") !== f.semester.trim()) return false;
  if (f.section && s.section !== f.section.trim()) return false;
  if (f.sections?.length && !f.sections.includes(`${batchOf(s)}\t${s.section}`) && !f.sections.includes(s.section)) return false;
  if (subjects && !s.courses.some((c) => subjects.has(plain(c.name)))) return false;
  if (f.tier && s.tier !== f.tier) return false;
  const min = f.attMin ?? 0;
  const max = f.attMax ?? 100;
  if (min > 0 || max < 100) {
    if (s.attendancePct == null || s.attendancePct < min || s.attendancePct > max) return false;
  }
  const q = (f.q ?? "").trim().toLowerCase();
  if (q && !((s.name ?? "").toLowerCase().includes(q) || s.studentId.replace(/-/g, "").includes(q.replace(/-/g, "")))) return false;
  return true;
}

function rowOf(s: DirectoryStudent, subjects: Set<string> | null): DirectoryRow {
  const courses = subjects ? s.courses.filter((c) => subjects.has(plain(c.name))) : s.courses;
  const weighted = (pick: (c: DirectoryCourse) => DirectoryPart | null): number | null => {
    let points = 0;
    let held = 0;
    for (const c of courses) {
      const p = pick(c);
      if (!p || p.total <= 0) continue;
      points += p.avgPct * p.total;
      held += p.total;
    }
    return held > 0 ? r1(points / held) : null;
  };
  const skills = courses.map((c) => c.skill).filter((p): p is DirectoryPart => p != null && p.total > 0).map((p) => p.avgPct);
  return {
    studentId: s.studentId,
    name: s.name,
    college: s.college,
    batch: batchOf(s),
    semester: s.semester,
    section: s.section,
    classroom: weighted((c) => c.classroom),
    module: weighted((c) => c.module),
    skill: mean(skills, r1),
    spi: s.spi,
    attendancePct: s.attendancePct,
    eligible: s.attendanceState === "met",
    skillDebt: s.skillDebt,
    ...(s.ended ? { ended: true } : {}),
  };
}

/** Students that pass the filters, as table rows (quiz averages limited to the chosen / permitted subjects). */
export function directoryRows(students: DirectoryStudent[], f: DirectoryFilter): DirectoryRow[] {
  const subjects = subjectSet(f);
  return students.filter((s) => matches(s, f, subjects)).map((s) => rowOf(s, subjects));
}

export function summarize(rows: DirectoryRow[]): DirectorySummary {
  const eligible = rows.filter((r) => r.eligible).length;
  return {
    students: rows.length,
    avgAttendance: mean(rows.map((r) => r.attendancePct).filter((v): v is number => v != null), r1),
    eligible,
    notEligible: rows.length - eligible,
    avgSpi: mean(rows.map((r) => r.spi).filter((v): v is number => v != null), r2),
    skillDebt: rows.filter((r) => r.skillDebt).length,
  };
}

/** A batch for the Batch menu: the semester most of its students are on, whether it ended, and its students. */
export interface DirectoryBatchOption {
  campus: string;
  batch: string;
  semester: string;
  ended: boolean;
  students: number;
}

export interface DirectoryOptions {
  colleges: string[];
  batches: DirectoryBatchOption[];
  semesters: string[];
  sections: { college: string; batch: string; semester: string | null; section: string }[];
  subjects: string[];
}

/** Filter choices within the user's scope. */
export function directoryOptions(students: DirectoryStudent[], f: Pick<DirectoryFilter, "scopeCampuses" | "scopeSubjects">): DirectoryOptions {
  const subjects = subjectSet({ scopeSubjects: f.scopeSubjects });
  const inScope = students.filter((s) => matches(s, { scopeCampuses: f.scopeCampuses }, null));
  const colleges = new Set<string>();
  const semesters = new Set<string>();
  const sections = new Map<string, { college: string; batch: string; semester: string | null; section: string }>();
  const batches = new Map<string, { campus: string; batch: string; students: number; ended: boolean; bySemester: Map<string, number> }>();
  const names = new Map<string, string>();
  for (const s of inScope) {
    if (subjects && !s.courses.some((c) => subjects.has(plain(c.name)))) continue;
    colleges.add(s.college);
    if (s.semester) semesters.add(s.semester);
    const batch = batchOf(s);
    sections.set(`${s.college}\t${batch}\t${s.section}`, { college: s.college, batch, semester: s.semester, section: s.section });
    const b = batches.get(`${s.college}\t${batch}`) ?? { campus: s.college, batch, students: 0, ended: true, bySemester: new Map<string, number>() };
    b.students += 1;
    if (!s.ended) b.ended = false;
    b.bySemester.set(s.semester ?? "", (b.bySemester.get(s.semester ?? "") ?? 0) + 1);
    batches.set(`${s.college}\t${batch}`, b);
    for (const c of s.courses) {
      const key = plain(c.name);
      if (!subjects || subjects.has(key)) if (!names.has(key)) names.set(key, c.name.trim());
    }
  }
  const byText = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
  return {
    colleges: [...colleges].sort(byText),
    batches: [...batches.values()]
      .map((b) => ({
        campus: b.campus,
        batch: b.batch,
        semester: [...b.bySemester.entries()].sort((x, y) => y[1] - x[1] || byText(y[0], x[0]))[0]?.[0] ?? "",
        ended: b.ended,
        students: b.students,
      }))
      .sort((a, b) => byText(a.campus, b.campus) || byText(a.batch, b.batch)),
    semesters: [...semesters].sort(byText),
    sections: [...sections.values()].sort((a, b) => byText(a.college, b.college) || byText(a.batch, b.batch) || byText(a.section, b.section)),
    subjects: [...names.values()].sort(byText),
  };
}

type SortValue = string | number | null;
export const DIRECTORY_SORT: Record<string, (r: DirectoryRow) => SortValue> = {
  college: (r) => r.college,
  batch: (r) => r.batch,
  name: (r) => r.name?.trim() || null,
  semester: (r) => r.semester,
  section: (r) => r.section,
  classroom: (r) => r.classroom,
  module: (r) => r.module,
  skill: (r) => r.skill,
  spi: (r) => r.spi,
  attendance: (r) => r.attendancePct,
};

/** Blanks last in either direction; ties by college, then name. */
export function sortRows(rows: DirectoryRow[], key: string, dir: 1 | -1): DirectoryRow[] {
  const get = DIRECTORY_SORT[key] ?? DIRECTORY_SORT["college"]!;
  const text = (a: SortValue, b: SortValue) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
  return rows.slice().sort((a, b) => {
    const x = get(a);
    const y = get(b);
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    const c = typeof x === "number" && typeof y === "number" ? x - y : text(x, y);
    return c * dir || text(a.college, b.college) || text(a.name ?? "", b.name ?? "") || text(a.studentId, b.studentId);
  });
}
