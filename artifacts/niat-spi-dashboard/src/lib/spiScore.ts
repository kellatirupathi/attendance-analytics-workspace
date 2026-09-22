/**
 * SPI score from available quiz averages (policy weights).
 *
 * Weights: Classroom 10% · Module 15% · Skill Assessments 25% · Final 50%.
 * Skill Assessments and Final are not in dashboard student payloads yet, so
 * they contribute 0 until those fields exist. Missing classroom/module also
 * count as 0. Always divide by full weight 100 (do not renormalize).
 *
 * Matches the student SPI report ring in pages/SpiReport.tsx.
 */
export function computeSpiScore(
  classroomAvg: number | null | undefined,
  moduleAvg: number | null | undefined,
  skillAvg: number | null | undefined = null,
  finalAvg: number | null | undefined = null,
): { spiPct: number; points: number } {
  const classroom = classroomAvg ?? 0;
  const module = moduleAvg ?? 0;
  const skill = skillAvg ?? 0;
  const final = finalAvg ?? 0;
  const spiPct =
    (classroom * 10 + module * 15 + skill * 25 + final * 50) / 100;
  return { spiPct, points: spiPct / 10 };
}

/** Attendance standing used on Reports (SPI Record / Insights). */
export type AttendanceStanding = "good" | "recovery" | "at_risk";

export function attendanceStanding(
  attendancePct: number,
): AttendanceStanding {
  if (attendancePct >= 80) return "good";
  if (attendancePct >= 60) return "recovery";
  return "at_risk";
}

export function standingLabel(standing: AttendanceStanding): string {
  switch (standing) {
    case "good":
      return "Good";
    case "recovery":
      return "Recovery";
    case "at_risk":
      return "At Risk";
  }
}
