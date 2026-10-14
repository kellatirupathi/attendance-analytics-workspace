import type { SpiDetailRow } from "./spiRecordAggregate.js";

/**
 * Filters, filter choices and the student picker for the SPI Record page,
 * worked out on the server so the page can be sent one table page at a time.
 * Same rules the page used to apply in the browser.
 */

export interface SpiViewFilters {
  campuses: string[];
  semesters: string[];
  /** "campus\tsection" */
  sections: string[];
  /** "campus\tstudentId" */
  students: string[];
}

export function filterSpiDetail(rows: SpiDetailRow[], filters: SpiViewFilters): SpiDetailRow[] {
  const campusSet = new Set(filters.campuses);
  const semesterSet = new Set(filters.semesters);
  const sectionSet = new Set(filters.sections);
  const studentSet = new Set(filters.students);
  return rows.filter((row) => {
    if (campusSet.size && !campusSet.has(row.university)) return false;
    if (semesterSet.size && !semesterSet.has(row.semester)) return false;
    if (sectionSet.size && !sectionSet.has(`${row.university}\t${row.section}`)) return false;
    if (studentSet.size && !studentSet.has(`${row.university}\t${row.studentId}`)) return false;
    return true;
  });
}

export interface SpiFilterOptions {
  campuses: string[];
  semesters: string[];
  sections: { campus: string; section: string }[];
}

/** Campuses from every row; semesters within the chosen campuses; sections only once a campus is chosen. */
export function spiFilterOptions(rows: SpiDetailRow[], filters: Pick<SpiViewFilters, "campuses" | "semesters">): SpiFilterOptions {
  const campusSet = new Set(filters.campuses);
  const semesterSet = new Set(filters.semesters);
  const campuses = new Set<string>();
  const semesters = new Set<string>();
  const sections = new Map<string, { campus: string; section: string }>();
  for (const row of rows) {
    campuses.add(row.university);
    if (campusSet.size && !campusSet.has(row.university)) continue;
    semesters.add(row.semester);
    if (!campusSet.size) continue;
    if (semesterSet.size && !semesterSet.has(row.semester)) continue;
    const key = `${row.university}\t${row.section}`;
    if (!sections.has(key)) sections.set(key, { campus: row.university, section: row.section });
  }
  return {
    campuses: [...campuses].sort((left, right) => left.localeCompare(right)),
    semesters: [...semesters].sort((left, right) => left.localeCompare(right, undefined, { numeric: true })),
    sections: [...sections.values()].sort((left, right) =>
      left.section.localeCompare(right.section, undefined, { numeric: true })),
  };
}

export interface SpiStudentHit {
  studentId: string;
  studentName: string;
  campus: string;
  section: string;
}

/** Up to `limit` students whose name or id contains `text`, within the campus / semester / section filters. */
export function searchSpiDetailStudents(
  rows: SpiDetailRow[],
  filters: Pick<SpiViewFilters, "campuses" | "semesters" | "sections">,
  text: string,
  limit = 20,
): SpiStudentHit[] {
  const q = text.trim().toLowerCase();
  if (q.length < 2) return [];
  const byStudent = new Map<string, SpiStudentHit>();
  for (const row of filterSpiDetail(rows, { ...filters, students: [] })) {
    const key = `${row.university}\t${row.studentId}`;
    const existing = byStudent.get(key);
    if (!existing || row.studentName.length > existing.studentName.length) {
      byStudent.set(key, { studentId: row.studentId, studentName: row.studentName, campus: row.university, section: row.section });
    }
  }
  const hits: SpiStudentHit[] = [];
  for (const hit of byStudent.values()) {
    if (hit.studentName.toLowerCase().includes(q) || hit.studentId.toLowerCase().includes(q)) {
      hits.push(hit);
      if (hits.length >= limit) break;
    }
  }
  return hits;
}
