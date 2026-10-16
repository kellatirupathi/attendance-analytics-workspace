/**
 * The student SPI scorecard rules (NIAT-SPI Execution Plan v1.0, §3–§7). No database or
 * BigQuery imports, so the rules can be tested on their own (spiScorecard.test.ts).
 *
 * - Course score (Skill Track Score) = Classroom × 10% + Module × 15% + Skill × 25% + Final × 50%,
 *   using only the assessment types with data, re-scaled to 100. Skill Assessment and
 *   Final scores are not in the warehouse yet, so today it is (Classroom × 10 + Module × 15) ÷ 25.
 * - An assessment type below 50% earns no credit for it (§3.2 note).
 * - Course score → level and points (§3.2); SPI = Σ (points × course weight) ÷ Σ course weights (§3.3).
 *   Course weight = credits (config/course-credits.json). A course with no weight ("Not set") or
 *   weight 0 stays on the report but is left out of the SPI.
 * - Intro To NIAT (orientation, 0 credits) is left off the report.
 * - Attendance: at least 80% in every course (§4); only NIAT session slots count.
 */

const TARGET_PCT = 80;
const WEIGHTS = { classroom: 10, module: 15 } as const;

export type CriterionState = "met" | "not_met" | "not_available";
export type AttendanceTier = "eligible" | "recovery_eligible" | "at_risk" | "ineligible";
export type SkillLevel = "A+" | "A" | "B" | "C" | "D" | "F";
export type QuizKind = "classroom" | "module";

/** One student's quiz summary row (one row per course × quiz type). */
export interface StudentQuizCourseRow {
  semesterCourseTitle: string | null;
  courseTitle: string | null;
  kind: QuizKind;
  /** Quizzes held so far (total_scheduled_quizes); future quizzes are not counted. */
  conducted: number;
  /** Quizzes attempted, capped at the number held (same rule as the Assessments page). */
  attempted: number;
  /** Best-attempt average over the attempted quizzes; null when none were attempted. */
  avgAttemptedPct: number | null;
}

/** A quiz row as the BigQuery REST API returns it: every value is a string or null. */
export interface RawQuizCourseRow {
  semester_course_title: string | null;
  course_title: string | null;
  unit_type: string | null;
  conducted: string | null;
  attempted: string | null;
  avg_attempted: string | null;
}

/** derived_unit_type is CLASSROOM_QUIZ or MODULE_QUIZ; anything that is not a module quiz is a classroom quiz. */
export function quizKind(unitType: string | null | undefined): QuizKind {
  return (unitType ?? "").toUpperCase().includes("MODULE") ? "module" : "classroom";
}

export function toStudentQuizCourseRow(r: RawQuizCourseRow): StudentQuizCourseRow {
  return {
    semesterCourseTitle: r.semester_course_title,
    courseTitle: r.course_title,
    kind: quizKind(r.unit_type),
    conducted: Number(r.conducted) || 0,
    attempted: Number(r.attempted) || 0,
    avgAttemptedPct: r.avg_attempted == null ? null : Number(r.avg_attempted),
  };
}

export interface QuizPart {
  /** Score (%) over the quizzes held: best-attempt scores ÷ quizzes held, so a missed quiz counts as 0 (§4). */
  avgPct: number;
  attempted: number;
  /** Quizzes held so far. */
  total: number;
}

export interface ScorecardCourse {
  name: string;
  present: number;
  held: number;
  /** Present ÷ held, cut (not rounded) to one decimal; null when no sessions are recorded. */
  attendancePct: number | null;
  belowTarget: boolean;
  /** Sessions in a row, with no absences, to reach 80%. */
  sessionsNeeded: number;
  tier: AttendanceTier | null;
  classroom: QuizPart | null;
  module: QuizPart | null;
  /** Course score out of 100; null when the course has no assessment data yet. */
  courseScore: number | null;
  level: SkillLevel | null;
  points: number | null;
  /** Course weight = credits (§3.3); null when not set. 0 or null leaves the course out of the SPI. */
  weight: number | null;
  /** points × weight; null when the course is not in the SPI. */
  weightedPoints: number | null;
}

export interface SkillDebtCourse {
  name: string;
  weight: number | null;
  courseScore: number;
  level: SkillLevel;
  /** Assessment types scored below 50%, which earn no credit (§3.2 note). */
  lowParts: { kind: QuizKind; avgPct: number }[];
}

export type NextStep =
  | { kind: "attend_sessions"; course: string; sessions: number }
  | { kind: "pending_classroom"; count: number }
  | { kind: "pending_module"; count: number }
  | { kind: "attend_recovery" }
  | { kind: "final_assessment" }
  | { kind: "on_track" };

export interface StudentScorecard {
  studentId: string;
  studentName: string;
  /** Out of 10: Σ (points × weight) ÷ Σ weights over courses with a score and a weight; null when none. */
  spi: number | null;
  totalWeightedPoints: number;
  totalWeight: number;
  /** Courses counted in the SPI (a score and a weight above 0). */
  scoredCourses: number;
  attendance: {
    /** §7.4 SPI eligibility tier, from the weakest course (§4: ≥ 80% in every course); null when no sessions. */
    tier: AttendanceTier | null;
    /** All courses together: present ÷ held, the same figure as the Student Directory; null when no sessions. */
    overallPct: number | null;
    present: number;
    held: number;
    lowestPct: number | null;
    lowestCourse: string | null;
    coursesBelow: number;
    coursesWithSessions: number;
    state: CriterionState;
  };
  eligibility: {
    attendance: CriterionState;
    classroom: { state: CriterionState; attempted: number; total: number };
    module: { state: CriterionState; attempted: number; total: number };
    skillAssessment: CriterionState;
    finalAssessment: CriterionState;
  };
  skillDebt: SkillDebtCourse[];
  courses: ScorecardCourse[];
  nextSteps: NextStep[];
}

/** The parts of a student's course attendance the scorecard needs. */
export interface ScorecardSubject {
  subjectTitle: string;
  present: number;
  total: number;
  /** Course weight (credits); null or missing when not set. */
  weight?: number | null;
}

/** Orientation courses left off the student report (0 credits everywhere). Matched ignoring case and spacing. */
const REPORT_EXCLUDED_COURSES = new Set(["intro to niat", "introduction to niat"]);
const plainName = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");
export const onReport = (name: string) => !REPORT_EXCLUDED_COURSES.has(plainName(name));

export function levelFor(score: number): { level: SkillLevel; points: number } {
  if (score >= 90) return { level: "A+", points: 10 };
  if (score >= 80) return { level: "A", points: 9 };
  if (score >= 70) return { level: "B", points: 8 };
  if (score >= 60) return { level: "C", points: 7 };
  if (score >= 50) return { level: "D", points: 6 };
  return { level: "F", points: 0 };
}

function tierFor(pct: number): AttendanceTier {
  if (pct >= 80) return "eligible";
  if (pct >= 60) return "recovery_eligible";
  if (pct >= 50) return "at_risk";
  return "ineligible";
}

/** Cut (not round) to one decimal so 79.96% never shows as 80.0%. */
function cutPct(present: number, held: number): number {
  return Math.floor((present * 1000) / held) / 10;
}

export function sessionsNeeded(present: number, held: number, targetPct = TARGET_PCT): number {
  const target = targetPct / 100;
  const extra = (target * held - present) / (1 - target);
  return extra <= 0 ? 0 : Math.ceil(extra - 1e-9);
}

const credit = (pct: number) => (pct >= 50 ? pct : 0);
const round2 = (n: number) => Math.round(n * 100) / 100;
const courseKey = (name: string) => name.trim().toLowerCase();

function namedCourse(name: string | null | undefined): name is string {
  const trimmed = (name ?? "").trim();
  return trimmed.length > 0 && trimmed.toLowerCase() !== "null";
}

/**
 * Quiz rows store the course in `semester_course_title` or `course_title` (classroom and module
 * quizzes differ). Rows that match none of the student's current courses are left out, which also
 * keeps other semesters' quizzes off the card. A quiz type with no quizzes held yet has no part, so
 * it is left out of the course score instead of counting as 0.
 */
export function groupQuizzes(
  rows: StudentQuizCourseRow[],
  kind: QuizKind,
  courseKeys: Set<string>,
): Map<string, QuizPart> {
  const sums = new Map<string, { held: number; attempted: number; score: number }>();
  for (const row of rows) {
    if (row.kind !== kind) continue;
    const key = [row.semesterCourseTitle, row.courseTitle]
      .filter(namedCourse)
      .map(courseKey)
      .find((candidate) => courseKeys.has(candidate));
    if (!key) continue;
    const sum = sums.get(key) ?? { held: 0, attempted: 0, score: 0 };
    sum.held += row.conducted;
    sum.attempted += row.attempted;
    sum.score += row.attempted > 0 ? (row.avgAttemptedPct ?? 0) * row.attempted : 0;
    sums.set(key, sum);
  }
  const parts = new Map<string, QuizPart>();
  for (const [key, sum] of sums) {
    if (sum.held <= 0) continue;
    parts.set(key, {
      avgPct: Math.round((sum.score / sum.held) * 10) / 10,
      attempted: sum.attempted,
      total: sum.held,
    });
  }
  return parts;
}

function participation(parts: (QuizPart | null)[]): { state: CriterionState; attempted: number; total: number } {
  const attempted = parts.reduce((sum, p) => sum + (p?.attempted ?? 0), 0);
  const total = parts.reduce((sum, p) => sum + (p?.total ?? 0), 0);
  const state: CriterionState = total === 0 ? "not_available" : attempted >= total ? "met" : "not_met";
  return { state, attempted, total };
}

export function buildScorecard(
  student: { studentId: string; studentName: string },
  subjects: ScorecardSubject[],
  quizRows: StudentQuizCourseRow[],
): StudentScorecard {
  const named = subjects.filter((s) => namedCourse(s.subjectTitle) && onReport(s.subjectTitle));
  const keys = new Set(named.map((s) => courseKey(s.subjectTitle)));
  const classroomBy = groupQuizzes(quizRows, "classroom", keys);
  const moduleBy = groupQuizzes(quizRows, "module", keys);

  const courses: ScorecardCourse[] = named.map((s) => {
    const key = courseKey(s.subjectTitle);
    const classroom = classroomBy.get(key) ?? null;
    const module = moduleBy.get(key) ?? null;

    let sum = 0;
    let weight = 0;
    if (classroom) {
      sum += credit(classroom.avgPct) * WEIGHTS.classroom;
      weight += WEIGHTS.classroom;
    }
    if (module) {
      sum += credit(module.avgPct) * WEIGHTS.module;
      weight += WEIGHTS.module;
    }
    const courseScore = weight > 0 ? round2(sum / weight) : null;
    const graded = courseScore == null ? null : levelFor(courseScore);

    const held = s.total;
    const attendancePct = held > 0 ? cutPct(s.present, held) : null;
    // Compare the exact ratio, not the cut %, so 79.96% is below target.
    const belowTarget = held > 0 && (s.present / held) * 100 < TARGET_PCT;
    const courseWeight = s.weight ?? null;
    const inSpi = graded != null && courseWeight != null && courseWeight > 0;
    return {
      name: s.subjectTitle.trim(),
      present: s.present,
      held,
      attendancePct,
      belowTarget,
      sessionsNeeded: belowTarget ? sessionsNeeded(s.present, held) : 0,
      tier: attendancePct == null ? null : tierFor(attendancePct),
      classroom,
      module,
      courseScore,
      level: graded?.level ?? null,
      points: graded?.points ?? null,
      weight: courseWeight,
      weightedPoints: inSpi ? graded.points * courseWeight : null,
    };
  });

  // §3.3: SPI = Σ (level points × course weight) ÷ Σ course weights, over courses with a score and a weight.
  const scored = courses.filter((c) => c.weightedPoints != null);
  const totalWeightedPoints = scored.reduce((sum, c) => sum + (c.weightedPoints ?? 0), 0);
  const totalWeight = scored.reduce((sum, c) => sum + (c.weight ?? 0), 0);
  const spi = totalWeight > 0 ? round2(totalWeightedPoints / totalWeight) : null;

  const withSessions = courses.filter((c) => c.attendancePct != null);
  const below = courses.filter((c) => c.belowTarget);
  const present = courses.reduce((sum, c) => sum + c.present, 0);
  const held = courses.reduce((sum, c) => sum + c.held, 0);
  const lowest = withSessions.reduce<ScorecardCourse | null>(
    (low, c) => (low == null || (c.attendancePct ?? 0) < (low.attendancePct ?? 0) ? c : low),
    null,
  );
  const attendanceState: CriterionState =
    withSessions.length === 0 ? "not_available" : below.length > 0 ? "not_met" : "met";

  const classroom = participation(courses.map((c) => c.classroom));
  const module = participation(courses.map((c) => c.module));

  const nextSteps: NextStep[] = [];
  for (const c of below) nextSteps.push({ kind: "attend_sessions", course: c.name, sessions: c.sessionsNeeded });
  if (classroom.state === "not_met") nextSteps.push({ kind: "pending_classroom", count: classroom.total - classroom.attempted });
  if (module.state === "not_met") nextSteps.push({ kind: "pending_module", count: module.total - module.attempted });
  if (below.length > 0) nextSteps.push({ kind: "attend_recovery" });
  nextSteps.push({ kind: "final_assessment" });
  if (nextSteps.length === 1) nextSteps.unshift({ kind: "on_track" });

  return {
    studentId: student.studentId,
    studentName: student.studentName,
    spi,
    totalWeightedPoints,
    totalWeight,
    scoredCourses: scored.length,
    attendance: {
      tier: lowest?.attendancePct == null ? null : tierFor(lowest.attendancePct),
      overallPct: held > 0 ? cutPct(present, held) : null,
      present,
      held,
      lowestPct: lowest?.attendancePct ?? null,
      lowestCourse: lowest?.name ?? null,
      coursesBelow: below.length,
      coursesWithSessions: withSessions.length,
      state: attendanceState,
    },
    eligibility: {
      attendance: attendanceState,
      classroom,
      module,
      skillAssessment: "not_available",
      finalAssessment: "not_available",
    },
    skillDebt: courses
      .filter((c) => c.level === "F")
      .map((c) => ({
        name: c.name,
        weight: c.weight,
        courseScore: c.courseScore ?? 0,
        level: "F" as const,
        lowParts: [
          ...(c.classroom && c.classroom.avgPct < 50 ? [{ kind: "classroom" as const, avgPct: c.classroom.avgPct }] : []),
          ...(c.module && c.module.avgPct < 50 ? [{ kind: "module" as const, avgPct: c.module.avgPct }] : []),
        ],
      })),
    courses,
    nextSteps: nextSteps.slice(0, 4),
  };
}
