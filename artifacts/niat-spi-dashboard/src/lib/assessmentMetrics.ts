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

export type AssessmentTypeId = "cq" | "mq" | "all" | "skill" | "final";

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
  { id: "all", label: "CQ + MQ", short: "Classroom + module quizzes", spiWeight: 25 },
  { id: "skill", label: "Skill assessments", short: "Skill assessments", spiWeight: 25, locked: true },
  { id: "final", label: "Final skill assessment", short: "Final skill assessment", spiWeight: 50, locked: true },
];

/** Course weights (credits) by subject. No data source yet, so they live here. */
export const COURSE_WEIGHTS: Record<string, number> = {
  "Back End Development": 4,
  "Design and Analysis of Algorithms": 4,
  "AI for Finance": 4,
  "Probability and Statistics": 3,
  "Logical Reasoning": 3,
  "Applied Communicative English": 3,
  "Statistical Computing Lab": 1,
};

export function courseWeight(subject: string): number | null {
  return COURSE_WEIGHTS[subject.trim()] ?? null;
}

/** Raw counts. Every rate below is derived from these, never stored. */
export interface AssessmentCountsRaw {
  /** Distinct assessments planned (all dates). */
  scheduled: number;
  /** Distinct scheduled assessments whose date has passed. */
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

export const ZERO_COUNTS: AssessmentCountsRaw = {
  scheduled: 0,
  conducted: 0,
  students: 0,
  expectedAttempts: 0,
  attempted: 0,
  scoreSum: 0,
};

const ratio = (num: number, den: number, scale = 1): number | null => (den > 0 ? (num / den) * scale : null);

export function finishMetrics(raw: AssessmentCountsRaw): AssessmentMetrics {
  return {
    ...raw,
    notAttempted: Math.max(0, raw.expectedAttempts - raw.attempted),
    completionPct: ratio(raw.attempted, raw.expectedAttempts, 100),
    avgScoreAttempted: ratio(raw.scoreSum, raw.attempted),
    overallScore: ratio(raw.scoreSum, raw.expectedAttempts),
    conductedPct: ratio(raw.conducted, raw.scheduled, 100),
  };
}

/**
 * Roll up rows by adding raw counts, then derive rates once.
 * Students and assessment counts are distinct counts, so the caller passes
 * them when they cannot be summed (e.g. the same quiz across campuses).
 */
export function rollUp(
  rows: AssessmentCountsRaw[],
  distinct: Partial<Pick<AssessmentCountsRaw, "scheduled" | "conducted" | "students">> = {},
): AssessmentMetrics {
  const sum = rows.reduce<AssessmentCountsRaw>(
    (acc, r) => ({
      scheduled: acc.scheduled + r.scheduled,
      conducted: acc.conducted + r.conducted,
      students: acc.students + r.students,
      expectedAttempts: acc.expectedAttempts + r.expectedAttempts,
      attempted: acc.attempted + r.attempted,
      scoreSum: acc.scoreSum + r.scoreSum,
    }),
    { ...ZERO_COUNTS },
  );
  return finishMetrics({ ...sum, ...distinct });
}

export const fmtInt = (n: number | null | undefined): string => (n == null ? "–" : n.toLocaleString("en-IN"));
export const fmtPct = (n: number | null | undefined): string => (n == null ? "–" : `${n.toFixed(1)}%`);
export const fmtScore = (n: number | null | undefined): string => (n == null ? "–" : n.toFixed(1));
