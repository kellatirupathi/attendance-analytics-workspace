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
}

export type AttendanceState = "met" | "not_met" | "not_available";

export interface DirectoryStudent {
  /** UUID with hyphens, as shown and used in the report link. */
  studentId: string;
  name: string | null;
  college: string;
  semester: string | null;
  /** Short section, e.g. "S-005". */
  section: string;
  attendancePct: number | null;
  attendanceState: AttendanceState;
  /** Out of 10, or null when the report has none yet. */
  spi: number | null;
  skillDebt: boolean;
  courses: DirectoryCourse[];
}

export interface DirectoryFilter {
  /** Campuses and subjects the user may see (empty or missing: all). */
  scopeCampuses?: string[];
  scopeSubjects?: string[];
  college?: string;
  semester?: string;
  section?: string;
  subject?: string;
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
  semester: string | null;
  section: string;
  classroom: number | null;
  module: number | null;
  skill: number | null;
  spi: number | null;
  attendancePct: number | null;
  eligible: boolean;
  skillDebt: boolean;
}

export interface DirectorySummary {
  students: number;
  avgAttendance: number | null;
  eligible: number;
  notEligible: number;
  avgSpi: number | null;
  skillDebt: number;
}

const plain = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
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
function subjectSet(f: DirectoryFilter): Set<string> | null {
  const scope = (f.scopeSubjects ?? []).map(plain).filter(Boolean);
  const chosen = plain(f.subject ?? "");
  if (chosen) return new Set(scope.length && !scope.includes(chosen) ? [] : [chosen]);
  return scope.length ? new Set(scope) : null;
}

function matches(s: DirectoryStudent, f: DirectoryFilter, subjects: Set<string> | null): boolean {
  const campuses = f.scopeCampuses ?? [];
  if (campuses.length && !campuses.some((c) => c.trim() === s.college)) return false;
  if (f.college && s.college !== f.college.trim()) return false;
  if (f.semester && (s.semester ?? "") !== f.semester.trim()) return false;
  if (f.section && s.section !== f.section.trim()) return false;
  if (subjects && !s.courses.some((c) => subjects.has(plain(c.name)))) return false;
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
    semester: s.semester,
    section: s.section,
    classroom: weighted((c) => c.classroom),
    module: weighted((c) => c.module),
    skill: mean(skills, r1),
    spi: s.spi,
    attendancePct: s.attendancePct,
    eligible: s.attendanceState === "met",
    skillDebt: s.skillDebt,
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

export interface DirectoryOptions {
  colleges: string[];
  semesters: string[];
  sections: { college: string; semester: string | null; section: string }[];
  subjects: string[];
}

/** Filter choices within the user's scope. */
export function directoryOptions(students: DirectoryStudent[], f: Pick<DirectoryFilter, "scopeCampuses" | "scopeSubjects">): DirectoryOptions {
  const subjects = subjectSet({ scopeSubjects: f.scopeSubjects });
  const inScope = students.filter((s) => matches(s, { scopeCampuses: f.scopeCampuses }, null));
  const colleges = new Set<string>();
  const semesters = new Set<string>();
  const sections = new Map<string, { college: string; semester: string | null; section: string }>();
  const names = new Map<string, string>();
  for (const s of inScope) {
    if (subjects && !s.courses.some((c) => subjects.has(plain(c.name)))) continue;
    colleges.add(s.college);
    if (s.semester) semesters.add(s.semester);
    sections.set(`${s.college}\t${s.semester}\t${s.section}`, { college: s.college, semester: s.semester, section: s.section });
    for (const c of s.courses) {
      const key = plain(c.name);
      if (!subjects || subjects.has(key)) if (!names.has(key)) names.set(key, c.name.trim());
    }
  }
  const byText = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
  return {
    colleges: [...colleges].sort(byText),
    semesters: [...semesters].sort(byText),
    sections: [...sections.values()].sort((a, b) => byText(a.college, b.college) || byText(a.section, b.section)),
    subjects: [...names.values()].sort(byText),
  };
}

type SortValue = string | number | null;
export const DIRECTORY_SORT: Record<string, (r: DirectoryRow) => SortValue> = {
  college: (r) => r.college,
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
