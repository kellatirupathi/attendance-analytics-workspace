import type { AttendanceHeader } from "./attendanceStatsAggregate";
import type { AssessmentCounts } from "./assessmentAggregate";
import type { LeaderGrain, LeaderRow, SubjectAttendance, SpiOverview } from "./overviewAggregate";

export type InsightTone = "good" | "warn" | "bad" | "info";

export interface Insight {
  tone: InsightTone;
  text: string;
}

const GROUP_NOUN: Record<LeaderGrain, string> = {
  campus: "campus",
  section: "section",
  subject: "subject",
};

function fmtPct(value: number): string {
  return `${value.toFixed(1)}%`;
}

/** Plain-language findings from the numbers already on the page. */
export function buildInsights(input: {
  attendance: AttendanceHeader | null;
  previousPct: number | null;
  previousLabel: string | null;
  subjects: SubjectAttendance[];
  leaders: LeaderRow[];
  grain: LeaderGrain;
  spi: SpiOverview["summary"] | null;
  assessments: AssessmentCounts | null;
}): Insight[] {
  const out: Insight[] = [];
  const att = input.attendance;

  if (att?.overallPct != null && input.previousPct != null && input.previousLabel) {
    const delta = Math.round((att.overallPct - input.previousPct) * 10) / 10;
    if (Math.abs(delta) >= 0.5) {
      out.push({
        tone: delta > 0 ? "good" : "bad",
        text: `Attendance is ${fmtPct(att.overallPct)}, ${delta > 0 ? "up" : "down"} ${Math.abs(delta).toFixed(1)} pts vs ${input.previousLabel}.`,
      });
    } else {
      out.push({ tone: "info", text: `Attendance is steady at ${fmtPct(att.overallPct)} vs ${input.previousLabel}.` });
    }
  }

  if (att && att.students > 0) {
    const below = att.atRisk + att.ineligible;
    if (below > 0) {
      const share = Math.round((below / att.students) * 100);
      out.push({
        tone: share >= 20 ? "bad" : "warn",
        text: `${below.toLocaleString("en-IN")} students (${share}%) are below 60% attendance (${att.ineligible.toLocaleString("en-IN")} under 50%).`,
      });
    }
  }

  const ranked = input.leaders.filter((row) => row.attendancePct != null && row.students > 0);
  if (ranked.length > 1 && att?.overallPct != null) {
    const worst = ranked.reduce((a, b) => ((b.attendancePct ?? 0) < (a.attendancePct ?? 0) ? b : a));
    if ((worst.attendancePct ?? 0) < att.overallPct) {
      out.push({
        tone: (worst.attendancePct ?? 0) < 80 ? "bad" : "warn",
        text: `Lowest ${GROUP_NOUN[input.grain]}: ${worst.label} at ${fmtPct(worst.attendancePct!)} (overall ${fmtPct(att.overallPct)}).`,
      });
    }
  }

  if (input.grain !== "subject") {
    const lowSubject = input.subjects[0];
    if (lowSubject && lowSubject.pct < 80) {
      out.push({
        tone: "warn",
        text: `${lowSubject.subject} is the lowest subject at ${fmtPct(lowSubject.pct)}.`,
      });
    }
  }

  const debtRanked = input.leaders
    .filter((row) => (row.skillDebt ?? 0) > 0)
    .sort((a, b) => (b.skillDebt ?? 0) - (a.skillDebt ?? 0));
  const debtLeader = debtRanked.length > 1 && debtRanked[0]!.skillDebt! > debtRanked[1]!.skillDebt! ? debtRanked[0] : undefined;
  if (input.spi && input.spi.students > 0 && input.spi.skillDebt > 0) {
    const share = Math.round((input.spi.skillDebt / input.spi.students) * 100);
    const where = debtLeader ? `; the most are in ${debtLeader.label} (${debtLeader.skillDebt!.toLocaleString("en-IN")})` : "";
    out.push({
      tone: share >= 25 ? "bad" : "warn",
      text: `${share}% of evaluated students are in skill debt${where}.`,
    });
  }

  const asm = input.assessments;
  if (asm && asm.classroomStudentTotal > 0 && asm.moduleStudentTotal > 0) {
    const gap = Math.round((asm.classroomPct - asm.modulePct) * 10) / 10;
    if (Math.abs(gap) >= 10) {
      const [lowName, lowPct, highName, highPct] = gap > 0
        ? ["Module", asm.modulePct, "classroom", asm.classroomPct]
        : ["Classroom", asm.classroomPct, "module", asm.modulePct];
      out.push({
        tone: "warn",
        text: `${lowName}-quiz completion (${fmtPct(lowPct)}) trails ${highName} (${fmtPct(highPct)}) by ${Math.abs(gap).toFixed(1)} pts.`,
      });
    }
  }

  if (!out.length && att?.overallPct != null) {
    out.push({ tone: att.overallPct >= 80 ? "good" : "info", text: `Attendance is ${fmtPct(att.overallPct)} across the selected scope.` });
  }
  return out.slice(0, 5);
}
