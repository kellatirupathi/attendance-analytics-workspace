import { useState, type ReactNode } from "react";
import { ATTENDANCE_SCOPE_NOTE } from "@/components/PageHeader";

/* ------------------------------------------------------------------ */
/*  Data shape: GET /api/attendance/students/:id/scorecard            */
/*  (built in api-server/src/lib/spiScorecardRules.ts; this page only shows it) */
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
  weight: number | null;
  weightedPoints: number | null;
}

interface SkillDebtCourse {
  name: string;
  weight: number | null;
  courseScore: number;
  level: SkillLevel;
  lowParts: { kind: "classroom" | "module"; avgPct: number }[];
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
  totalWeightedPoints: number;
  totalWeight: number;
  scoredCourses: number;
  attendance: {
    tier: AttendanceTier | null;
    /** All courses together (present ÷ held), the same figure as the Student Directory. */
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

/* ------------------------------------------------------------------ */
/*  Learning Portal look: white cards, navy text, blue accent         */
/* ------------------------------------------------------------------ */
const C = {
  navy: "#0B1F4D",
  blue: "#2563EB",
  blueSoft: "#EAF1FF",
  blueMid: "#DCE6FB",
  line: "#E6ECF5",
  muted: "#6B7280",
  greySoft: "#F1F4F9",
  red: "#E11D48",
};

type Tone = "green" | "amber" | "orange" | "red" | "grey" | "blue" | "purple";
const TONE: Record<Tone, string> = {
  green: "bg-[#E6F7EC] text-[#16A34A]",
  amber: "bg-[#FFF4DE] text-[#D97706]",
  orange: "bg-[#FFEDE3] text-[#EA580C]",
  red: "bg-[#FDECEF] text-[#E11D48]",
  grey: "bg-[#F1F4F9] text-[#8A94A6]",
  blue: "bg-[#EAF1FF] text-[#2563EB]",
  purple: "bg-[#F5F3FF] text-[#7C3AED]",
};

/** §7.4 eligibility status tiers. */
const TIERS: { id: AttendanceTier; label: string; range: string; tone: Tone; text: string }[] = [
  { id: "eligible", label: "Eligible", range: "≥80%", tone: "green", text: "#16A34A" },
  { id: "recovery_eligible", label: "Recovery Eligible", range: "60–79%", tone: "amber", text: "#D97706" },
  { id: "at_risk", label: "At Risk", range: "50–59%", tone: "orange", text: "#EA580C" },
  { id: "ineligible", label: "Ineligible", range: "<50%", tone: "red", text: "#E11D48" },
];
const tierOf = (id: AttendanceTier) => TIERS.find((t) => t.id === id)!;

const LEVEL_TONE: Record<SkillLevel, Tone> = { "A+": "green", A: "green", B: "blue", C: "amber", D: "amber", F: "red" };

const pct1 = (n: number) => `${n.toFixed(1)}%`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/* ------------------------------------------------------------------ */
/*  Small building blocks                                             */
/* ------------------------------------------------------------------ */
function Icon({ d, className = "" }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`h-5 w-5 shrink-0 ${className}`} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}
const ICONS = {
  chart: "M4 20V14M10 20V8M16 20V11M22 20H2",
  cal: "M3 5h18v16H3zM8 3v4M16 3v4M3 10h18",
  shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM8.5 12l2.5 2.5 4.5-5",
  alert: "M12 3l9.5 17H2.5zM12 10v4M12 17.5v.01",
  book: "M2 5h7a3 3 0 0 1 3 3v12a2 2 0 0 0-2-2H2zM22 5h-7a3 3 0 0 0-3 3v12a2 2 0 0 1 2-2h8z",
  pie: "M12 3a9 9 0 1 0 9 9h-9z",
  calc: "M5 2h14v20H5zM8 6h8M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15h.01",
  trophy: "M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3",
  target: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
};

function Card({ className = "", children, onClick }: { className?: string; children: ReactNode; onClick?: () => void }) {
  return (
    <section
      onClick={onClick}
      className={`rounded-[14px] border border-[#E6ECF5] bg-white p-4 shadow-[0_1px_2px_rgba(11,31,77,0.04)] sm:px-[18px] ${className}`}
    >
      {children}
    </section>
  );
}

function CardTitle({ icon, color = C.blue, children }: { icon: string; color?: string; children: ReactNode }) {
  return (
    <h2 className="flex items-center gap-2.5 text-[13px] font-bold text-[#0B1F4D]">
      <span style={{ color }}>
        <Icon d={icon} />
      </span>
      {children}
    </h2>
  );
}

function Tag({ tone, children, className = "" }: { tone: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-[11px] py-1 text-[11px] font-semibold ${TONE[tone]} ${className}`}>
      {children}
    </span>
  );
}

function Chip({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`inline-block rounded-md px-2.5 py-[3px] text-[11px] font-medium ${TONE[tone]}`}>{children}</span>;
}

/* ------------------------------------------------------------------ */
/*  Top row (one number + one status + one visual per card)            */
/* ------------------------------------------------------------------ */
function SpiCard({ spi }: { spi: number | null }) {
  const fill = spi == null ? 0 : Math.max(0, Math.min(10, spi)) * 10;
  return (
    <Card>
      <CardTitle icon={ICONS.chart}>Your SPI Score</CardTitle>
      <div className="relative mx-auto mt-2 h-[100px] w-[190px]">
        <svg width="190" height="100" viewBox="0 0 190 100" aria-hidden>
          <defs>
            <linearGradient id="spiArc" x1="0" x2="1">
              <stop offset="0" stopColor="#2563EB" />
              <stop offset="1" stopColor="#60A5FA" />
            </linearGradient>
          </defs>
          <path d="M 15 92 A 80 80 0 0 1 175 92" fill="none" stroke="#EEF2F8" strokeWidth="14" strokeLinecap="round" />
          {spi != null && (
            <path d="M 15 92 A 80 80 0 0 1 175 92" fill="none" stroke="url(#spiArc)" strokeWidth="14" strokeLinecap="round" pathLength={100} strokeDasharray={`${fill} 100`} />
          )}
        </svg>
        <p className="absolute inset-x-0 bottom-1 text-center text-[30px] font-bold tabular-nums text-[#0B1F4D]">
          {spi == null ? "—" : spi.toFixed(2)} <small className="text-[13px] font-medium text-[#6B7280]">/ 10</small>
        </p>
      </div>
    </Card>
  );
}

function AttendanceCard({ attendance }: { attendance: StudentScorecard["attendance"] }) {
  const tier = attendance.tier ? tierOf(attendance.tier) : null;
  return (
    <Card>
      <CardTitle icon={ICONS.cal}>Attendance</CardTitle>
      <p className="mt-2.5 flex flex-wrap items-center gap-3">
        <span className="text-[30px] font-extrabold tabular-nums text-[#0B1F4D]">
          {attendance.overallPct == null ? "—" : pct1(attendance.overallPct)}
        </span>
        {tier && <Tag tone={tier.tone}>{tier.label}</Tag>}
      </p>
      <p className="mt-1 text-xs tabular-nums text-[#6B7280]">
        {attendance.held > 0 ? `${attendance.present} / ${attendance.held} sessions` : "No sessions yet"}
      </p>
      <div className="mt-4 grid grid-cols-4 gap-[5px] tabular-nums">
        {TIERS.map((t) => {
          const on = t.id === attendance.tier;
          return (
            <div
              key={t.id}
              className={`rounded-[9px] px-1 py-[7px] text-center ${on ? `${TONE[t.tone]} font-bold shadow-[inset_0_0_0_1.5px_currentColor]` : "bg-[#F1F4F9] text-[#8A94A6]"}`}
            >
              <b className="block text-[10px] font-semibold leading-tight">{t.label}</b>
              <span className="text-[10px]">{t.range}</span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function StateDot({ state }: { state: CriterionState }) {
  const style = state === "met" ? "bg-[#22C55E]" : state === "not_met" ? "bg-[#E11D48]" : "bg-[#94A3B8]";
  return (
    <span className={`grid h-[18px] w-[18px] place-items-center rounded-full text-[10px] font-extrabold text-white ${style}`} aria-hidden>
      {state === "met" ? "✓" : state === "not_met" ? "!" : "–"}
    </span>
  );
}

function EligibilityCard({ data }: { data: StudentScorecard }) {
  const e = data.eligibility;
  const share = (p: { attempted: number; total: number }) => (p.total > 0 ? `${Math.round((p.attempted / p.total) * 100)}%` : "—");
  const rows: [string, CriterionState, string][] = [
    ["Attendance ≥ 80% per course", e.attendance, data.attendance.coursesBelow > 0 ? `${data.attendance.coursesBelow} below` : e.attendance === "met" ? "Met" : "—"],
    ["Classroom Quizzes · 100%", e.classroom.state, share(e.classroom)],
    ["Module Quizzes · 100%", e.module.state, share(e.module)],
    ["Skill Assessments · 100%", e.skillAssessment, "Unavailable"],
    ["Final Skill Assessment", e.finalAssessment, "Unavailable"],
  ];
  return (
    <Card>
      <CardTitle icon={ICONS.shield}>Eligibility Criteria</CardTitle>
      <ul className="mt-2 tabular-nums">
        {rows.map(([title, state, value]) => (
          <li key={title} className="grid grid-cols-[22px_1fr_auto] items-center gap-2.5 border-b border-[#F1F4F9] py-[7px] text-[12.5px] last:border-0">
            <StateDot state={state} />
            <span>{title}</span>
            <b className="font-semibold text-[#0B1F4D]">{value}</b>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function SkillDebtCard({ debt, onOpen }: { debt: SkillDebtCourse[]; onOpen: () => void }) {
  const active = debt.length > 0;
  return (
    <Card
      className={active ? "cursor-pointer !border-[#FAD4DB] bg-gradient-to-b from-[#FFF5F6] to-[#FFEFF2]" : "!border-[#BBF7D0] !bg-[#F0FDF4]"}
      onClick={active ? onOpen : undefined}
    >
      <CardTitle icon={ICONS.alert} color={active ? C.red : "#16A34A"}>
        Skill Debt
      </CardTitle>
      <p className={`mt-2.5 text-[30px] font-extrabold ${active ? "text-[#E11D48]" : "text-[#16A34A]"}`}>
        {active ? plural(debt.length, "course", "courses") : "None"}
      </p>
      {active && (
        <>
          <p className="mt-1 line-clamp-2 text-[12.5px]" title={debt.map((d) => d.name).join(", ")}>
            {debt.map((d) => d.name).join(", ")}
          </p>
          <button
            type="button"
            className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-[#FAD4DB] bg-white px-3.5 py-[7px] text-xs font-semibold text-[#E11D48]"
          >
            View Details ›
          </button>
        </>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Skill Debt details (§6)                                            */
/* ------------------------------------------------------------------ */
const PAUSED = ["MINT", "BRAVE", "GRIT", "Placements", "Internships", "Co-curricular support"];
const CLEAR_STEPS = ["Recovery window opens", "Attend all recovery classes", "Complete pending work", "Re-sit the Final Skill Assessment", "Score ≥ 50% → debt cleared"];

function SkillDebtDialog({ debt, onClose }: { debt: SkillDebtCourse[]; onClose: () => void }) {
  const reason = (d: SkillDebtCourse) => {
    const parts = d.lowParts.map((p) => `${p.kind === "classroom" ? "Classroom" : "Module"} ${p.avgPct}%`);
    return parts.length ? `Score below 50% (${parts.join(", ")} earns 0)` : "Score below 50%";
  };
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[#0B1F4D]/35 p-4" onClick={(e) => e.target === e.currentTarget && onClose()} role="dialog" aria-modal="true">
      <div className="max-h-[90vh] w-full max-w-[760px] overflow-y-auto rounded-[18px] bg-white shadow-[0_24px_60px_rgba(11,31,77,0.25)]">
        <div className="flex items-center gap-3 border-b border-[#FAD4DB] bg-gradient-to-b from-[#FFF5F6] to-[#FFEFF2] px-[22px] py-[18px]">
          <span className="text-[#E11D48]">
            <Icon d={ICONS.alert} className="!h-[26px] !w-[26px]" />
          </span>
          <div>
            <h2 className="text-lg font-bold text-[#E11D48]">Skill Debt · {plural(debt.length, "course", "courses")}</h2>
            <p className="text-xs">Clear within 2 years of creation</p>
          </div>
          <button type="button" onClick={onClose} className="ml-auto grid h-8 w-8 place-items-center rounded-full border border-[#FAD4DB] bg-white text-[#E11D48]" aria-label="Close">
            ✕
          </button>
        </div>
        <div className="grid gap-4 px-[22px] pb-[22px] pt-[18px]">
          <div>
            <h3 className="mb-2 text-[13px] font-bold text-[#0B1F4D]">Courses in Skill Debt</h3>
            <div className="overflow-x-auto rounded-[10px] border border-[#E6ECF5]">
              <table className="w-full min-w-[560px] border-collapse text-[12.5px] tabular-nums">
                <thead>
                  <tr className="bg-[#EAF1FF] text-left text-[11.5px] text-[#0B1F4D]">
                    {["Course", "Weight", "Skill Track Score", "Level", "Reason"].map((h) => (
                      <th key={h} className="px-3 py-[9px] font-semibold">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {debt.map((d) => (
                    <tr key={d.name} className="border-t border-[#F1F4F9]">
                      <td className="px-3 py-2.5 font-medium text-[#0B1F4D]">{d.name}</td>
                      <td className="px-3 py-2.5">{d.weight ?? "Not set"}</td>
                      <td className="px-3 py-2.5">{d.courseScore.toFixed(2)}</td>
                      <td className="px-3 py-2.5"><Tag tone="red">F</Tag></td>
                      <td className="px-3 py-2.5">{reason(d)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div>
            <h3 className="mb-2 text-[13px] font-bold text-[#0B1F4D]">Paused until every Skill Debt is cleared</h3>
            <div className="flex flex-wrap gap-2">
              {PAUSED.map((p) => (
                <span key={p} className="rounded-full border border-[#FAD4DB] bg-[#FFF7F8] px-3 py-1.5 text-xs font-semibold text-[#E11D48]">🔒 {p}</span>
              ))}
            </div>
          </div>
          <div>
            <h3 className="mb-2 text-[13px] font-bold text-[#0B1F4D]">How to clear it</h3>
            <div className="grid gap-2 sm:grid-cols-5">
              {CLEAR_STEPS.map((s, i) => (
                <div key={s} className="rounded-[10px] bg-[#F3F7FE] p-2.5 text-[11.5px] text-[#0B1F4D]">
                  <b className="mb-1.5 grid h-[22px] w-[22px] place-items-center rounded-full bg-[#2563EB] text-[11px] text-white">{i + 1}</b>
                  {s}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Course-wise performance                                           */
/* ------------------------------------------------------------------ */
function QuizCell({ part }: { part: QuizPart | null }) {
  if (!part) return <Chip tone="purple">Awaited</Chip>;
  const missed = part.attempted < part.total;
  return (
    <>
      <b className="font-semibold text-[#0B1F4D]">{part.avgPct}%</b>
      <small className={`block text-[10.5px] ${missed ? "text-[#E11D48]" : "text-[#6B7280]"}`}>
        {part.attempted} of {part.total} attempted
      </small>
    </>
  );
}

function CourseTable({ data }: { data: StudentScorecard }) {
  const sub = "mt-0.5 block text-[10.5px] font-semibold text-[#2563EB]";
  const th = "bg-[#EAF1FF] px-2.5 py-[9px] text-center text-[11.5px] font-semibold leading-tight text-[#0B1F4D]";
  const sep = "border-l border-[#C9D7F5]";
  const td = "border-t border-[#F1F4F9] px-2.5 py-2.5 text-center align-middle";
  return (
    <Card>
      <CardTitle icon={ICONS.book}>
        <span className="text-[15px]">Course-wise Performance</span>
      </CardTitle>
      <div className="mt-3 overflow-x-auto rounded-xl border border-[#E6ECF5]">
        <table className="w-full min-w-[1100px] border-collapse text-[12.5px] tabular-nums">
          <thead>
            <tr>
              <th colSpan={3} className="bg-[#DCE6FB]" />
              <th colSpan={4} className={`bg-[#DCE6FB] px-2.5 py-2 text-xs font-bold text-[#0B1F4D] ${sep}`}>Assessment scores (average %)</th>
              <th colSpan={5} className={`bg-[#DCE6FB] px-2.5 py-2 text-xs font-bold text-[#0B1F4D] ${sep}`}>SPI calculation</th>
            </tr>
            <tr>
              <th className={th}>#</th>
              <th className={`${th} !text-left`}>Course</th>
              <th className={th}>Attendance</th>
              <th className={`${th} ${sep}`}>Classroom Quizzes<span className={sub}>10%</span></th>
              <th className={th}>Module Quizzes<span className={sub}>15%</span></th>
              <th className={th}>Skill Assessments<span className={sub}>25%</span></th>
              <th className={th}>Final Skill Assessment<span className={sub}>50%</span></th>
              <th className={`${th} ${sep}`}>Skill Track Score<span className={sub}>out of 100</span></th>
              <th className={th}>Skill Level</th>
              <th className={th}>Level Points<span className={sub}>out of 10</span></th>
              <th className={th}>Course Weight<span className={sub}>credits</span></th>
              <th className={th}>Weighted Points<span className={sub}>points × weight</span></th>
            </tr>
          </thead>
          <tbody>
            {data.courses.map((c, i) => {
              const tier = c.tier ? tierOf(c.tier) : null;
              return (
                <tr key={c.name}>
                  <td className={td}>{i + 1}</td>
                  <td className={`${td} !text-left font-medium text-[#0B1F4D]`}>{c.name}</td>
                  <td className={td}>
                    {c.attendancePct == null ? (
                      <Chip tone="purple">Awaited</Chip>
                    ) : (
                      <>
                        <b className="block font-bold" style={{ color: tier?.text }}>{pct1(c.attendancePct)}</b>
                        {tier && <Tag tone={tier.tone} className="mt-[3px] !px-2 !py-0.5 !text-[10px]">{tier.label}</Tag>}
                      </>
                    )}
                  </td>
                  <td className={`${td} ${sep}`}><QuizCell part={c.classroom} /></td>
                  <td className={td}><QuizCell part={c.module} /></td>
                  <td className={td}><Chip tone="grey">Unavailable</Chip></td>
                  <td className={td}><Chip tone="grey">Unavailable</Chip></td>
                  <td className={`${td} ${sep} font-bold text-[#0B1F4D]`}>{c.courseScore == null ? "—" : c.courseScore.toFixed(2)}</td>
                  <td className={td}>{c.level ? <Tag tone={LEVEL_TONE[c.level]}>{c.level}</Tag> : "—"}</td>
                  <td className={`${td} font-bold text-[#0B1F4D]`}>{c.points ?? "—"}</td>
                  <td className={td}>
                    {c.weight == null ? (
                      <Chip tone="grey">Not set</Chip>
                    ) : (
                      <span className="inline-grid h-6 min-w-[26px] place-items-center rounded-[7px] bg-[#EAF1FF] px-1.5 font-bold text-[#2563EB]">{c.weight}</span>
                    )}
                  </td>
                  <td className={`${td} font-bold text-[#0B1F4D]`}>{c.weightedPoints ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-[#F8FAFE] font-bold text-[#0B1F4D]">
              <td colSpan={10} className="border-t border-[#E6ECF5] px-2.5 py-2.5 text-right">Total</td>
              <td className="border-t border-[#E6ECF5] px-2.5 py-2.5 text-center">{data.totalWeight}</td>
              <td className="border-t border-[#E6ECF5] px-2.5 py-2.5 text-center">{data.totalWeightedPoints}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Bottom row                                                        */
/* ------------------------------------------------------------------ */
const WEIGHT_PARTS = [
  { label: "Classroom Quizzes", pct: 10, color: "#2563EB" },
  { label: "Module Quizzes", pct: 15, color: "#22C55E" },
  { label: "Skill Assessments", pct: 25, color: "#F59E0B" },
  { label: "Final Skill Assessment", pct: 50, color: "#A855F7" },
];

function WeightsCard() {
  let offset = 0;
  return (
    <Card>
      <CardTitle icon={ICONS.pie}>SPI Weightage</CardTitle>
      <div className="mt-3 grid grid-cols-[116px_1fr] items-center gap-3.5">
        <div className="relative h-[116px] w-[116px]">
          <svg width="116" height="116" viewBox="0 0 116 116" aria-hidden>
            {WEIGHT_PARTS.map((p) => {
              const circle = (
                <circle key={p.label} cx="58" cy="58" r="44" fill="none" stroke={p.color} strokeWidth="18" pathLength={100} strokeDasharray={`${p.pct} ${100 - p.pct}`} strokeDashoffset={-offset} transform="rotate(-90 58 58)" />
              );
              offset += p.pct;
              return circle;
            })}
          </svg>
          <p className="absolute inset-0 grid place-items-center text-center text-[11px] text-[#6B7280]">
            <span>Total<b className="block text-lg text-[#0B1F4D]">100%</b></span>
          </p>
        </div>
        <ul className="grid gap-2.5 text-[11.5px]">
          {WEIGHT_PARTS.map((p) => (
            <li key={p.label} className="grid grid-cols-[10px_1fr_auto] items-center gap-2 whitespace-nowrap">
              <i className="block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: p.color }} />
              <span>{p.label}</span>
              <b className="text-[#0B1F4D]">{p.pct}%</b>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

function FormulaCard({ data }: { data: StudentScorecard }) {
  const box = "rounded-[10px] bg-[#F3F7FE] px-3 py-[9px] text-xs text-[#0B1F4D]";
  const label = "mb-[3px] block text-[10.5px] font-semibold uppercase tracking-[0.04em] text-[#6B7280]";
  return (
    <Card>
      <CardTitle icon={ICONS.calc}>SPI Calculation</CardTitle>
      <div className="mt-3 grid gap-2 tabular-nums">
        <div className={box}><span className={label}>Skill Track Score</span>CQ × 10% + MQ × 15% + SA × 25% + FSA × 50%</div>
        <div className={box}><span className={label}>SPI</span>Σ (Level Points × Course Weight) ÷ Σ Course Weights</div>
        <div className="rounded-[10px] bg-[#2563EB] px-3 py-[9px] text-center text-base font-bold text-white">
          {data.spi == null ? "SPI = —" : `SPI = ${data.totalWeightedPoints} ÷ ${data.totalWeight} = ${data.spi.toFixed(2)} / 10`}
        </div>
      </div>
    </Card>
  );
}

const LEVEL_ROWS: [string, string, number, string, Tone][] = [
  ["A+", "90 – 100", 10, "Exceptional mastery", "green"],
  ["A", "80 – 89.99", 9, "Strong skill-readiness", "green"],
  ["B", "70 – 79.99", 8, "Competent", "blue"],
  ["C", "60 – 69.99", 7, "Developing", "amber"],
  ["D", "50 – 59.99", 6, "Borderline", "amber"],
  ["F", "Below 50", 0, "Skill Debt", "red"],
  ["Ab", "Absent", 0, "Skill Debt", "red"],
];

function LevelsCard() {
  return (
    <Card>
      <CardTitle icon={ICONS.trophy}>Skill Level &amp; Points</CardTitle>
      <table className="mt-2 w-full border-collapse text-xs tabular-nums">
        <tbody>
          {LEVEL_ROWS.map(([level, range, points, meaning, tone]) => (
            <tr key={level}>
              <td className="border-b border-[#F1F4F9] px-1.5 py-[5px]"><Tag tone={tone}>{level}</Tag></td>
              <td className="whitespace-nowrap border-b border-[#F1F4F9] px-1.5 py-[5px] text-[#6B7280]">{range}</td>
              <td className="border-b border-[#F1F4F9] px-1.5 py-[5px] font-bold text-[#0B1F4D]">{points}</td>
              <td className={`border-b border-[#F1F4F9] px-1.5 py-[5px] ${tone === "red" ? "text-[#E11D48]" : ""}`}>{meaning}</td>
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
      return <>Attend the next <b>{step.sessions} live sessions</b> of {step.course}.</>;
    case "pending_classroom":
      return <>Attempt <b>{step.count} pending</b> Classroom Quizzes.</>;
    case "pending_module":
      return <>Complete <b>{step.count} pending</b> Module Quizzes.</>;
    case "attend_recovery":
      return <>Attend every assigned <b>recovery class</b>.</>;
    case "final_assessment":
      return <>Prepare for the <b>Final Skill Assessment</b>.</>;
    case "on_track":
      return <>You're on track. Keep it up.</>;
  }
}

function NextStepsCard({ steps }: { steps: NextStep[] }) {
  return (
    <Card>
      <CardTitle icon={ICONS.target}>Next Steps</CardTitle>
      <ol className="mt-2.5 grid gap-[11px] text-xs text-[#0B1F4D]">
        {steps.map((step, i) => (
          <li key={`${step.kind}-${i}`} className="grid grid-cols-[24px_1fr] gap-2.5 leading-snug">
            <span className="grid h-[22px] w-[22px] place-items-center rounded-full bg-[#2563EB] text-[11px] font-bold text-white">{i + 1}</span>
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
  const [debtOpen, setDebtOpen] = useState(false);
  return (
    <div className="min-h-screen bg-[#F4F7FD] text-[13px] text-[#334155]" style={{ fontFamily: '"Inter", system-ui, sans-serif' }}>
      <main className="mx-auto grid max-w-[1400px] grid-cols-[minmax(0,1fr)] gap-4 px-4 py-[22px] sm:px-6">
        <header className="flex flex-wrap items-center gap-3.5">
          <span className="text-[#2563EB]"><Icon d={ICONS.chart} className="!h-[30px] !w-[30px]" /></span>
          <div>
            <h1 className="text-xl font-bold text-[#0B1F4D]">NIAT - SPI Student Report Card</h1>
            <p className="mt-0.5 text-[13px]">Skill Performance Index</p>
          </div>
          <p className="ml-auto text-base font-semibold text-[#0B1F4D]">{data.studentName}</p>
        </header>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-[1fr_1.05fr_1.05fr_1.05fr]">
          <SpiCard spi={data.spi} />
          <AttendanceCard attendance={data.attendance} />
          <EligibilityCard data={data} />
          <SkillDebtCard debt={data.skillDebt} onOpen={() => setDebtOpen(true)} />
        </div>

        <div className="flex items-center gap-3 rounded-xl border border-[#D5E2FF] bg-[#EAF1FF] px-4 py-[11px] text-[12.5px] text-[#0B1F4D]">
          <span className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full bg-[#2563EB] font-extrabold text-white">i</span>
          <span>Quiz scores count quizzes held so far; a missed quiz counts as 0. {ATTENDANCE_SCOPE_NOTE}</span>
        </div>

        <CourseTable data={data} />

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-[1.15fr_1.1fr_1.1fr_1.15fr]">
          <WeightsCard />
          <FormulaCard data={data} />
          <LevelsCard />
          <NextStepsCard steps={data.nextSteps} />
        </div>

        <footer className="pb-2 text-right text-[11.5px] text-[#6B7280]">
          Based on the NIAT-SPI Execution Plan v1.0 · Questions?{" "}
          <a className="font-semibold text-[#2563EB] underline" href="mailto:learning.support@nxtwave.co.in">learning.support@nxtwave.co.in</a>
        </footer>
      </main>

      {debtOpen && <SkillDebtDialog debt={data.skillDebt} onClose={() => setDebtOpen(false)} />}
    </div>
  );
}
