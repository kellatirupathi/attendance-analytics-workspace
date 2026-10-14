/* ------------------------------------------------------------------ */
/*  Assessment metrics: config, formulas and roll-ups.                */
/*  Every rate is built from raw counts — sum first, divide last.     */
/* ------------------------------------------------------------------ */

/** Completion bands. Change the thresholds here only. */
export const COMPLETION_BANDS = { good: 85, watch: 70 } as const;

export type CompletionBand = "good" | "watch" | "low";

export const BAND_LABEL: Record<CompletionBand, string> = { good: "Good", watch: "Watch", low: "Low" };

/** Text + background pairs that pass 4.5:1 on their own background. */
export const BAND_STYLE: Record<CompletionBand, { color: string; bg: string }> = {
  good: { color: "#166534", bg: "#DCFCE7" },
  watch: { color: "#92400E", bg: "#FEF3C7" },
  low: { color: "#991B1B", bg: "#FEE2E2" },
};

export function completionBand(pct: number | null | undefined): CompletionBand | null {
  if (pct == null) return null;
  if (pct >= COMPLETION_BANDS.good) return "good";
  if (pct >= COMPLETION_BANDS.watch) return "watch";
  return "low";
}

export type AssessmentTypeId = "cq" | "mq" | "skill" | "final";

export interface AssessmentTypeConfig {
  id: AssessmentTypeId;
  label: string;
  short: string;
  /** Share of the SPI score (policy weights, see lib/spiScore.ts). */
  spiWeight: number;
  locked?: boolean;
}

export const ASSESSMENT_TYPES: AssessmentTypeConfig[] = [
  { id: "cq", label: "Classroom quizzes", short: "Classroom quizzes", spiWeight: 10 },
  { id: "mq", label: "Module quizzes", short: "Module quizzes", spiWeight: 15 },
  { id: "skill", label: "Skill assessments", short: "Skill assessments", spiWeight: 25, locked: true },
  { id: "final", label: "Final skill assessment", short: "Final skill assessment", spiWeight: 50, locked: true },
];

/** Raw counts. Every rate below is derived from these, never stored. */
export interface AssessmentCountsRaw {
  /** Distinct assessments planned (all dates). */
  scheduled: number;
  /** Distinct scheduled assessments held: date passed, session completed or partially completed. */
  conducted: number;
  students: number;
  /** One slot per student per conducted assessment. */
  expectedAttempts: number;
  /** Slots with a submitted attempt (a submitted 0 counts). */
  attempted: number;
  /** Sum of score % over attempted slots (absent slots add 0). */
  scoreSum: number;
}

export interface AssessmentMetrics extends AssessmentCountsRaw {
  notAttempted: number;
  /** attempted ÷ expected × 100; null when nothing was conducted. */
  completionPct: number | null;
  /** score sum ÷ attempted; null when nobody attempted. */
  avgScoreAttempted: number | null;
  /** score sum ÷ expected (absent = 0); null when nothing was conducted. */
  overallScore: number | null;
  /** conducted ÷ scheduled × 100; null when nothing is scheduled. */
  conductedPct: number | null;
}

export const fmtInt = (n: number | null | undefined): string => (n == null ? "–" : n.toLocaleString("en-IN"));
export const fmtPct = (n: number | null | undefined): string => (n == null ? "–" : `${n.toFixed(1)}%`);
export const fmtScore = (n: number | null | undefined): string => (n == null ? "–" : n.toFixed(1));
