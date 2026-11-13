import { TIER_AT_RISK, TIER_ELIGIBLE, TIER_RECOVERY, attendancePct } from "./attendanceTiers";

export interface AttendanceDetailRow {
  university: string;
  /** Older payloads have no batch; read as "Unknown". */
  batch?: string;
  semester: string;
  /** The row's semester has ended (the batch is between semesters, or an earlier semester was picked). */
  ended?: boolean;
  subject: string | null;
  section: string;
  unit: string;
  studentId: string;
  studentName: string;
  present: number;
  scheduled: number;
}

export interface AttendanceClassRow {
  university: string;
  batch?: string;
  semester: string;
  ended?: boolean;
  subject: string | null;
  section: string;
  unit: string;
  sessions: number;
}

export type AttendanceViewGrain =
  | "university"
  | "university_batch"
  | "university_subject"
  | "university_section"
  | "university_unit"
  | "university_student";

export interface AttendanceViewRow {
  university: string;
  /** Batch-wise, section-wise and student-wise rows: the batch and the semester it is in. */
  batch: string | null;
  semester: string | null;
  /** That semester has ended. */
  ended: boolean;
  subject: string | null;
  section: string | null;
  unit: string | null;
  studentId: string | null;
  studentName: string | null;
  overallPct: number;
  grainPct: number;
  present: number;
  scheduled: number;
  /** Scheduled sessions for the whole campus; 0 means the campus has no session slots. */
  campusScheduled: number;
  sessions: number;
  students: number;
  absences: number;
  eligible: number;
  recoveryEligible: number;
  atRisk: number;
  ineligible: number;
  /** Student-wise rows: the lowest subject attendance, which sets the tier (as on the student report). */
  lowestPct: number | null;
  lowestSubject: string | null;
}

export interface AttendanceHeader {
  students: number;
  overallPct: number | null;
  eligible: number;
  recoveryEligible: number;
  atRisk: number;
  ineligible: number;
}

/** Attendance % cut to one decimal, so tier checks below are exact (see attendancePct). */
function pct(present: number, scheduled: number): number | null {
  return attendancePct(present, scheduled);
}

function namedSubject(subject: string | null): boolean {
  const name = (subject ?? "").trim();
  return name.length > 0 && name.toLowerCase() !== "null";
}

/** One student's sessions, overall and per subject. */
interface Tally {
  present: number;
  scheduled: number;
  subjects: Map<string, { present: number; scheduled: number }>;
}

function newTally(): Tally {
  return { present: 0, scheduled: 0, subjects: new Map() };
}

function addToTally(tally: Tally, row: { subject: string | null; present: number; scheduled: number }): void {
  tally.present += row.present;
  tally.scheduled += row.scheduled;
  if (!namedSubject(row.subject)) return;
  const name = row.subject!.trim();
  const subject = tally.subjects.get(name) ?? { present: 0, scheduled: 0 };
  subject.present += row.present;
  subject.scheduled += row.scheduled;
  tally.subjects.set(name, subject);
}

/**
 * The attendance that sets a student's tier, as on the student report: the lowest
 * subject attendance (policy: 80% in every course). Overall % only when no named
 * subject has sessions.
 */
function lowestSubject(tally: Tally): { pct: number | null; subject: string | null } {
  let low: { pct: number | null; subject: string | null } = { pct: null, subject: null };
  for (const [name, subject] of tally.subjects) {
    const rate = pct(subject.present, subject.scheduled);
    if (rate != null && (low.pct == null || rate < low.pct)) low = { pct: rate, subject: name };
  }
  return low.pct == null ? { pct: pct(tally.present, tally.scheduled), subject: null } : low;
}

/** A student's lowest course attendance from their saved report (semester view only). */
export interface ReportLowest {
  pct: number | null;
  subject: string | null;
}

type TierCounts = { eligible: number; recoveryEligible: number; atRisk: number; ineligible: number };

function countTier(counts: TierCounts, rate: number | null): void {
  if (rate == null) return;
  if (rate >= TIER_ELIGIBLE) counts.eligible += 1;
  else if (rate >= TIER_RECOVERY) counts.recoveryEligible += 1;
  else if (rate >= TIER_AT_RISK) counts.atRisk += 1;
  else counts.ineligible += 1;
}

export interface AttendanceFilters {
  campuses: string[];
  /** "college\tbatch" */
  batches?: string[];
  /** Running: semesters in progress; ended: batches between semesters. */
  status?: "running" | "ended";
  semesters: string[];
  sections: string[];
  students: string[];
  /** With subjects chosen, only those subjects' sessions count. */
  subjects?: string[];
}

export const batchOf = (row: { batch?: string }) => row.batch || "Unknown";

/**
 * The semester a group of rows is in: the one most of its students have (ties: the later title). A batch has
 * one semester, but a few students carry rows from a second one (a repeated course), and that must not split
 * the batch into two rows or move its label.
 */
function mainSemester(rows: { studentId: string; semester: string; ended?: boolean }[]): { semester: string; ended: boolean } {
  const bySemester = new Map<string, { students: Set<string>; ended: boolean }>();
  for (const row of rows) {
    const entry = bySemester.get(row.semester) ?? { students: new Set<string>(), ended: true };
    entry.students.add(row.studentId);
    if (!row.ended) entry.ended = false;
    bySemester.set(row.semester, entry);
  }
  let best: { semester: string; ended: boolean; n: number } | null = null;
  for (const [semester, entry] of bySemester) {
    const n = entry.students.size;
    if (!best || n > best.n || (n === best.n && semester.localeCompare(best.semester, undefined, { numeric: true }) > 0)) {
      best = { semester, ended: entry.ended, n };
    }
  }
  return best ? { semester: best.semester, ended: best.ended } : { semester: "", ended: false };
}

/** One class; the batch keeps the same section name in two batches apart. */
const stampOf = (row: { university: string; batch?: string; semester: string; section: string; subject: string | null; unit: string }) =>
  `${row.university}\t${batchOf(row)}\t${row.semester}\t${row.section}\t${row.subject ?? ""}\t${row.unit}`;

function passesBatch(
  row: { university: string; batch?: string; ended?: boolean },
  filters: Pick<AttendanceFilters, "batches" | "status">,
): boolean {
  if (filters.batches?.length && !filters.batches.includes(`${row.university}\t${batchOf(row)}`)) return false;
  if (filters.status === "running" && row.ended) return false;
  if (filters.status === "ended" && !row.ended) return false;
  return true;
}

function passesSubject(subject: string | null, subjects: string[] | undefined): boolean {
  if (!subjects?.length) return true;
  return subjects.includes((subject ?? "").trim());
}

function passesFilters(
  row: { university: string; batch?: string; ended?: boolean; semester: string; section: string; studentId: string; subject: string | null },
  filters: AttendanceFilters,
): boolean {
  if (!passesSubject(row.subject, filters.subjects)) return false;
  if (filters.campuses.length && !filters.campuses.includes(row.university)) return false;
  if (!passesBatch(row, filters)) return false;
  if (filters.semesters.length && !filters.semesters.includes(row.semester)) return false;
  if (filters.sections.length && !filters.sections.includes(`${row.university}\t${row.section}`)) return false;
  if (filters.students.length && !filters.students.includes(`${row.university}\t${row.studentId}`)) return false;
  return true;
}

export function aggregateAttendanceStats(
  students: AttendanceDetailRow[],
  classes: AttendanceClassRow[],
  grain: AttendanceViewGrain,
  filters: AttendanceFilters,
  /** Ids without hyphens. With it, a student's tier is the one on their report, unless subjects are filtered. */
  reportLowest?: Record<string, ReportLowest>,
): { summary: AttendanceHeader; rows: AttendanceViewRow[] } {
  const filtered = students.filter((row) => passesFilters(row, filters));
  const useReport = !!reportLowest && !filters.subjects?.length;
  /** Whole-student tiers come from the report when it has the student; per-subject rows use that subject. */
  const tierOf = (studentId: string, tally: Tally, wholeStudent: boolean) =>
    (useReport && wholeStudent ? reportLowest![studentId.replace(/-/g, "").toLowerCase()] : undefined) ?? lowestSubject(tally);
  const classSessions = new Map<string, number>();
  const studentStamps = new Set<string>();
  for (const row of filtered) studentStamps.add(stampOf(row));
  for (const row of classes) {
    if (!passesSubject(row.subject, filters.subjects)) continue;
    if (filters.campuses.length && !filters.campuses.includes(row.university)) continue;
    if (!passesBatch(row, filters)) continue;
    if (filters.semesters.length && !filters.semesters.includes(row.semester)) continue;
    if (filters.sections.length && !filters.sections.includes(`${row.university}\t${row.section}`)) continue;
    const stamp = stampOf(row);
    if (filters.students.length && !studentStamps.has(stamp)) continue;
    classSessions.set(stamp, row.sessions);
  }

  const people = new Map<string, Tally>();
  const campusTotals = new Map<string, { present: number; scheduled: number }>();
  for (const row of filtered) {
    const person = people.get(row.studentId) ?? newTally();
    addToTally(person, row);
    people.set(row.studentId, person);
    const campus = campusTotals.get(row.university) ?? { present: 0, scheduled: 0 };
    campus.present += row.present;
    campus.scheduled += row.scheduled;
    campusTotals.set(row.university, campus);
  }

  const summary: AttendanceHeader = {
    students: people.size,
    overallPct: pct(
      [...people.values()].reduce((sum, person) => sum + person.present, 0),
      [...people.values()].reduce((sum, person) => sum + person.scheduled, 0),
    ),
    eligible: 0,
    recoveryEligible: 0,
    atRisk: 0,
    ineligible: 0,
  };
  for (const [studentId, person] of people) countTier(summary, tierOf(studentId, person, true).pct);

  const buckets = new Map<string, AttendanceDetailRow[]>();
  const subjectGrain = grain === "university_subject" || grain === "university_unit";
  for (const row of filtered) {
    if (subjectGrain && !namedSubject(row.subject)) continue;
    const key = grain === "university_subject"
      ? `${row.university}\t${row.subject ?? ""}`
      : grain === "university_batch"
        ? `${row.university}\t${batchOf(row)}`
      : grain === "university_section"
        ? `${row.university}\t${batchOf(row)}\t${row.section}`
        : grain === "university_unit"
          ? `${row.university}\t${row.subject ?? ""}\t${row.unit}`
          : grain === "university_student"
            ? `${row.university}\t${row.studentId}`
            : row.university;
    const list = buckets.get(key);
    if (list) list.push(row);
    else buckets.set(key, [row]);
  }

  const rows = [...buckets.entries()].map(([, bucket]) => {
    const first = bucket[0]!;
    const members = new Map<string, Tally & { name: string }>();
    let present = 0;
    let scheduled = 0;
    for (const row of bucket) {
      present += row.present;
      scheduled += row.scheduled;
      const member = members.get(row.studentId) ?? { ...newTally(), name: row.studentName };
      if (row.studentName.length > member.name.length) member.name = row.studentName;
      addToTally(member, row);
      members.set(row.studentId, member);
    }
    const tiers: TierCounts = { eligible: 0, recoveryEligible: 0, atRisk: 0, ineligible: 0 };
    for (const [studentId, member] of members) countTier(tiers, tierOf(studentId, member, !subjectGrain).pct);
    const stamps = new Set<string>();
    for (const row of bucket) stamps.add(stampOf(row));
    let sessions = 0;
    for (const stamp of stamps) sessions += classSessions.get(stamp) ?? 0;
    const campus = campusTotals.get(first.university);
    const student = [...members.values()][0];
    const lowest = grain === "university_student" && student ? tierOf(first.studentId, student, true) : null;
    const withBatch = grain === "university_batch" || grain === "university_section" || grain === "university_student";
    const term = withBatch ? mainSemester(bucket) : null;
    return {
      university: first.university,
      batch: withBatch ? batchOf(first) : null,
      semester: term?.semester ?? null,
      ended: term?.ended ?? false,
      subject: grain === "university_subject" || grain === "university_unit" ? first.subject : null,
      section: grain === "university_section" ? first.section : grain === "university_student" ? first.section : null,
      unit: grain === "university_unit" ? first.unit : null,
      studentId: grain === "university_student" ? first.studentId : null,
      studentName: grain === "university_student" ? student?.name ?? first.studentName : null,
      overallPct: pct(campus?.present ?? 0, campus?.scheduled ?? 0) ?? 0,
      grainPct: pct(present, scheduled) ?? 0,
      present,
      scheduled,
      campusScheduled: campus?.scheduled ?? 0,
      sessions,
      students: members.size,
      absences: Math.max(scheduled - present, 0),
      ...tiers,
      lowestPct: lowest?.pct ?? null,
      lowestSubject: lowest?.subject ?? null,
    };
  }).sort((left, right) =>
    left.university.localeCompare(right.university)
    || (left.batch ?? "").localeCompare(right.batch ?? "", undefined, { numeric: true })
    || (left.subject ?? "").localeCompare(right.subject ?? "")
    || (left.section ?? "").localeCompare(right.section ?? "", undefined, { numeric: true })
    || (left.unit ?? "").localeCompare(right.unit ?? "")
    || (left.studentName ?? "").localeCompare(right.studentName ?? ""),
  );

  return { summary, rows };
}

