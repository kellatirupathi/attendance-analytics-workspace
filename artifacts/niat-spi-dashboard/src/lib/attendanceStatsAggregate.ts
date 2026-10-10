import { TIER_AT_RISK, TIER_ELIGIBLE, TIER_RECOVERY } from "./attendanceTiers";

export interface AttendanceDetailRow {
  university: string;
  semester: string;
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
  semester: string;
  subject: string | null;
  section: string;
  unit: string;
  sessions: number;
}

export type AttendanceViewGrain =
  | "university"
  | "university_subject"
  | "university_section"
  | "university_unit"
  | "university_student";

export interface AttendanceViewRow {
  university: string;
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
}

export interface AttendanceHeader {
  students: number;
  overallPct: number | null;
  eligible: number;
  recoveryEligible: number;
  atRisk: number;
  ineligible: number;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function pct(present: number, scheduled: number): number | null {
  if (scheduled <= 0) return null;
  return round1((present / scheduled) * 100);
}

function namedSubject(subject: string | null): boolean {
  const name = (subject ?? "").trim();
  return name.length > 0 && name.toLowerCase() !== "null";
}

export interface AttendanceFilters {
  campuses: string[];
  semesters: string[];
  sections: string[];
  students: string[];
  /** With subjects chosen, only those subjects' sessions count. */
  subjects?: string[];
}

function passesSubject(subject: string | null, subjects: string[] | undefined): boolean {
  if (!subjects?.length) return true;
  return subjects.includes((subject ?? "").trim());
}

function passesFilters(
  row: { university: string; semester: string; section: string; studentId: string; subject: string | null },
  filters: AttendanceFilters,
): boolean {
  if (!passesSubject(row.subject, filters.subjects)) return false;
  if (filters.campuses.length && !filters.campuses.includes(row.university)) return false;
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
): { summary: AttendanceHeader; rows: AttendanceViewRow[] } {
  const filtered = students.filter((row) => passesFilters(row, filters));
  const classSessions = new Map<string, number>();
  const studentStamps = new Set<string>();
  for (const row of filtered) {
    studentStamps.add(`${row.university}\t${row.semester}\t${row.section}\t${row.subject ?? ""}\t${row.unit}`);
  }
  for (const row of classes) {
    if (!passesSubject(row.subject, filters.subjects)) continue;
    if (filters.campuses.length && !filters.campuses.includes(row.university)) continue;
    if (filters.semesters.length && !filters.semesters.includes(row.semester)) continue;
    if (filters.sections.length && !filters.sections.includes(`${row.university}\t${row.section}`)) continue;
    const stamp = `${row.university}\t${row.semester}\t${row.section}\t${row.subject ?? ""}\t${row.unit}`;
    if (filters.students.length && !studentStamps.has(stamp)) continue;
    classSessions.set(stamp, row.sessions);
  }

  const people = new Map<string, { present: number; scheduled: number }>();
  const campusTotals = new Map<string, { present: number; scheduled: number }>();
  for (const row of filtered) {
    const person = people.get(row.studentId) ?? { present: 0, scheduled: 0 };
    person.present += row.present;
    person.scheduled += row.scheduled;
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
  for (const person of people.values()) {
    const rate = pct(person.present, person.scheduled);
    if (rate == null) continue;
    if (rate >= TIER_ELIGIBLE) summary.eligible += 1;
    else if (rate >= TIER_RECOVERY) summary.recoveryEligible += 1;
    else if (rate >= TIER_AT_RISK) summary.atRisk += 1;
    else summary.ineligible += 1;
  }

  const buckets = new Map<string, AttendanceDetailRow[]>();
  const subjectGrain = grain === "university_subject" || grain === "university_unit";
  for (const row of filtered) {
    if (subjectGrain && !namedSubject(row.subject)) continue;
    const key = grain === "university_subject"
      ? `${row.university}\t${row.subject ?? ""}`
      : grain === "university_section"
        ? `${row.university}\t${row.section}`
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
    const members = new Map<string, { name: string; present: number; scheduled: number }>();
    let present = 0;
    let scheduled = 0;
    for (const row of bucket) {
      present += row.present;
      scheduled += row.scheduled;
      const member = members.get(row.studentId) ?? { name: row.studentName, present: 0, scheduled: 0 };
      if (row.studentName.length > member.name.length) member.name = row.studentName;
      member.present += row.present;
      member.scheduled += row.scheduled;
      members.set(row.studentId, member);
    }
    let eligible = 0;
    let recoveryEligible = 0;
    let atRisk = 0;
    let ineligible = 0;
    for (const member of members.values()) {
      const rate = pct(member.present, member.scheduled);
      if (rate == null) continue;
      if (rate >= TIER_ELIGIBLE) eligible += 1;
      else if (rate >= TIER_RECOVERY) recoveryEligible += 1;
      else if (rate >= TIER_AT_RISK) atRisk += 1;
      else ineligible += 1;
    }
    const stamps = new Set<string>();
    for (const row of bucket) {
      stamps.add(`${row.university}\t${row.semester}\t${row.section}\t${row.subject ?? ""}\t${row.unit}`);
    }
    let sessions = 0;
    for (const stamp of stamps) sessions += classSessions.get(stamp) ?? 0;
    const campus = campusTotals.get(first.university);
    const student = [...members.values()][0];
    return {
      university: first.university,
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
      eligible,
      recoveryEligible,
      atRisk,
      ineligible,
    };
  }).sort((left, right) =>
    left.university.localeCompare(right.university)
    || (left.subject ?? "").localeCompare(right.subject ?? "")
    || (left.section ?? "").localeCompare(right.section ?? "", undefined, { numeric: true })
    || (left.unit ?? "").localeCompare(right.unit ?? "")
    || (left.studentName ?? "").localeCompare(right.studentName ?? ""),
  );

  return { summary, rows };
}
