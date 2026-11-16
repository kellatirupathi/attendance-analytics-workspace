/**
 * The Semester filter on every page: "Current semester" (each student's latest semester, as before) or one
 * semester that has ended ("Semester 3"), shown from the saved reports of that semester (spi_report_history).
 * The ended semesters come from the data, so a new one appears in the menu on its own once its end date passes.
 * Pure functions; no imports with side effects, so they can be tested on their own.
 */

/** One ended saved report: a student's place in a semester that has ended. */
export interface PastPlace {
  /** Lower-case UUID without hyphens (the report's student key). */
  studentKey: string;
  college: string;
  batch: string;
  /** Semester title as saved, e.g. "Semester 3". */
  semester: string;
  section: string;
}

/** One choice in the Semester menu: an ended semester at one college, with its students. */
export interface PastSemesterOption {
  semester: string;
  college: string;
  students: number;
}

const byText = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

/**
 * Reads the Semester filter from a request: "" (or anything empty, or the old running / ended values) is the
 * current semester; any other text is an ended semester's title. Long values are cut so they cannot be abused.
 */
export function readTerm(raw: unknown): string | undefined {
  const value = typeof raw === "string" ? raw.trim().slice(0, 60) : "";
  if (!value || value === "running" || value === "ended") return undefined;
  return value;
}

/** The ended semesters a user can pick, per college (the page narrows them to the colleges chosen). Newest title first. */
export function pastSemesterOptions(places: PastPlace[], scopeCampuses?: string[]): PastSemesterOption[] {
  const scope = scopeCampuses?.length ? new Set(scopeCampuses.map((c) => c.trim())) : null;
  const by = new Map<string, { semester: string; college: string; students: Set<string> }>();
  for (const p of places) {
    if (scope && !scope.has(p.college)) continue;
    const key = `${p.semester}\t${p.college}`;
    const entry = by.get(key) ?? { semester: p.semester, college: p.college, students: new Set<string>() };
    entry.students.add(p.studentKey);
    by.set(key, entry);
  }
  return [...by.values()]
    .map((e) => ({ semester: e.semester, college: e.college, students: e.students.size }))
    .sort((a, b) => byText(b.semester, a.semester) || byText(a.college, b.college));
}

/** "studentKey\tcollege" of every student with an ended report of `semester`, within the user's colleges. */
export function pastKeysFor(places: PastPlace[], semester: string, scopeCampuses?: string[]): string[] {
  const scope = scopeCampuses?.length ? new Set(scopeCampuses.map((c) => c.trim())) : null;
  const keys = new Set<string>();
  for (const p of places) {
    if (p.semester !== semester) continue;
    if (scope && !scope.has(p.college)) continue;
    keys.add(`${p.studentKey}\t${p.college}`);
  }
  return [...keys].sort();
}
