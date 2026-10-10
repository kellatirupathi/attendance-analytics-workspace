/**
 * Student Directory rows, filters and sorting, built from the spi-record/detail
 * payload so SPI, skill level and attendance match SPI Record and the Overview.
 */
import { attendancePct, getTier, TIER_ELIGIBLE, TIER_RECOVERY, type AttendanceTierId } from "./attendanceTiers";
import { skillLevelOf, spiPointsOf, type SpiDetailRow } from "./spiRecordAggregate";

export interface DirectoryRow {
  key: string;
  studentId: string;
  studentName: string;
  campus: string;
  semesters: string[];
  sections: string[];
  present: number;
  scheduled: number;
  attendancePct: number | null;
  tier: AttendanceTierId | null;
  classroom: number | null;
  module: number | null;
  spi: number;
  skill: string;
  skillDebt: boolean;
}

export type QuizFilter = "" | "missing_classroom" | "missing_module" | "missing_both";
export type BoundOp = "" | "gte" | "lte" | "between";

export interface DirectoryFilters {
  search: string;
  campuses: string[];
  semesters: string[];
  /** `campus\tsection` */
  sections: string[];
  tiers: AttendanceTierId[];
  spiOp: BoundOp;
  spiA: string;
  spiB: string;
  attOp: BoundOp;
  attA: string;
  attB: string;
  quiz: QuizFilter;
}

export type SortKey =
  | "name"
  | "studentId"
  | "campus"
  | "section"
  | "semester"
  | "attendance"
  | "classroom"
  | "module"
  | "spi"
  | "skill";

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function compactId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** One row per student and campus. Quiz values are per student, attendance per campus. */
export function buildDirectoryRows(detail: SpiDetailRow[]): DirectoryRow[] {
  const byKey = new Map<string, DirectoryRow>();
  for (const row of detail) {
    const key = `${row.university}\t${row.studentId}`;
    let item = byKey.get(key);
    if (!item) {
      const pct = attendancePct(row.presentN, row.scheduledN);
      const skill = skillLevelOf(row.classroomAvg, row.moduleAvg);
      item = {
        key,
        studentId: row.studentId,
        studentName: row.studentName,
        campus: row.university,
        semesters: [],
        sections: [],
        present: row.presentN,
        scheduled: row.scheduledN,
        attendancePct: pct,
        tier: pct == null ? null : getTier(pct).id,
        classroom: row.classroomAvg == null ? null : round1(row.classroomAvg),
        module: row.moduleAvg == null ? null : round1(row.moduleAvg),
        // Unrounded so SPI bounds match SPI Record; round only for display.
        spi: spiPointsOf(row.classroomAvg, row.moduleAvg),
        skill,
        skillDebt: skill === "F" || skill === "Ab",
      };
      byKey.set(key, item);
    }
    if (row.studentName.length > item.studentName.length) item.studentName = row.studentName;
    if (!item.semesters.includes(row.semester)) item.semesters.push(row.semester);
    if (!item.sections.includes(row.section)) item.sections.push(row.section);
  }
  return [...byKey.values()];
}

/** Parses a bound clamped to 0–`ceiling`; blank or non-numeric input means "no filter". */
export function parseBound(op: BoundOp, a: string, b: string, ceiling: number): { min: number; max: number } | null {
  const num = (value: string) => {
    if (!value.trim()) return null;
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(ceiling, Math.max(0, n)) : null;
  };
  const first = num(a);
  if (!op || first == null) return null;
  if (op === "gte") return { min: first, max: Infinity };
  if (op === "lte") return { min: -Infinity, max: first };
  const second = num(b);
  if (second == null) return null;
  return { min: Math.min(first, second), max: Math.max(first, second) };
}

export function filterDirectory(rows: DirectoryRow[], filters: DirectoryFilters): DirectoryRow[] {
  const campusSet = new Set(filters.campuses);
  const semesterSet = new Set(filters.semesters);
  const sectionSet = new Set(filters.sections);
  const tierSet = new Set(filters.tiers);
  const spiBound = parseBound(filters.spiOp, filters.spiA, filters.spiB, 10);
  const attBound = parseBound(filters.attOp, filters.attA, filters.attB, 100);
  const text = filters.search.trim().toLowerCase();
  const idText = compactId(text);

  return rows.filter((row) => {
    if (campusSet.size && !campusSet.has(row.campus)) return false;
    if (semesterSet.size && !row.semesters.some((name) => semesterSet.has(name))) return false;
    if (sectionSet.size && !row.sections.some((name) => sectionSet.has(`${row.campus}\t${name}`))) return false;
    if (tierSet.size && (row.tier == null || !tierSet.has(row.tier))) return false;
    if (spiBound && (row.spi < spiBound.min || row.spi > spiBound.max)) return false;
    if (attBound && (row.attendancePct == null || row.attendancePct < attBound.min || row.attendancePct > attBound.max)) return false;
    if (filters.quiz === "missing_classroom" && row.classroom != null) return false;
    if (filters.quiz === "missing_module" && row.module != null) return false;
    if (filters.quiz === "missing_both" && (row.classroom != null || row.module != null)) return false;
    if (text) {
      const nameHit = row.studentName.toLowerCase().includes(text);
      const idHit = idText.length > 0 && compactId(row.studentId).includes(idText);
      if (!nameHit && !idHit) return false;
    }
    return true;
  });
}

const SKILL_RANK: Record<string, number> = { "A+": 6, A: 5, B: 4, C: 3, D: 2, F: 1, Ab: 0 };

/** Sorts a copy. Missing values always go last. */
export function sortDirectory(rows: DirectoryRow[], key: SortKey, dir: 1 | -1): DirectoryRow[] {
  const text = (row: DirectoryRow): string => {
    if (key === "name") return row.studentName;
    if (key === "studentId") return row.studentId;
    if (key === "campus") return row.campus;
    if (key === "section") return row.sections.join(", ");
    return row.semesters.join(", ");
  };
  const num = (row: DirectoryRow): number | null => {
    if (key === "attendance") return row.attendancePct;
    if (key === "classroom") return row.classroom;
    if (key === "module") return row.module;
    if (key === "spi") return row.spi;
    return SKILL_RANK[row.skill] ?? null;
  };
  const numeric = !["name", "studentId", "campus", "section", "semester"].includes(key);
  return rows.slice().sort((a, b) => {
    if (!numeric) {
      return text(a).localeCompare(text(b), undefined, { numeric: true, sensitivity: "base" }) * dir
        || a.studentName.localeCompare(b.studentName);
    }
    const av = num(a);
    const bv = num(b);
    if (av == null && bv == null) return a.studentName.localeCompare(b.studentName);
    if (av == null) return 1;
    if (bv == null) return -1;
    return (av - bv) * dir || a.studentName.localeCompare(b.studentName);
  });
}

export interface DirectorySummary {
  students: number;
  avgAttendance: number | null;
  eligible: number;
  belowSixty: number;
  avgSpi: number | null;
  skillDebt: number;
}

/** Counts distinct students (not student × campus rows), the same way SPI Record and Attendance Stats do. */
export function summarizeDirectory(rows: DirectoryRow[]): DirectorySummary {
  const people = new Map<string, { present: number; scheduled: number; spi: number; skillDebt: boolean }>();
  for (const row of rows) {
    const person = people.get(row.studentId) ?? { present: 0, scheduled: 0, spi: row.spi, skillDebt: row.skillDebt };
    person.present += row.present;
    person.scheduled += row.scheduled;
    people.set(row.studentId, person);
  }
  let present = 0;
  let scheduled = 0;
  let spiSum = 0;
  let eligible = 0;
  let belowSixty = 0;
  let skillDebt = 0;
  for (const person of people.values()) {
    if (person.scheduled > 0) {
      const pct = attendancePct(person.present, person.scheduled)!;
      present += person.present;
      scheduled += person.scheduled;
      if (pct >= TIER_ELIGIBLE) eligible += 1;
      if (pct < TIER_RECOVERY) belowSixty += 1;
    }
    spiSum += person.spi;
    if (person.skillDebt) skillDebt += 1;
  }
  return {
    students: people.size,
    // Sessions attended ÷ sessions scheduled across all students, as on the Overview.
    avgAttendance: attendancePct(present, scheduled),
    eligible,
    belowSixty,
    avgSpi: people.size ? round1(spiSum / people.size) : null,
    skillDebt,
  };
}
