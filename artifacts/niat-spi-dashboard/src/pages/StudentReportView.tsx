import type { ReactNode } from "react";
import { ATTENDANCE_SCOPE_NOTE } from "@/components/PageHeader";

/* ------------------------------------------------------------------ */
/*  Data shape: GET /api/attendance/students/:id/scorecard            */
/*  (built in api-server/src/lib/spiScorecard.ts; this page only shows it) */
/* ------------------------------------------------------------------ */
export type CriterionState = "met" | "not_met" | "not_available";
type AttendanceTier = "eligible" | "recovery_eligible" | "at_risk" | "ineligible";
type SkillLevel = "A+" | "A" | "B" | "C" | "D" | "F";

interface QuizPart {
  avgPct: number;
  attempted: number;
  total: number;
}

interface ScorecardCourse {
  name: string;
  present: number;
  held: number;
  attendancePct: number | null;
  belowTarget: boolean;
  sessionsNeeded: number;
  tier: AttendanceTier | null;
  classroom: QuizPart | null;
  module: QuizPart | null;
  courseScore: number | null;
  level: SkillLevel | null;
  points: number | null;
}

type NextStep =
  | { kind: "attend_sessions"; course: string; sessions: number }
  | { kind: "pending_classroom"; count: number }
  | { kind: "pending_module"; count: number }
  | { kind: "attend_recovery" }
  | { kind: "final_assessment" }
  | { kind: "on_track" };

export interface StudentScorecard {
  studentId: string;
  studentName: string;
  spi: number | null;
  totalPoints: number;
  scoredCourses: number;
  attendance: {
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
  skillDebtCourses: string[];
  courses: ScorecardCourse[];
  nextSteps: NextStep[];
}

/* ------------------------------------------------------------------ */
/*  Small helpers                                                     */
/* ------------------------------------------------------------------ */
const pct1 = (n: number) => `${n.toFixed(1)}%`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const TIER_LABEL: Record<AttendanceTier, string> = {
  eligible: "Eligible",
  recovery_eligible: "Recovery Eligible",
  at_risk: "At Risk",
  ineligible: "Ineligible",
};

const LEVEL_STYLE: Record<SkillLevel, string> = {
  "A+": "bg-[#DCFCE7] text-[#15803D]",
  A: "bg-[#DCFCE7] text-[#15803D]",
  B: "bg-[#DBEAFE] text-[#1D4ED8]",
  C: "bg-[#FFEDD5] text-[#C2410C]",
  D: "bg-[#FEF3C7] text-[#B45309]",
  F: "bg-[#FEE2E2] text-[#B91C1C]",
};

function Card({ className = "", children }: { className?: string; children: ReactNode }) {
  return (
    <section
      className={`rounded-[14px] border border-[#E2E8F0] bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:px-[18px] ${className}`}
    >
      {children}
    </section>
  );
}

function CardTitle({ icon, iconBg, children }: { icon?: string; iconBg?: string; children: ReactNode }) {
  return (
    <h2 className="mb-2.5 flex items-center gap-2 text-[13px] font-bold text-[#0F172A]">
      {icon && (
        <span
          className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-md text-xs font-extrabold text-white"
          style={{ backgroundColor: iconBg }}
          aria-hidden
        >
          {icon}
        </span>
      )}
      {children}
    </h2>
  );
}

function Pill({ tone, children }: { tone: "ok" | "warn" | "bad" | "wait"; children: ReactNode }) {
  const style = {
    ok: "bg-[#DCFCE7] text-[#15803D]",
    warn: "bg-[#FEF3C7] text-[#B45309]",
    bad: "bg-[#FEE2E2] text-[#B91C1C]",
    wait: "bg-[#EEF2FF] text-[#4338CA]",
  }[tone];
  return (
    <span className={`inline-block rounded-full px-3 py-1 text-[11px] font-bold tracking-[0.04em] ${style}`}>
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Top row                                                           */
/* ------------------------------------------------------------------ */
function SpiGauge({ spi }: { spi: number | null }) {
  const fill = spi == null ? 0 : Math.max(0, Math.min(10, spi)) * 10;
  return (
    <div className="relative mx-auto mt-0.5 h-[112px] w-[190px]">
      <svg width="190" height="112" viewBox="0 0 190 112" aria-hidden>
        <path d="M 15 100 A 80 80 0 0 1 175 100" fill="none" stroke="#E2E8F0" strokeWidth="16" strokeLinecap="round" />
        {spi != null && (
          <path
            d="M 15 100 A 80 80 0 0 1 175 100"
            fill="none"
            stroke="#2563EB"
            strokeWidth="16"
            strokeLinecap="round"
            pathLength={100}
            strokeDasharray={`${fill} 100`}
          />
        )}
      </svg>
      <p className="absolute inset-x-0 bottom-1 text-center text-[32px] font-extrabold tabular-nums text-[#0F172A]">
        {spi == null ? "—" : spi.toFixed(2)}{" "}
        <small className="text-base font-semibold text-[#64748B]">/ 10</small>
      </p>
    </div>
  );
}

function SpiCard({ data }: { data: StudentScorecard }) {
  const e = data.eligibility;
  // Until every eligibility rule is met (Skill Assessment and Final included), the SPI is provisional.
  const provisional = [e.attendance, e.classroom.state, e.module.state, e.skillAssessment, e.finalAssessment].some((state) => state !== "met");
  return (
    <Card className="text-center">
      <h2 className="mb-2.5 text-[13px] font-bold text-[#0F172A]">SPI Score</h2>
      <SpiGauge spi={data.spi} />
      {(data.spi == null || data.attendance.coursesBelow > 0) && (
        <div className="mt-2 flex flex-wrap justify-center gap-1.5">
          {data.spi == null ? <Pill tone="wait">NO SCORES YET</Pill> : <Pill tone="wait">RECOVERY MODE</Pill>}
        </div>
      )}
      {provisional && (
        <p className="mt-3 text-[11.5px] leading-snug text-[#64748B]">
          <span className="font-semibold text-[#B45309]">Provisional.</span> SPI counts only once every eligibility rule is met.
        </p>
      )}
    </Card>
  );
}

/**
 * Eligibility needs 80% in every course, so the headline is the lowest course's
 * attendance. The text says that, and names the courses that need attention.
 */
function AttendanceCard({ data }: { data: StudentScorecard }) {
  const a = data.attendance;
  const n = a.coursesWithSessions;
  const below = data.courses.filter((c) => c.belowTarget && c.attendancePct != null);
  return (
    <Card>
      <CardTitle icon="▦" iconBg="#7C3AED">Attendance</CardTitle>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[#64748B]">Lowest course attendance</p>
      <p className="mt-0.5 text-[34px] font-extrabold tabular-nums text-[#0F172A]">
        {a.lowestPct == null ? "—" : pct1(a.lowestPct)}
      </p>
      <div className="mt-1 text-xs leading-relaxed text-[#64748B]">
        {a.lowestCourse == null || a.lowestPct == null ? (
          <p>No sessions recorded yet.</p>
        ) : below.length === 0 ? (
          <>
            <p>Each course needs at least 80% attendance.</p>
            <p className="font-medium text-[#15803D]">
              {a.lowestPct >= 100
                ? `100% attendance in all ${plural(n, "course", "courses")}.`
                : `All ${plural(n, "course", "courses")} at or above 80%.`}
            </p>
            {a.lowestPct < 100 && (
              <p>
                Lowest: {a.lowestCourse} at {pct1(a.lowestPct)}.
              </p>
            )}
          </>
        ) : (
          <>
            <p>Each course needs at least 80% attendance.</p>
            <p className="font-medium text-[#B91C1C]">
              {below.length} of {plural(n, "course", "courses")} below 80%:
            </p>
            <ul className="mt-0.5 space-y-0.5">
              {below.map((c) => (
                <li key={c.name}>
                  {c.name} · <span className="font-semibold tabular-nums text-[#B91C1C]">{pct1(c.attendancePct!)}</span>
                  {c.sessionsNeeded > 0 && ` · attend the next ${plural(c.sessionsNeeded, "session", "sessions")}`}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      <div className="mt-2.5">
        {a.state === "met" ? <Pill tone="ok">✓ MET</Pill> : a.state === "not_met" ? <Pill tone="bad">NOT MET</Pill> : <Pill tone="wait">NOT AVAILABLE</Pill>}
      </div>
      <p className="mt-3 rounded-lg bg-[#F1F5FB] px-2.5 py-1.5 text-[11.5px] font-medium text-[#0F2A5C]">
        {ATTENDANCE_SCOPE_NOTE}
      </p>
    </Card>
  );
}

function StateDot({ state }: { state: CriterionState }) {
  const style = state === "met" ? "bg-[#22C55E]" : state === "not_met" ? "bg-[#EF4444]" : "bg-[#94A3B8]";
  const mark = state === "met" ? "✓" : state === "not_met" ? "!" : "–";
  return (
    <span className={`mt-px grid h-[18px] w-[18px] place-items-center rounded-full text-[11px] font-extrabold text-white ${style}`} aria-hidden>
      {mark}
    </span>
  );
}

function EligibilityCard({ data }: { data: StudentScorecard }) {
  const e = data.eligibility;
  const share = (p: { attempted: number; total: number }) =>
    p.total > 0 ? `${Math.round((p.attempted / p.total) * 100)}%` : null;
  const notAvailable = (
    <span className="whitespace-nowrap rounded-full bg-[#EEF2FF] px-2 py-0.5 text-[10px] font-bold text-[#4338CA]">NOT AVAILABLE YET</span>
  );
  const rows: { title: string; detail: string; state: CriterionState; value: ReactNode }[] = [
    {
      title: "Attendance",
      detail:
        data.attendance.coursesBelow > 0
          ? `≥ 80% per course · ${data.attendance.coursesBelow} below 80%`
          : "≥ 80% per course",
      state: e.attendance,
      value: data.attendance.lowestPct == null ? "—" : pct1(data.attendance.lowestPct),
    },
    {
      title: "Classroom Quizzes",
      detail: e.classroom.total > 0 ? `100% participation · ${e.classroom.attempted} / ${e.classroom.total} attempted` : "100% participation · no quizzes yet",
      state: e.classroom.state,
      value: share(e.classroom) ?? "—",
    },
    {
      title: "Module Quizzes",
      detail: e.module.total > 0 ? `100% completion · ${e.module.attempted} / ${e.module.total} completed` : "100% completion · no quizzes yet",
      state: e.module.state,
      value: share(e.module) ?? "—",
    },
    { title: "Skill Assessments", detail: "100% participation · data not available yet", state: e.skillAssessment, value: notAvailable },
    { title: "Final Skill Assessment", detail: "Mandatory · data not available yet", state: e.finalAssessment, value: notAvailable },
  ];
  return (
    <Card>
      <CardTitle icon="✓" iconBg="#2563EB">Eligibility criteria</CardTitle>
      <ul className="grid gap-2.5">
        {rows.map((row) => (
          <li key={row.title} className="grid grid-cols-[20px_1fr_auto] items-start gap-2 text-xs">
            <StateDot state={row.state} />
            <span>
              <b className="block font-semibold text-[#0F172A]">{row.title}</b>
              <span className="text-[11px] text-[#64748B]">{row.detail}</span>
            </span>
            <span className="font-bold tabular-nums text-[#0F172A]">{row.value}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function SkillDebtCard({ data }: { data: StudentScorecard }) {
  const active = data.skillDebtCourses.length > 0;
  return (
    <Card className={active ? "!border-[#FECACA] !bg-[#FEF2F2]" : "!border-[#BBF7D0] !bg-[#F0FDF4]"}>
      <CardTitle icon={active ? "!" : "✓"} iconBg={active ? "#DC2626" : "#16A34A"}>
        Skill Debt
      </CardTitle>
      <p className={`mt-1 text-[34px] font-extrabold ${active ? "text-[#B91C1C]" : "text-[#15803D]"}`}>
        {active ? plural(data.skillDebtCourses.length, "course", "courses") : "None"}
      </p>
      {active && <p className="mt-1 text-xs font-semibold text-[#B91C1C]">{data.skillDebtCourses.join(", ")}</p>}
      <p className="mt-1 text-xs leading-relaxed text-[#64748B]">
        An F or Ab grade in any course creates a Skill Debt and pauses MINT, BRAVE, GRIT, placements and internships.
      </p>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Attendance alert                                                  */
/* ------------------------------------------------------------------ */
function AttendanceAlert({ courses }: { courses: ScorecardCourse[] }) {
  const below = courses.filter((c) => c.belowTarget);
  if (below.length === 0) return null;
  return (
    <section className="grid grid-cols-[30px_1fr] items-center gap-3 rounded-[14px] border border-[#FDBA74] bg-[#FFF7ED] px-[18px] py-3 text-[#7C2D12] lg:grid-cols-[30px_1fr_auto]">
      <span className="text-2xl text-[#EA580C]" aria-hidden>⚠</span>
      <div>
        <h2 className="text-[15px] font-bold text-[#EA580C]">
          Attendance below 80%.{" "}
          <span className="text-[13.5px] font-medium text-[#7C2D12]">Attend live sessions to reach 80% and stay eligible.</span>
        </h2>
        <p className="mt-0.5 text-xs">
          Only NIAT course sessions count towards attendance. Skipping assigned recovery classes turns the course into a Skill Debt.
        </p>
      </div>
      <div className="col-span-2 flex flex-wrap gap-2 lg:col-span-1">
        {below.map((c) => (
          <div key={c.name} className="rounded-[10px] border border-[#FED7AA] bg-white px-3 py-1.5 text-xs tabular-nums">
            <b className="block text-[#EA580C]">
              {c.name} · {c.attendancePct == null ? "—" : pct1(c.attendancePct)}
            </b>
            {c.present} / {c.held} sessions · attend the next {c.sessionsNeeded} without missing any
          </div>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Course table                                                      */
/* ------------------------------------------------------------------ */
const notAvailableCell = <span className="text-[11.5px] italic text-[#94A3B8]">Not available yet</span>;
const notConductedCell = <span className="text-[11.5px] italic text-[#94A3B8]">Not conducted yet</span>;

function QuizCell({ part }: { part: QuizPart | null }) {
  if (!part) return notConductedCell;
  const missed = part.attempted < part.total;
  return (
    <>
      {part.avgPct}%
      {missed && (
        <span className="block text-[10.5px] font-bold text-[#B91C1C]">
          ⚑ {part.attempted} of {part.total} attempted
        </span>
      )}
    </>
  );
}

function CourseTable({ data }: { data: StudentScorecard }) {
  const th = "border-l border-[#2B4B86] bg-[#1E3A70] px-2.5 py-2 text-center text-[11px] font-semibold leading-tight text-white";
  const sub = "block text-[10px] font-medium text-[#AFC4EA]";
  return (
    <section className="overflow-hidden rounded-[14px] border border-[#E2E8F0] bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 bg-[#0F2A5C] px-[18px] py-3 text-white">
        <h2 className="text-[15px] font-bold">Course-wise performance</h2>
        <span className="text-xs text-[#BFD3F5]">Assessment scores are the student's average score (%) in each assessment type</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] border-collapse text-[12.5px]">
          <thead>
            <tr>
              <th colSpan={3} className="bg-[#17305F]" />
              <th colSpan={4} className="border-l border-[#2B4B86] bg-[#17305F] px-2.5 py-2 text-[11px] font-semibold tracking-[0.03em] text-white">
                Assessment scores (average %)
              </th>
              <th colSpan={3} className="border-l border-[#2B4B86] bg-[#17305F] px-2.5 py-2 text-[11px] font-semibold tracking-[0.03em] text-white">
                SPI calculation
              </th>
            </tr>
            <tr>
              <th className={`${th} !border-l-0 !text-left`}>#</th>
              <th className={`${th} !text-left`}>Course</th>
              <th className={th}>Attendance</th>
              <th className={th}>Classroom Quizzes<span className={sub}>10%</span></th>
              <th className={th}>Module Quizzes<span className={sub}>15%</span></th>
              <th className={th}>Skill Assessments<span className={sub}>25%</span></th>
              <th className={th}>Final Skill Assessment<span className={sub}>50%</span></th>
              <th className={th}>Skill Track Score<span className={sub}>out of 100</span></th>
              <th className={th}>Skill Level</th>
              <th className={th}>Level Points<span className={sub}>out of 10</span></th>
            </tr>
          </thead>
          <tbody>
            {data.courses.map((c, i) => (
              <tr key={c.name} className="tabular-nums even:bg-[#F8FAFD]">
                <td className="border-b border-[#E2E8F0] px-2.5 py-2 text-[#64748B]">{i + 1}</td>
                <td className="border-b border-[#E2E8F0] px-2.5 py-2 font-medium text-[#0F172A]">{c.name}</td>
                <td className="border-b border-[#E2E8F0] px-2.5 py-2 text-center">
                  {c.attendancePct == null ? (
                    <span className="text-[11.5px] italic text-[#94A3B8]">Not started</span>
                  ) : c.belowTarget ? (
                    <>
                      <span className="font-bold text-[#B91C1C]">{pct1(c.attendancePct)}</span>
                      {c.tier && (
                        <span className="ml-1.5 inline-block rounded-full bg-[#FEF3C7] px-[7px] py-px text-[10px] font-bold text-[#B45309]">
                          {TIER_LABEL[c.tier]}
                        </span>
                      )}
                    </>
                  ) : (
                    pct1(c.attendancePct)
                  )}
                </td>
                <td className="border-b border-[#E2E8F0] px-2.5 py-2 text-center"><QuizCell part={c.classroom} /></td>
                <td className="border-b border-[#E2E8F0] px-2.5 py-2 text-center"><QuizCell part={c.module} /></td>
                <td className="border-b border-[#E2E8F0] px-2.5 py-2 text-center">{notAvailableCell}</td>
                <td className="border-b border-[#E2E8F0] px-2.5 py-2 text-center">{notAvailableCell}</td>
                <td className="border-b border-[#E2E8F0] px-2.5 py-2 text-center font-bold text-[#0F172A]">
                  {c.courseScore == null ? "—" : c.courseScore.toFixed(2)}
                </td>
                <td className="border-b border-[#E2E8F0] px-2.5 py-2 text-center">
                  {c.level ? (
                    <span className={`inline-block min-w-8 rounded-md px-1.5 py-0.5 text-xs font-extrabold ${LEVEL_STYLE[c.level]}`}>{c.level}</span>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="border-b border-[#E2E8F0] px-2.5 py-2 text-center font-bold text-[#0F172A]">{c.points ?? "—"}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="tabular-nums">
              <td colSpan={9} className="bg-[#EAF1FB] px-2.5 py-2.5 text-right font-semibold text-[#334155]">
                Total Level Points ({plural(data.scoredCourses, "course", "courses")})
              </td>
              <td className="bg-[#EAF1FB] px-2.5 py-2.5 text-center font-bold text-[#0F172A]">{data.totalPoints}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="px-[18px] pb-2.5 pt-2 text-[11px] text-[#64748B]">
        Attendance is calculated on NIAT course sessions only. Quiz scores cover the quizzes held so far, and a missed quiz counts as 0.{" "}
        <b className="text-[#B91C1C]">⚑</b> = not all quizzes attempted. <b className="text-[#334155]">Not conducted yet</b> = no quiz of
        that type held yet. <b className="text-[#334155]">Not available yet</b> = scores not in the system yet. Both are left out of the
        Skill Track Score. A score below 50% in an assessment type earns no SPI credit for it.
      </p>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Bottom row                                                        */
/* ------------------------------------------------------------------ */
const WEIGHT_PARTS = [
  { label: "Classroom Quizzes", pct: 10, color: "#3B82F6" },
  { label: "Module Quizzes", pct: 15, color: "#22C55E" },
  { label: "Skill Assessments", pct: 25, color: "#F59E0B" },
  { label: "Final Skill Assessment", pct: 50, color: "#8B5CF6" },
];

function WeightsCard() {
  let offset = 0;
  return (
    <Card>
      <CardTitle>SPI weight by assessment type</CardTitle>
      <div className="grid grid-cols-[130px_1fr] items-center gap-3.5">
        <div className="relative h-[130px] w-[130px]">
          <svg width="130" height="130" viewBox="0 0 130 130" aria-hidden>
            {WEIGHT_PARTS.map((p) => {
              const circle = (
                <circle
                  key={p.label}
                  cx="65"
                  cy="65"
                  r="50"
                  fill="none"
                  stroke={p.color}
                  strokeWidth="22"
                  pathLength={100}
                  strokeDasharray={`${p.pct} ${100 - p.pct}`}
                  strokeDashoffset={-offset}
                  transform="rotate(-90 65 65)"
                />
              );
              offset += p.pct;
              return circle;
            })}
          </svg>
          <div className="absolute inset-0 grid place-items-center text-center text-[11px] text-[#64748B]">
            <span>
              Total<b className="block text-xl text-[#0F172A]">100%</b>
            </span>
          </div>
        </div>
        <ul className="grid gap-2 text-xs">
          {WEIGHT_PARTS.map((p) => (
            <li key={p.label} className="grid grid-cols-[12px_1fr_auto] items-center gap-2">
              <i className="block h-3 w-3 rounded-[3px]" style={{ backgroundColor: p.color }} />
              <span>{p.label}</span>
              <b className="text-[#0F172A]">{p.pct}%</b>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

function FormulaCard({ data }: { data: StudentScorecard }) {
  return (
    <Card className="text-[12.5px] leading-relaxed">
      <CardTitle>How SPI is calculated</CardTitle>
      <p>
        <b className="text-[#0F172A]">1. Skill Track Score</b> (per course)
      </p>
      <p className="mt-2 rounded-[10px] bg-[#F1F5FB] px-3 py-2">
        Classroom Quizzes × 10% + Module Quizzes × 15% + Skill Assessments × 25% + Final Skill Assessment × 50%
      </p>
      <p className="mt-2">
        <b className="text-[#0F172A]">2.</b> Skill Track Score → <b className="text-[#0F172A]">Skill Level and Points</b>
      </p>
      <p>
        <b className="text-[#0F172A]">3. SPI</b> = Σ Level Points ÷ Number of courses
      </p>
      <p className="mt-2.5 rounded-[10px] bg-[#FFF4EC] px-3 py-2.5 text-[13px] tabular-nums text-[#0F172A]">
        {data.spi == null ? (
          "SPI will show once quiz scores are available."
        ) : (
          <>
            SPI = {data.totalPoints} ÷ {plural(data.scoredCourses, "course", "courses")} ={" "}
            <strong className="text-[22px] text-[#EA580C]">{data.spi.toFixed(2)}</strong>
          </>
        )}
      </p>
    </Card>
  );
}

const LEVEL_ROWS: { range: string; level: SkillLevel | "Ab"; points: number; meaning: string; debt?: boolean }[] = [
  { range: "90 – 100", level: "A+", points: 10, meaning: "Exceptional mastery" },
  { range: "80 – 89.99", level: "A", points: 9, meaning: "Strong skill-readiness" },
  { range: "70 – 79.99", level: "B", points: 8, meaning: "Competent" },
  { range: "60 – 69.99", level: "C", points: 7, meaning: "Developing" },
  { range: "50 – 59.99", level: "D", points: 6, meaning: "Borderline · needs improvement" },
  { range: "Below 50", level: "F", points: 0, meaning: "Failed · Skill Debt", debt: true },
  { range: "Absent", level: "Ab", points: 0, meaning: "No-show · Skill Debt", debt: true },
];

function LevelsCard() {
  return (
    <Card>
      <CardTitle>Skill Level and Points</CardTitle>
      <table className="w-full text-[11.5px] tabular-nums">
        <thead>
          <tr className="bg-[#EAF1FB] text-left text-[11px] text-[#0F172A]">
            <th className="px-2 py-1.5 font-semibold">Score %</th>
            <th className="px-2 py-1.5 font-semibold">Level</th>
            <th className="px-2 py-1.5 font-semibold">Points</th>
            <th className="px-2 py-1.5 font-semibold">Interpretation</th>
          </tr>
        </thead>
        <tbody>
          {LEVEL_ROWS.map((row) => (
            <tr key={row.level}>
              <td className="whitespace-nowrap border-b border-[#E2E8F0] px-2 py-1">{row.range}</td>
              <td className="border-b border-[#E2E8F0] px-2 py-1">
                <span className={`inline-block min-w-8 rounded-md px-1.5 py-0.5 text-center text-xs font-extrabold ${LEVEL_STYLE[row.level === "Ab" ? "F" : row.level]}`}>
                  {row.level}
                </span>
              </td>
              <td className="border-b border-[#E2E8F0] px-2 py-1">{row.points}</td>
              <td className={`border-b border-[#E2E8F0] px-2 py-1 ${row.debt ? "font-semibold text-[#B91C1C]" : ""}`}>{row.meaning}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function stepText(step: NextStep): ReactNode {
  switch (step.kind) {
    case "attend_sessions":
      return (
        <>
          Attend the next <b className="text-[#0F172A]">{step.sessions} live sessions</b> of{" "}
          <b className="text-[#0F172A]">{step.course}</b> without missing any to reach 80%.
        </>
      );
    case "pending_classroom":
      return (
        <>
          Attempt the <b className="text-[#0F172A]">{plural(step.count, "pending Classroom Quiz", "pending Classroom Quizzes")}</b>.
        </>
      );
    case "pending_module":
      return (
        <>
          Complete the <b className="text-[#0F172A]">{plural(step.count, "pending Module Quiz", "pending Module Quizzes")}</b> before the
          Final Skill Assessment.
        </>
      );
    case "attend_recovery":
      return "If recovery classes are assigned to you, attend all of them. Skipping them creates a Skill Debt.";
    case "final_assessment":
      return (
        <>
          Prepare for the <b className="text-[#0F172A]">Final Skill Assessment</b>. Attending it is mandatory for every course.
        </>
      );
    case "on_track":
      return "You're on track. Keep attending every session and attempting every quiz.";
  }
}

function NextStepsCard({ steps }: { steps: NextStep[] }) {
  return (
    <Card>
      <CardTitle>Your next steps</CardTitle>
      <ol className="grid gap-2.5 text-xs">
        {steps.map((step, i) => (
          <li key={`${step.kind}-${i}`} className="grid grid-cols-[24px_1fr] items-start gap-2 leading-relaxed">
            <span className="grid h-[22px] w-[22px] place-items-center rounded-full bg-[#7C3AED] text-[11px] font-bold text-white">{i + 1}</span>
            <span>{stepText(step)}</span>
          </li>
        ))}
      </ol>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                              */
/* ------------------------------------------------------------------ */
export default function StudentReportView({ data }: { data: StudentScorecard }) {
  return (
    <div className="min-h-screen bg-[#EEF3F9] text-[13px] text-[#334155]" style={{ fontFamily: '"Inter", system-ui, sans-serif' }}>
      <header className="flex flex-wrap items-center justify-between gap-3 bg-gradient-to-r from-[#0F2A5C] to-[#163A7A] px-4 py-4 text-white sm:px-7">
        <div className="flex items-center gap-[18px]">
          <span className="text-[28px] font-extrabold tracking-[0.02em] sm:text-[34px]">NIAT</span>
          <span className="h-[42px] w-px bg-white/35" aria-hidden />
          <h1 className="text-lg font-extrabold leading-tight sm:text-[22px]">
            NIAT-SPI Student Scorecard
            <small className="mt-0.5 block text-[13px] font-medium text-[#BFD3F5]">Skill Performance Index</small>
          </h1>
        </div>
        <p className="text-xl font-extrabold sm:text-[22px]">{data.studentName}</p>
      </header>

      {/* minmax(0,1fr) keeps the wide course table scrolling inside its card instead of widening the page. */}
      <main className="mx-auto grid max-w-[1536px] grid-cols-[minmax(0,1fr)] gap-3.5 px-4 py-[18px] sm:px-6">
        <div className="grid gap-3.5 md:grid-cols-2 xl:grid-cols-[1fr_1fr_1.5fr_1fr]">
          <SpiCard data={data} />
          <AttendanceCard data={data} />
          <EligibilityCard data={data} />
          <SkillDebtCard data={data} />
        </div>

        <AttendanceAlert courses={data.courses} />

        <CourseTable data={data} />

        <div className="grid gap-3.5 md:grid-cols-2 xl:grid-cols-[1.05fr_1.1fr_1.15fr_1.1fr]">
          <WeightsCard />
          <FormulaCard data={data} />
          <LevelsCard />
          <NextStepsCard steps={data.nextSteps} />
        </div>
      </main>

      <footer className="flex flex-wrap items-center justify-between gap-2 px-4 pb-4 pt-2.5 text-[11.5px] text-[#64748B] sm:px-7">
        <span className="text-xl font-extrabold text-[#0F2A5C]">NIAT</span>
        <span>
          Based on the NIAT-SPI Execution Plan v1.0 · Questions?{" "}
          <a className="font-semibold text-[#1D4ED8] underline" href="mailto:learning.support@nxtwave.co.in">
            learning.support@nxtwave.co.in
          </a>
        </span>
      </footer>
    </div>
  );
}
