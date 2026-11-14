/**
 * Student Directory: types and API calls. The numbers come from /api/dashboard/directory (the saved student
 * reports), so they match the report; the browser only displays them.
 */

const API = "/api/dashboard/directory";

export interface DirectoryFilters {
  /** One college (Overview). The Student Directory uses `colleges`. */
  college: string;
  /** Several colleges. */
  colleges: string[];
  /** "college	batch" keys. */
  batches: string[];
  /** "": this semester (every batch); running / ended. */
  term: "" | "running" | "ended";
  /** A semester title, from an Overview link only (no field on the page; shown as a chip). */
  semester: string;
  section: string;
  /** "batch	section" keys: a section name repeats across the batches of a college. */
  sections: string[];
  subject: string;
  attMin: number;
  attMax: number;
  q: string;
  /** The report's attendance tier ("eligible", "recovery_eligible", "at_risk", "ineligible"), or "" for all. */
  tier: string;
}
export const NO_DIRECTORY_FILTERS: DirectoryFilters = { college: "", colleges: [], batches: [], term: "", semester: "", section: "", sections: [], subject: "", attMin: 0, attMax: 100, q: "", tier: "" };

export type QuizTypeFilter = "" | "classroom" | "module" | "skill";

export interface DirectoryOptions {
  colleges: string[];
  batches: { campus: string; batch: string; semester: string; ended: boolean; students: number }[];
  semesters: string[];
  sections: { college: string; batch: string; semester: string | null; section: string }[];
  subjects: string[];
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
  /** Semester ended: the last saved report. */
  ended?: boolean;
  reportPath: string;
}

export interface DirectorySummary {
  students: number;
  avgAttendance: number | null;
  eligible: number;
  notEligible: number;
  avgSpi: number | null;
  skillDebt: number;
}

export interface DirectoryPage {
  rows: DirectoryRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  summary: DirectorySummary;
}

/** The filters as the server reads them; lists repeat their key (college=A&college=B). */
function query(f: Partial<DirectoryFilters>, extra: Record<string, string | number | undefined> = {}): string {
  const p = new URLSearchParams();
  for (const v of f.colleges ?? []) p.append("college", v);
  if (f.college && !(f.colleges ?? []).length) p.append("college", f.college);
  for (const v of f.batches ?? []) p.append("batch", v);
  for (const v of f.sections ?? []) p.append("sections", v);
  const single: Record<string, string | number | undefined> = {
    term: f.term,
    semester: f.semester,
    section: f.section,
    subject: f.subject,
    attMin: f.attMin === 0 ? undefined : f.attMin,
    attMax: f.attMax === 100 ? undefined : f.attMax,
    q: f.q,
    tier: f.tier,
    ...extra,
  };
  for (const [k, v] of Object.entries(single)) if (v !== undefined && v !== "") p.set(k, String(v));
  return p.toString();
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { credentials: "include" });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return (await res.json()) as T;
}

export const directoryApi = {
  options: () => getJson<DirectoryOptions>("/options"),
  page: (f: DirectoryFilters, o: { sort: string; dir: string; page: number; pageSize: number }) => getJson<DirectoryPage>(`/?${query(f, o)}`),
  /** A link the browser can follow: the server writes every row for these filters. */
  exportUrl: (f: DirectoryFilters, o: { sort: string; dir: string }) => `${API}/export?${query(f, o)}`,
};
