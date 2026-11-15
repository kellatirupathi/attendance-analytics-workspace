/**
 * Overview: types and API calls. The numbers come from /api/dashboard/directory/overview, which rolls up the saved
 * student reports, so every figure follows the report's own rules; the browser only displays them. The trend comes
 * from /api/dashboard/directory/overview/trend (day-level rows held on the server). Both take the Student Directory's
 * filters, so a filter means the same on both pages.
 */
import { directoryQuery, type DirectoryFilters } from "@/lib/directoryReport";

/** Quiz and Skill Assessment averages (simple average of course scores); null when nothing was held. */
export interface AssessmentAverages {
  classroom: number | null;
  module: number | null;
  skill: number | null;
}

export interface OverviewRank extends AssessmentAverages {
  name: string;
  college?: string;
  students: number;
  attendance: number | null;
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
    eligible: number;
    recovery: number;
    atRisk: number;
    ineligible: number;
    noSessions: number;
  };
  assessment: AssessmentAverages;
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

/** The Student Directory's filters this page uses (College, Batch, Semester; Section and Subject under More filters). */
export type OverviewFilters = Pick<DirectoryFilters, "colleges" | "batches" | "term" | "sections" | "subject">;
export const NO_OVERVIEW_FILTERS: OverviewFilters = { colleges: [], batches: [], term: "", sections: [], subject: "" };

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: "include" });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return (await res.json()) as T;
}

export const overviewApi = {
  data: (f: OverviewFilters) => getJson<OverviewData>(`/api/dashboard/directory/overview?${directoryQuery(f)}`),
  /** Weekly present ÷ held for the same filters; the date window applies to this chart only. */
  trend: (f: OverviewFilters, window: { dateFrom?: string; dateTo?: string }) =>
    getJson<{ points: TrendPoint[] }>(`/api/dashboard/directory/overview/trend?${directoryQuery(f, { dateFrom: window.dateFrom, dateTo: window.dateTo })}`),
};

/** The Student Directory, opened with this page's filters (and a tier or a search) from a card. */
export function directoryHref(f: Partial<OverviewFilters> & { tier?: string; q?: string } = {}): string {
  const p = new URLSearchParams();
  if (f.tier) p.set("tier", f.tier);
  if (f.colleges?.length) p.set("campuses", f.colleges.join("||"));
  if (f.batches?.length) p.set("batches", f.batches.join("||"));
  if (f.term) p.set("term", f.term);
  if (f.sections?.length) p.set("sections", f.sections.join("||"));
  if (f.subject) p.set("subject", f.subject);
  if (f.q) p.set("q", f.q);
  const qs = p.toString();
  return qs ? `/dashboard/students?${qs}` : "/dashboard/students";
}
