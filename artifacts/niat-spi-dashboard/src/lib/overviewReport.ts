/**
 * Overview: types and API calls. The numbers come from /api/dashboard/directory/overview, which rolls up the saved
 * student reports, so every figure follows the report's own rules; the browser only displays them.
 */
import type { DirectoryFilters } from "@/lib/directoryReport";

export interface OverviewRank {
  name: string;
  college?: string;
  students: number;
  attendance: number | null;
  spi: number | null;
  score: number | null;
  debt: number;
}

export interface OverviewAttentionRow {
  studentId: string;
  name: string | null;
  college: string;
  section: string;
  attendancePct: number | null;
}

export interface OverviewData {
  summary: {
    students: number;
    avgAttendance: number | null;
    avgSpi: number | null;
    eligible: number;
    recovery: number;
    atRisk: number;
    ineligible: number;
    noSessions: number;
    skillDebt: number;
  };
  assessment: { classroom: number | null; module: number | null; skill: number | null };
  spiBins: { label: string; count: number }[];
  colleges: OverviewRank[];
  sections: OverviewRank[];
  subjects: OverviewRank[];
  attention: { atRisk: { total: number; rows: OverviewAttentionRow[] }; ineligible: { total: number; rows: OverviewAttentionRow[] } };
}

export interface TrendPoint {
  week: string;
  present: number;
  scheduled: number;
}

export type OverviewFilters = Pick<DirectoryFilters, "college" | "semester" | "section" | "subject">;
export const NO_OVERVIEW_FILTERS: OverviewFilters = { college: "", semester: "", section: "", subject: "" };

function query(f: OverviewFilters): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v) p.set(k, v);
  return p.toString();
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: "include" });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return (await res.json()) as T;
}

export const overviewApi = {
  data: (f: OverviewFilters) => getJson<OverviewData>(`/api/dashboard/directory/overview?${query(f)}`),
  /** Weekly present ÷ scheduled, the same endpoint the attendance pages use; the date window applies to this chart only. */
  trend: (f: OverviewFilters, window: { dateFrom?: string; dateTo?: string }, scopeCampus: string) => {
    const p = new URLSearchParams();
    const college = f.college || scopeCampus;
    if (college) p.set("campuses", college);
    if (f.semester) p.set("semesters", f.semester);
    if (college && f.section) p.set("sections", `${college}\t${f.section}`);
    if (f.subject) p.set("subjects", f.subject);
    if (window.dateFrom && window.dateTo) {
      p.set("dateFrom", window.dateFrom);
      p.set("dateTo", window.dateTo);
    }
    return getJson<{ points: TrendPoint[] }>(`/api/dashboard/attendance-stats/trend?${p.toString()}`);
  },
};

/** The Student Directory, opened on a tier (and a college) from a card. */
export function directoryHref(extra: { tier?: string; college?: string; semester?: string; q?: string } = {}): string {
  const p = new URLSearchParams();
  if (extra.tier) p.set("tier", extra.tier);
  if (extra.college) p.set("campuses", extra.college);
  if (extra.semester) p.set("semesters", extra.semester);
  if (extra.q) p.set("q", extra.q);
  const qs = p.toString();
  return qs ? `/dashboard/students?${qs}` : "/dashboard/students";
}
