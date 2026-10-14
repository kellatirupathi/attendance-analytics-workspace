/* ------------------------------------------------------------------ */
/*  Assessment summary: page-side names for the generated API types   */
/*  of GET /api/dashboard/assessments/summary.                        */
/* ------------------------------------------------------------------ */
import type {
  AssessmentSummary,
  AssessmentSummaryMetrics,
  AssessmentSummaryRow,
  AssessmentSummarySemester,
} from "@workspace/api-client-react";

export type { AssessmentSummary };
export type SummaryMetrics = AssessmentSummaryMetrics;
export type SummaryRow = AssessmentSummaryRow;
export type SemesterMetrics = AssessmentSummarySemester;

export type SummaryType = "cq" | "mq";
export type SummaryGroupBy = "campus" | "subject" | "section" | "semester" | "student";
/** "current" (every current semester) or a derived semester label such as "Semester 1". */
export type SummarySemester = string;
