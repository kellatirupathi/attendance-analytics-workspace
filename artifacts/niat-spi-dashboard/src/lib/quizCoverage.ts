/**
 * Assessments → Classroom Quiz tab: types, API calls and the colour bands.
 * The numbers come from /api/dashboard/assessments/quiz/*; the browser only displays them.
 */

export type QuizType = "CLASSROOM_QUIZ" | "MODULE_QUIZ";

export const QUIZ_LABEL: Record<QuizType, { name: string; short: string }> = {
  CLASSROOM_QUIZ: { name: "Classroom Quiz", short: "classroom quiz" },
  MODULE_QUIZ: { name: "Module Quiz", short: "module quiz" },
};

const API = "/api/dashboard/assessments/quiz";

/** One place for the colour thresholds (percent). A value at or above `green` is green, at or above `amber` is amber, else red. */
export const BANDS = {
  completion: { green: 40, amber: 25 },
  avg: { green: 80, amber: 60 },
  participation: { green: 90, amber: 75 },
} as const;

export type BandMetric = keyof typeof BANDS;
export type Band = "green" | "amber" | "red" | "none";

export function bandOf(metric: BandMetric, value: number | null): Band {
  if (value == null) return "none";
  const b = BANDS[metric];
  return value >= b.green ? "green" : value >= b.amber ? "amber" : "red";
}

export interface QuizFilters {
  college: string;
  section: string;
  category: string;
  subject: string;
}
export const NO_FILTERS: QuizFilters = { college: "", section: "", category: "", subject: "" };

export interface QuizKpis {
  available: number;
  scheduledSoFar: number;
  completionRate: number | null;
  avgScore: number | null;
  participants: number;
  students: number;
  participation: number | null;
  counts: { campus: number; student: number; studentSubject: number };
  asOf: string;
}

export interface QuizOptions {
  colleges: string[];
  sections: { college: string; section: string }[];
  categories: string[];
  subjects: { college: string; subject: string; category: string | null }[];
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

export interface Page<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface StudentPanel {
  uid: string;
  name: string | null;
  college: string;
  section: string;
  scheduled: number;
  completed: number;
  completionPct: number | null;
  avgScore: number | null;
  subjects: { subject: string; category: string | null; scheduled: number; completed: number; completionPct: number | null; avgScore: number | null }[];
}

export type DownloadView = "campus" | "student" | "student-subject";

function query(type: QuizType, f: Partial<QuizFilters>, extra: Record<string, string | number | undefined> = {}): string {
  const p = new URLSearchParams({ quizType: type });
  for (const [k, v] of Object.entries({ ...f, ...extra })) if (v !== undefined && v !== "") p.set(k, String(v));
  return p.toString();
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { credentials: "include" });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return (await res.json()) as T;
}

export const quizApi = {
  options: (type: QuizType) => getJson<QuizOptions>(`/options?${query(type, {})}`),
  kpis: (type: QuizType, f: QuizFilters) => getJson<QuizKpis>(`/kpis?${query(type, f)}`),
  campus: (type: QuizType, f: QuizFilters, o: { sort: string; dir: string; page: number; pageSize: number }) =>
    getJson<Page<CampusRow>>(`/campus?${query(type, f, o)}`),
  students: (type: QuizType, f: QuizFilters, o: { sort: string; dir: string; page: number; pageSize: number; q: string }) =>
    getJson<Page<StudentRow>>(`/students?${query(type, f, o)}`),
  student: (type: QuizType, uid: string) => getJson<StudentPanel>(`/student?${query(type, {}, { uid })}`),
  /** A link the browser can follow: the server streams every row for these filters. */
  downloadUrl: (type: QuizType, f: QuizFilters, view: DownloadView, format: "xlsx" | "csv", uid?: string) =>
    `${API}/download?${query(type, uid ? {} : f, { view, format, uid })}`,
};

/** "2026-10-28" → "28 Oct 2026". */
export function formatAsOf(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
