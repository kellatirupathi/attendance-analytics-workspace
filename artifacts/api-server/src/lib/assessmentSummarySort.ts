import type { SummaryRow } from "./queries.js";

/**
 * Sort values for each Assessments table column, by column key. Mirrors the
 * `sortValue` of each column in niat-spi-dashboard/src/components/assessments/AssessmentTable.tsx;
 * keep the two in step so the server sorts the way the table header says.
 */
const SORT_VALUE: Record<string, (row: SummaryRow) => string | number | null> = {
  name: (row) => row.name ?? "",
  campus: (row) => row.campus ?? "",
  section: (row) => row.section ?? "",
  semester: (row) => row.semester ?? "",
  batch: (row) => row.batch ?? "",
  dates: (row) => row.startDate ?? "",
  studentId: (row) => row.studentId ?? "",
  campuses: (row) => row.campuses,
  students: (row) => row.students,
  conducted: (row) => row.conducted,
  studentConducted: (row) => row.expectedAttempts,
  expected: (row) => row.expectedAttempts,
  attempted: (row) => row.attempted,
  notAttempted: (row) => row.notAttempted,
  completion: (row) => row.completionPct,
  avg: (row) => row.avgScoreAttempted,
  overall: (row) => row.overallScore,
};

export const DEFAULT_ASSESSMENT_SORT = "completion";

/** Blanks last; numbers numerically; text in natural order. */
function compare(a: string | number | null, b: string | number | null): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

/** Sorts a copy by a table column key (unknown keys sort by name), ties broken by name. */
export function sortSummaryRows(rows: SummaryRow[], key: string, dir: 1 | -1): SummaryRow[] {
  const get = SORT_VALUE[key] ?? SORT_VALUE["name"]!;
  return rows.slice().sort((a, b) => compare(get(a), get(b)) * dir || a.name.localeCompare(b.name));
}
