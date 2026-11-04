/**
 * Student Directory: types and API calls. The numbers come from /api/dashboard/directory (the saved student
 * reports), so they match the report; the browser only displays them.
 */

const API = "/api/dashboard/directory";

export interface DirectoryFilters {
  college: string;
  semester: string;
  section: string;
  subject: string;
  attMin: number;
  attMax: number;
  q: string;
}
export const NO_DIRECTORY_FILTERS: DirectoryFilters = { college: "", semester: "", section: "", subject: "", attMin: 0, attMax: 100, q: "" };

export type QuizTypeFilter = "" | "classroom" | "module" | "skill";

export interface DirectoryOptions {
  colleges: string[];
  semesters: string[];
  sections: { college: string; semester: string | null; section: string }[];
  subjects: string[];
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

function query(f: DirectoryFilters, extra: Record<string, string | number | undefined> = {}): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...f, ...extra })) {
    if (v === undefined || v === "") continue;
    if ((k === "attMin" && v === 0) || (k === "attMax" && v === 100)) continue;
    p.set(k, String(v));
  }
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
