/**
 * Overview attendance trend, worked out in memory from day-level rows (lib/overviewTrend.ts loads them once), so a
 * filter or period change never waits for BigQuery. The filters mean the same as on the Student Directory
 * (college, batch, running / ended, semester, section, subject, the user's own colleges and subjects).
 * Pure functions; no imports with side effects, so they can be tested on their own.
 */
import { plain, subjectSet, type DirectoryFilter } from "./directoryReportModel.js";

/** Sessions of one day for one college, batch, section, semester and subject. */
export interface TrendRow {
  /** YYYY-MM-DD */
  date: string;
  college: string;
  batch: string;
  /** Short section name, as on the Student Directory ("S-003"). */
  section: string;
  semester: string;
  subject: string;
  /** The row's semester has ended (a batch between semesters). */
  ended: boolean;
  present: number;
  scheduled: number;
}

export interface TrendPoint {
  /** Monday of the week, YYYY-MM-DD. */
  week: string;
  present: number;
  scheduled: number;
}

export type TrendFilter = Pick<DirectoryFilter, "scopeCampuses" | "scopeSubjects" | "college" | "colleges" | "batches" | "term" | "semester" | "section" | "sections" | "subject"> & {
  /** Inclusive YYYY-MM-DD bounds; both or neither. */
  dateFrom?: string;
  dateTo?: string;
};

/** Monday of the date's week (YYYY-MM-DD), as BigQuery's DATE_TRUNC(date, WEEK(MONDAY)). */
export function weekOf(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

export function trendRowMatches(r: TrendRow, f: TrendFilter, subjects: Set<string> | null): boolean {
  const scope = f.scopeCampuses ?? [];
  if (scope.length && !scope.some((c) => c.trim() === r.college)) return false;
  if (f.college && r.college !== f.college.trim()) return false;
  if (f.colleges?.length && !f.colleges.some((c) => c.trim() === r.college)) return false;
  if (f.batches?.length && !f.batches.includes(`${r.college}\t${r.batch}`)) return false;
  if (f.term === "running" && r.ended) return false;
  if (f.term === "ended" && !r.ended) return false;
  if (f.semester && r.semester !== f.semester.trim()) return false;
  if (f.section && r.section !== f.section.trim()) return false;
  if (f.sections?.length && !f.sections.includes(`${r.batch}\t${r.section}`) && !f.sections.includes(r.section)) return false;
  if (subjects && !subjects.has(plain(r.subject))) return false;
  if (f.dateFrom && r.date < f.dateFrom) return false;
  if (f.dateTo && r.date > f.dateTo) return false;
  return true;
}

/** Weekly present and scheduled sessions, oldest week first; weeks with nothing scheduled are left out. */
export function trendOf(rows: TrendRow[], f: TrendFilter): TrendPoint[] {
  const subjects = subjectSet(f);
  const by = new Map<string, TrendPoint>();
  for (const r of rows) {
    if (!trendRowMatches(r, f, subjects)) continue;
    const week = weekOf(r.date);
    const p = by.get(week);
    if (p) {
      p.present += r.present;
      p.scheduled += r.scheduled;
    } else by.set(week, { week, present: r.present, scheduled: r.scheduled });
  }
  return [...by.values()].filter((p) => p.scheduled > 0).sort((a, b) => a.week.localeCompare(b.week));
}
