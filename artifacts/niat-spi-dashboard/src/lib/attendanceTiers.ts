/** Attendance eligibility tiers. Change these numbers in this file only. */

export const TIER_ELIGIBLE = 80;
export const TIER_RECOVERY = 60;
export const TIER_AT_RISK = 50;

export type AttendanceTierId =
  | "eligible"
  | "recovery"
  | "at_risk"
  | "ineligible";

export interface AttendanceTier {
  id: AttendanceTierId;
  label: string;
  hint: string;
  color: string;
  bg: string;
}

export const ATTENDANCE_TIERS: AttendanceTier[] = [
  {
    id: "eligible",
    label: "Eligible",
    hint: `≥${TIER_ELIGIBLE}%`,
    color: "#1E7F4F",
    bg: "#E7F5EE",
  },
  {
    id: "recovery",
    label: "Recovery eligible",
    hint: `${TIER_RECOVERY}–${TIER_ELIGIBLE - 1}%`,
    color: "#B45309",
    bg: "#FEF3E2",
  },
  {
    id: "at_risk",
    label: "At risk",
    hint: `${TIER_AT_RISK}–${TIER_RECOVERY - 1}%`,
    color: "#C2410C",
    bg: "#FFF4EC",
  },
  {
    id: "ineligible",
    label: "Ineligible",
    hint: `<${TIER_AT_RISK}%`,
    color: "#B91C1C",
    bg: "#FDECEC",
  },
];

export function getTier(pct: number): AttendanceTier {
  if (pct >= TIER_ELIGIBLE) return ATTENDANCE_TIERS[0]!;
  if (pct >= TIER_RECOVERY) return ATTENDANCE_TIERS[1]!;
  if (pct >= TIER_AT_RISK) return ATTENDANCE_TIERS[2]!;
  return ATTENDANCE_TIERS[3]!;
}

/**
 * Which attendance figure picks the header tier.
 * "overall" is attended / total. Switch to "lowest" to use the weakest course.
 */
export function eligibilityAttendancePct(
  overallPct: number,
  coursePcts: number[],
  mode: "overall" | "lowest" = "overall",
): number {
  if (mode === "lowest" && coursePcts.length > 0) {
    return Math.min(...coursePcts);
  }
  return overallPct;
}

/** Extra sessions in a row, with no further absences, to reach the eligible line. */
export function sessionsShortOfTarget(
  attended: number,
  total: number,
  targetPct = TIER_ELIGIBLE,
): number {
  const target = targetPct / 100;
  if (target >= 1) return attended >= total ? 0 : total;
  const extra = (target * total - attended) / (1 - target);
  if (extra <= 0) return 0;
  return Math.ceil(extra - 1e-9);
}
