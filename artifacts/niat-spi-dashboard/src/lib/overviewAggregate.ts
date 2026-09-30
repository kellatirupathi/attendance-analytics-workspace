/**
 * Overview roll-ups built from the same bulk payloads the detail pages load
 * (attendance-stats/detail, spi-record/detail, assessment-detail), so every
 * number here matches Student Attendance Stats, SPI Record and Assessments
 * for the same filters.
 */
import {
  aggregateAttendanceStats,
  type AttendanceClassRow,
  type AttendanceDetailRow,
  type AttendanceHeader,
  type AttendanceViewRow,
} from "./attendanceStatsAggregate";
import { aggregateSpiRecord, type SpiDetailRow } from "./spiRecordAggregate";
import {
  assessmentHeader,
  buildAssessmentRows,
  countsFromStudentWork,
  filterRoster,
  filterSlots,
  type AssessmentCounts,
  type AssessmentRosterRow,
  type AssessmentSlot,
} from "./assessmentAggregate";

/** Sections are `campus\tsection`, as on the detail pages. */
export interface OverviewFilters {
  campuses: string[];
  semesters: string[];
  sections: string[];
}

export type LeaderGrain = "campus" | "section" | "subject";

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function pct(part: number, whole: number): number | null {
  return whole > 0 ? round1((part / whole) * 100) : null;
}

/* ------------------------------------------------------------------ */
/*  Attendance                                                         */
/* ------------------------------------------------------------------ */

export interface SubjectAttendance {
  subject: string;
  students: number;
  present: number;
  scheduled: number;
  pct: number;
}

export interface AttendanceOverview {
  header: AttendanceHeader;
  byCampus: AttendanceViewRow[];
  bySection: AttendanceViewRow[];
  byStudent: AttendanceViewRow[];
  subjects: SubjectAttendance[];
}

export function attendanceOverview(
  students: AttendanceDetailRow[],
  classes: AttendanceClassRow[],
  filters: OverviewFilters,
): AttendanceOverview {
  const f = { ...filters, students: [] };
  const campus = aggregateAttendanceStats(students, classes, "university", f);
  const bySubjectCampus = aggregateAttendanceStats(students, classes, "university_subject", f).rows;
  const merged = new Map<string, SubjectAttendance>();
  for (const row of bySubjectCampus) {
    const name = row.subject ?? "";
    const item = merged.get(name) ?? { subject: name, students: 0, present: 0, scheduled: 0, pct: 0 };
    item.students += row.students;
    item.present += row.present;
    item.scheduled += row.scheduled;
    merged.set(name, item);
  }
  const subjects = [...merged.values()]
    .map((item) => ({ ...item, pct: pct(item.present, item.scheduled) ?? 0 }))
    .filter((item) => item.scheduled > 0)
    .sort((a, b) => a.pct - b.pct);
  return {
    header: campus.summary,
    byCampus: campus.rows,
    bySection: aggregateAttendanceStats(students, classes, "university_section", f).rows,
    byStudent: aggregateAttendanceStats(students, classes, "university_student", f).rows,
    subjects,
  };
}

/** Overall attendance % only — used for the previous-period comparison. */
export function attendancePctOnly(
  students: AttendanceDetailRow[],
  filters: OverviewFilters,
): number | null {
  return aggregateAttendanceStats(students, [], "university", { ...filters, students: [] }).summary.overallPct;
}

/* ------------------------------------------------------------------ */
/*  SPI                                                                */
/* ------------------------------------------------------------------ */

type SpiResult = ReturnType<typeof aggregateSpiRecord>;

export interface SpiOverview {
  summary: SpiResult["summary"];
  byCampus: SpiResult["rows"];
  bySection: SpiResult["rows"];
  byStudent: SpiResult["rows"];
}

export function spiOverview(rows: SpiDetailRow[], filters: OverviewFilters): SpiOverview {
  const campusSet = new Set(filters.campuses);
  const semesterSet = new Set(filters.semesters);
  const sectionSet = new Set(filters.sections);
  const filtered = rows.filter((row) => {
    if (campusSet.size && !campusSet.has(row.university)) return false;
    if (semesterSet.size && !semesterSet.has(row.semester)) return false;
    if (sectionSet.size && !sectionSet.has(`${row.university}\t${row.section}`)) return false;
    return true;
  });
  const bounds = { singleCampus: filters.campuses.length === 1 };
  return {
    summary: aggregateSpiRecord(filtered, "all", bounds).summary,
    byCampus: aggregateSpiRecord(filtered, "campus", bounds).rows,
    bySection: aggregateSpiRecord(filtered, "section", bounds).rows,
    byStudent: aggregateSpiRecord(filtered, "student", bounds).rows,
  };
}

/* ------------------------------------------------------------------ */
/*  Assessments                                                        */
/* ------------------------------------------------------------------ */

export interface AssessmentOverview {
  header: AssessmentCounts;
  byCampus: Map<string, AssessmentCounts>;
  bySection: Map<string, AssessmentCounts>;
  bySubject: Map<string, AssessmentCounts>;
}

function mergeCounts(rows: AssessmentCounts[]): AssessmentCounts {
  return countsFromStudentWork(rows);
}

export function assessmentOverview(
  slots: AssessmentSlot[],
  roster: AssessmentRosterRow[],
  filters: OverviewFilters,
): AssessmentOverview {
  const scoped = filterSlots(slots, filters);
  const scopedRoster = filterRoster(roster, filters);
  const byCampus = new Map<string, AssessmentCounts>();
  for (const row of buildAssessmentRows(scoped, scopedRoster, "campus")) byCampus.set(row.university, row.counts);
  const bySection = new Map<string, AssessmentCounts>();
  for (const row of buildAssessmentRows(scoped, scopedRoster, "section")) {
    bySection.set(`${row.university}\t${row.section ?? ""}`, row.counts);
  }
  const subjectGroups = new Map<string, AssessmentCounts[]>();
  for (const row of buildAssessmentRows(scoped, scopedRoster, "subject")) {
    const name = row.subject ?? "";
    const list = subjectGroups.get(name);
    if (list) list.push(row.counts);
    else subjectGroups.set(name, [row.counts]);
  }
  const bySubject = new Map<string, AssessmentCounts>();
  for (const [name, list] of subjectGroups) bySubject.set(name, mergeCounts(list));
  return { header: assessmentHeader(scoped), byCampus, bySection, bySubject };
}

/* ------------------------------------------------------------------ */
/*  Leaderboard                                                        */
/* ------------------------------------------------------------------ */

export interface LeaderRow {
  key: string;
  campus: string | null;
  section: string | null;
  subject: string | null;
  label: string;
  students: number;
  attendancePct: number | null;
  belowSixty: number;
  avgSpi: number | null;
  skillDebt: number | null;
  completionPct: number | null;
}

export function leaderboard(
  grain: LeaderGrain,
  att: AttendanceOverview | null,
  spi: SpiOverview | null,
  asm: AssessmentOverview | null,
): LeaderRow[] {
  const rows = new Map<string, LeaderRow>();
  const ensure = (key: string, seed: Partial<LeaderRow> & { label: string }): LeaderRow => {
    let row = rows.get(key);
    if (!row) {
      row = {
        key,
        campus: null,
        section: null,
        subject: null,
        students: 0,
        attendancePct: null,
        belowSixty: 0,
        avgSpi: null,
        skillDebt: null,
        completionPct: null,
        ...seed,
      };
      rows.set(key, row);
    }
    return row;
  };

  if (grain === "subject") {
    for (const item of att?.subjects ?? []) {
      const row = ensure(item.subject, { label: item.subject, subject: item.subject });
      row.students = item.students;
      row.attendancePct = item.pct;
    }
    for (const [name, counts] of asm?.bySubject ?? []) {
      if (!rows.has(name)) continue;
      rows.get(name)!.completionPct = counts.completionPct;
    }
    return [...rows.values()];
  }

  const attRows = grain === "campus" ? att?.byCampus ?? [] : att?.bySection ?? [];
  for (const item of attRows) {
    const key = grain === "campus" ? item.university : `${item.university}\t${item.section ?? ""}`;
    const row = ensure(key, {
      label: grain === "campus" ? item.university : item.section ?? "—",
      campus: item.university,
      section: grain === "section" ? item.section : null,
    });
    row.students = item.students;
    row.attendancePct = item.grainPct;
    row.belowSixty = item.atRisk + item.ineligible;
  }
  const spiRows = grain === "campus" ? spi?.byCampus ?? [] : spi?.bySection ?? [];
  for (const item of spiRows) {
    const key = grain === "campus" ? item.university ?? "" : `${item.university ?? ""}\t${item.section ?? ""}`;
    const row = ensure(key, {
      label: grain === "campus" ? item.university ?? "—" : item.section ?? "—",
      campus: item.university,
      section: grain === "section" ? item.section : null,
    });
    if (!row.students) row.students = item.students;
    row.avgSpi = item.avgSpi;
    row.skillDebt = item.skillDebt;
  }
  const asmRows = grain === "campus" ? asm?.byCampus : asm?.bySection;
  for (const [key, counts] of asmRows ?? []) {
    const row = rows.get(key);
    if (row) row.completionPct = counts.completionPct;
  }
  return [...rows.values()];
}

/* ------------------------------------------------------------------ */
/*  Watch list                                                         */
/* ------------------------------------------------------------------ */

export interface WatchStudent {
  studentId: string;
  studentName: string;
  campus: string;
  section: string | null;
  attendancePct: number | null;
  skillLevel: string | null;
  skillDebt: boolean;
}

/** Students below 60% attendance or in skill debt, lowest attendance first. */
export function watchList(
  att: AttendanceOverview | null,
  spi: SpiOverview | null,
  limit = 8,
): { rows: WatchStudent[]; total: number } {
  const people = new Map<string, WatchStudent>();
  for (const row of att?.byStudent ?? []) {
    if (!row.studentId) continue;
    people.set(`${row.university}\t${row.studentId}`, {
      studentId: row.studentId,
      studentName: row.studentName ?? "",
      campus: row.university,
      section: row.section,
      attendancePct: row.scheduled > 0 ? row.grainPct : null,
      skillLevel: null,
      skillDebt: false,
    });
  }
  for (const row of spi?.byStudent ?? []) {
    if (!row.studentId) continue;
    const key = `${row.university ?? ""}\t${row.studentId}`;
    const person = people.get(key) ?? {
      studentId: row.studentId,
      studentName: row.studentName ?? "",
      campus: row.university ?? "",
      section: row.section,
      attendancePct: row.attendancePct,
      skillLevel: null,
      skillDebt: false,
    };
    person.skillLevel = row.skillLevel;
    person.skillDebt = row.skillDebt > 0;
    people.set(key, person);
  }
  const flagged = [...people.values()]
    .filter((person) => (person.attendancePct != null && person.attendancePct < 60) || person.skillDebt)
    .sort((a, b) =>
      (a.attendancePct ?? 101) - (b.attendancePct ?? 101)
      || Number(b.skillDebt) - Number(a.skillDebt)
      || a.studentName.localeCompare(b.studentName),
    );
  return { rows: flagged.slice(0, limit), total: flagged.length };
}
