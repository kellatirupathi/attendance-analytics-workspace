import { useEffect, useRef, useState, type ReactNode } from "react";

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
  book: "M2 5h7a3 3 0 0 1 3 3v12a2 2 0 0 0-2-2H2zM22 5h-7a3 3 0 0 0-3 3v12a2 2 0 0 1 2-2h8z",
  pie: "M12 3a9 9 0 1 0 9 9h-9z",
  calc: "M5 2h14v20H5zM8 6h8M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15h.01",
  trophy: "M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3",
  info: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v5M12 8h.01",
  doc: "M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 13h8M8 17h5",
  gauge: "M3 18a9 9 0 0 1 18 0M12 18l4-6",
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
/*  Top row: SPI · Attendance · Skill Debt Status                      */
/* ------------------------------------------------------------------ */
/** SPI is final only when every eligibility rule is met (§4); until then it is provisional. */
const isProvisional = (data: StudentScorecard) => {
  const e = data.eligibility;
  return [e.attendance, e.classroom.state, e.module.state, e.skillAssessment, e.finalAssessment].some((s) => s !== "met");
};

function SpiCard({ data }: { data: StudentScorecard }) {
  const { spi } = data;
  const fill = spi == null ? 0 : Math.max(0, Math.min(10, spi)) * 10;
  const facts: [string, ReactNode][] = [
    ["Weighted points", data.totalWeightedPoints],
    ["Course credits", data.totalWeight],
    ["Courses scored", `${data.scoredCourses} of ${data.courses.length}`],
  ];
  return (
    <Card>
      <div className="flex items-center gap-2">
        <CardTitle icon={ICONS.chart}>Your SPI Score</CardTitle>
        {spi != null && isProvisional(data) && (
          <Tag tone="blue" className="ml-auto" >Provisional</Tag>
        )}
      </div>
      <div className="mt-2 grid items-center gap-4 sm:grid-cols-[200px_1fr]">
        <div className="relative mx-auto h-[106px] w-[200px]">
          <svg width="200" height="106" viewBox="0 0 200 106" aria-hidden>
            <defs>
              <linearGradient id="spiArc" x1="0" x2="1">
                <stop offset="0" stopColor="#2563EB" />
                <stop offset="1" stopColor="#60A5FA" />
              </linearGradient>
            </defs>
            <path d="M 16 98 A 84 84 0 0 1 184 98" fill="none" stroke="#EEF2F8" strokeWidth="14" strokeLinecap="round" />
            {spi != null && (
              <path d="M 16 98 A 84 84 0 0 1 184 98" fill="none" stroke="url(#spiArc)" strokeWidth="14" strokeLinecap="round" pathLength={100} strokeDasharray={`${fill} 100`} />
            )}
          </svg>
          <p className="absolute inset-x-0 bottom-0.5 text-center text-[34px] font-extrabold tabular-nums text-[#0B1F4D]">
            {spi == null ? "—" : spi.toFixed(2)} <small className="text-[13px] font-medium text-[#6B7280]">/ 10</small>
          </p>
        </div>
        <ul className="grid gap-2 tabular-nums">
          {facts.map(([label, value]) => (
            <li key={label} className="flex items-center justify-between gap-2.5 rounded-[9px] bg-[#F6F9FF] px-[11px] py-2 text-xs">
              <span>{label}</span>
              <b className="font-bold text-[#0B1F4D]">{value}</b>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

function AttendanceCard({ attendance }: { attendance: StudentScorecard["attendance"] }) {
  const tier = attendance.tier ? tierOf(attendance.tier) : null;
  return (
    <Card>
      <CardTitle icon={ICONS.cal}>Attendance</CardTitle>
      <p className="mt-3 flex flex-wrap items-center gap-3">
        <span className="text-[34px] font-extrabold leading-none tabular-nums text-[#0B1F4D]">
          {attendance.overallPct == null ? "—" : pct1(attendance.overallPct)}
        </span>
        {tier && <Tag tone={tier.tone}>{tier.label}</Tag>}
      </p>
      <p className="mt-1.5 text-xs tabular-nums text-[#6B7280]">
        {attendance.held > 0 ? `${attendance.present} / ${attendance.held} sessions` : "No sessions yet"}
      </p>
      <div className="mt-4 grid grid-cols-4 gap-1.5 tabular-nums">
        {TIERS.map((t) => {
          const on = t.id === attendance.tier;
          return (
            <div
              key={t.id}
              className={`rounded-[9px] px-1 py-[7px] text-center ${on ? `${TONE[t.tone]} font-bold shadow-[inset_0_0_0_1.5px_currentColor]` : "bg-[#F1F4F9] text-[#8A94A6]"}`}
            >
              <b className="block text-[10.5px] font-semibold leading-tight">{t.label}</b>
              <span className="text-[10px]">{t.range}</span>
            </div>
          );
        })}
      </div>
      <p className="mt-3 flex items-center gap-[7px] rounded-lg bg-[#EAF1FF] px-2.5 py-1.5 text-[11.5px] text-[#0B1F4D]">
        <span className="text-[#2563EB]"><Icon d={ICONS.info} className="!h-[15px] !w-[15px]" /></span>
        Calculated on NIAT course sessions only
      </p>
    </Card>
  );
}

/**
 * Skill Debt Status: the semester is still running, so an F today is a risk, not a debt.
 * At risk = level F now; on track = a level that earns points; not scored yet = no quiz held.
 */
function SkillDebtStatusCard({ data, onOpen }: { data: StudentScorecard; onOpen: () => void }) {
  const atRisk = data.skillDebt.length;
  const onTrack = data.courses.filter((c) => c.level != null && c.level !== "F").length;
  const notScored = data.courses.filter((c) => c.level == null).length;
  const segments = [
    { label: "At risk", n: atRisk, color: "#F59E0B" },
    { label: "On track", n: onTrack, color: "#22C55E" },
    { label: "Not scored yet", n: notScored, color: "#CBD5E1" },
  ];
  return (
    <Card className={atRisk ? "!border-[#F8DFB0] bg-gradient-to-b from-[#FFFBF2] to-[#FFF4DE]" : "!border-[#BBF7D0] !bg-[#F0FDF4]"}>
      <div className="flex items-center gap-2">
        <CardTitle icon={ICONS.gauge} color={atRisk ? "#D97706" : "#16A34A"}>Skill Debt Status</CardTitle>
        <Tag tone="amber" className="ml-auto">Semester in progress</Tag>
      </div>
      <p className={`mt-3 text-[34px] font-extrabold leading-none tabular-nums ${atRisk ? "text-[#D97706]" : "text-[#16A34A]"}`}>
        {atRisk ? `${atRisk} of ${data.courses.length} ${data.courses.length === 1 ? "course" : "courses"}` : "None"}
      </p>
      <p className="mt-1.5 text-xs text-[#6B7280]">{atRisk ? "at risk of Skill Debt" : "No course at risk of Skill Debt"}</p>
      {data.courses.length > 0 && (
        <>
          <div className="mt-4 flex h-3 gap-[3px] overflow-hidden rounded-full">
            {segments.filter((s) => s.n > 0).map((s) => (
              <i key={s.label} className="block" style={{ flex: s.n, backgroundColor: s.color }} />
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-3.5 gap-y-1 text-[11.5px] tabular-nums">
            {segments.map((s) => (
              <span key={s.label} className="inline-flex items-center gap-1.5">
                <i className="inline-block h-[9px] w-[9px] rounded-full" style={{ backgroundColor: s.color }} />
                {s.label} <b className="text-[#0B1F4D]">{s.n}</b>
              </span>
            ))}
          </div>
        </>
      )}
      {atRisk > 0 && (
        <button
          type="button"
          onClick={onOpen}
          className="mt-3.5 inline-flex items-center gap-1.5 rounded-full border border-[#F3CF8C] bg-white px-3.5 py-[7px] text-xs font-semibold text-[#D97706]"
        >
          View Details ›
        </button>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Skill Debt Status details                                          */
/* ------------------------------------------------------------------ */
const PAUSED = ["MINT", "BRAVE", "GRIT", "Placements", "Internships", "Co-curricular support"];

function Overlay({ onClose, className = "", children }: { onClose: () => void; className?: string; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className={`fixed inset-0 z-50 grid bg-[#0B1F4D]/35 ${className}`} onClick={(e) => e.target === e.currentTarget && onClose()} role="dialog" aria-modal="true">
      {children}
    </div>
  );
}

function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button type="button" onClick={onClose} className="ml-auto grid h-8 w-8 shrink-0 place-items-center rounded-full border border-[#E6ECF5] bg-white text-[#0B1F4D]" aria-label="Close">
      ✕
    </button>
  );
}

function SkillDebtStatusDialog({ data, onClose }: { data: StudentScorecard; onClose: () => void }) {
  const byName = new Map(data.courses.map((c) => [c.name, c]));
  const low = (d: SkillDebtCourse) =>
    d.lowParts.map((p) => `${p.kind === "classroom" ? "Classroom" : "Module"} ${p.avgPct}%`).join(", ") || "—";
  const toImprove = (d: SkillDebtCourse) => {
    const c = byName.get(d.name);
    const pending = [
      c?.classroom && c.classroom.total > c.classroom.attempted ? `${c.classroom.total - c.classroom.attempted} classroom` : null,
      c?.module && c.module.total > c.module.attempted ? `${c.module.total - c.module.attempted} module` : null,
    ].filter(Boolean);
    return pending.length ? `Attempt ${pending.join(" + ")} quizzes` : "Improve quiz scores";
  };
  return (
    <Overlay onClose={onClose} className="place-items-center p-4">
      <div className="max-h-[90vh] w-full max-w-[820px] overflow-y-auto rounded-[18px] bg-white shadow-[0_24px_60px_rgba(11,31,77,0.25)]">
        <div className="flex items-center gap-3 border-b border-[#F8DFB0] bg-gradient-to-b from-[#FFFBF2] to-[#FFF4DE] px-[22px] py-[18px]">
          <span className="text-[#D97706]"><Icon d={ICONS.gauge} className="!h-[26px] !w-[26px]" /></span>
          <div>
            <h2 className="text-lg font-bold text-[#0B1F4D]">At risk of Skill Debt · {plural(data.skillDebt.length, "course", "courses")}</h2>
            <p className="mt-0.5 text-xs text-[#6B7280]">Below 50% at the end of the semester becomes a Skill Debt</p>
          </div>
          <CloseButton onClose={onClose} />
        </div>
        <div className="grid gap-4 px-[22px] pb-[22px] pt-[18px]">
          <div>
            <h3 className="mb-2 text-[13px] font-bold text-[#0B1F4D]">Courses at risk</h3>
            <div className="overflow-x-auto rounded-[10px] border border-[#E6ECF5]">
              <table className="w-full min-w-[600px] border-collapse text-[12.5px] tabular-nums">
                <thead>
                  <tr className="bg-[#EAF1FF] text-left text-[11.5px] text-[#0B1F4D]">
                    {["Course", "Weight", "Skill Track Score", "Below 50%", "To improve"].map((h) => (
                      <th key={h} className="px-3 py-[9px] font-semibold">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.skillDebt.map((d) => (
                    <tr key={d.name} className="border-t border-[#F1F4F9]">
                      <td className="px-3 py-2.5 font-medium text-[#0B1F4D]">{d.name}</td>
                      <td className="px-3 py-2.5">{d.weight ?? "Not set"}</td>
                      <td className="px-3 py-2.5">{d.courseScore.toFixed(2)}</td>
                      <td className="px-3 py-2.5">{low(d)}</td>
                      <td className="px-3 py-2.5">{toImprove(d)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div>
            <h3 className="mb-2 text-[13px] font-bold text-[#0B1F4D]">Paused if it becomes a Skill Debt</h3>
            <div className="flex flex-wrap gap-2">
              {PAUSED.map((p) => (
                <span key={p} className="rounded-full border border-[#F3CF8C] bg-[#FFFBF2] px-3 py-1.5 text-xs font-semibold text-[#D97706]">{p}</span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Overlay>
  );
}

/* ------------------------------------------------------------------ */
/*  Eligibility: one long strip                                        */
/* ------------------------------------------------------------------ */
function StateDot({ state }: { state: CriterionState }) {
  const style = state === "met" ? "bg-[#22C55E]" : state === "not_met" ? "bg-[#E11D48]" : "bg-[#94A3B8]";
  return (
    <span className={`row-span-2 grid h-6 w-6 place-items-center rounded-full text-xs font-extrabold text-white ${style}`} aria-hidden>
      {state === "met" ? "✓" : state === "not_met" ? "!" : "–"}
    </span>
  );
}

function DocLink({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#2563EB] hover:underline">
      <Icon d={ICONS.doc} className="!h-[15px] !w-[15px]" />
      {children}
    </button>
  );
}

function EligibilityStrip({ data, onOpenDoc }: { data: StudentScorecard; onOpenDoc: () => void }) {
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
      <div className="flex flex-wrap items-center gap-2">
        <CardTitle icon={ICONS.shield}>Eligibility Status</CardTitle>
        <span className="ml-auto"><DocLink onClick={onOpenDoc}>Eligibility Criteria</DocLink></span>
      </div>
      <ul className="mt-3 grid gap-3 tabular-nums sm:grid-cols-2 lg:grid-cols-5">
        {rows.map(([title, state, value]) => (
          <li key={title} className="grid grid-cols-[26px_1fr] items-center gap-x-2.5 gap-y-1 rounded-xl border border-[#E6ECF5] px-[13px] py-[11px]">
            <StateDot state={state} />
            <span className="text-xs">{title}</span>
            <b className="text-[15px] font-bold text-[#0B1F4D]">{value}</b>
          </li>
        ))}
      </ul>
    </Card>
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

function CourseTable({ data, onOpenGuide }: { data: StudentScorecard; onOpenGuide: () => void }) {
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
      <button
        type="button"
        onClick={onOpenGuide}
        className="mt-3.5 inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#2563EB] underline underline-offset-[3px]"
      >
        <Icon d={ICONS.info} className="!h-4 !w-4" />
        How SPI Score works
      </button>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  How SPI Score works: one scrollable document in a side panel      */
/* ------------------------------------------------------------------ */
type GuideSection = "weight" | "calc" | "levels" | "elig";

const WEIGHT_PARTS = [
  { label: "Classroom Quizzes", pct: 10, color: "#2563EB" },
  { label: "Module Quizzes", pct: 15, color: "#22C55E" },
  { label: "Skill Assessments", pct: 25, color: "#F59E0B" },
  { label: "Final Skill Assessment", pct: 50, color: "#A855F7" },
];

const LEVEL_ROWS: [string, string, number, string, Tone][] = [
  ["A+", "90 – 100", 10, "Exceptional mastery", "green"],
  ["A", "80 – 89.99", 9, "Strong skill-readiness", "green"],
  ["B", "70 – 79.99", 8, "Competent", "blue"],
  ["C", "60 – 69.99", 7, "Developing", "amber"],
  ["D", "50 – 59.99", 6, "Borderline", "amber"],
  ["F", "Below 50", 0, "Skill Debt at semester end", "red"],
  ["Ab", "Absent", 0, "Skill Debt at semester end", "red"],
];

const ELIGIBILITY_RULES: [string, string][] = [
  ["Attendance", "Minimum 80% per course (Recovery Mode if missed)"],
  ["Classroom Quizzes", "100% participation"],
  ["Module Quizzes", "100% completion"],
  ["Skill Assessments", "100% participation"],
  ["Final Skill Assessment", "Mandatory participation"],
  ["Assessment honesty", "No malpractice cases"],
];

const GUIDE_SECTIONS: { id: GuideSection; title: string; icon: string }[] = [
  { id: "weight", title: "SPI Weightage", icon: ICONS.pie },
  { id: "calc", title: "SPI Calculation", icon: ICONS.calc },
  { id: "levels", title: "Skill Level & Points", icon: ICONS.trophy },
  { id: "elig", title: "Eligibility Criteria", icon: ICONS.shield },
];

function GuideSectionBody({ id, data }: { id: GuideSection; data: StudentScorecard }) {
  switch (id) {
    case "weight": {
      let offset = 0;
      return (
        <>
          <p className="mb-3 text-[12.5px]">Each assessment carries a weight. The Final Skill Assessment matters most.</p>
          <div className="grid grid-cols-[130px_1fr] items-center gap-[18px]">
            <div className="relative h-[130px] w-[130px]">
              <svg width="130" height="130" viewBox="0 0 130 130" aria-hidden>
                {WEIGHT_PARTS.map((p) => {
                  const circle = (
                    <circle key={p.label} cx="65" cy="65" r="50" fill="none" stroke={p.color} strokeWidth="20" pathLength={100} strokeDasharray={`${p.pct} ${100 - p.pct}`} strokeDashoffset={-offset} transform="rotate(-90 65 65)" />
                  );
                  offset += p.pct;
                  return circle;
                })}
              </svg>
              <p className="absolute inset-0 grid place-items-center text-center text-[11px] text-[#6B7280]">
                <span>Total<b className="block text-lg text-[#0B1F4D]">100%</b></span>
              </p>
            </div>
            <ul className="grid gap-2.5 text-[12.5px]">
              {WEIGHT_PARTS.map((p) => (
                <li key={p.label} className="grid grid-cols-[10px_1fr_auto] items-center gap-2.5">
                  <i className="block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: p.color }} />
                  <span>{p.label}</span>
                  <b className="text-[#0B1F4D]">{p.pct}%</b>
                </li>
              ))}
            </ul>
          </div>
          <p className="mt-3.5 rounded-[10px] bg-[#E6F7EC] px-3 py-2.5 text-[12.5px] font-semibold text-[#16A34A]">
            You need 50% in each assessment component to earn SPI from it.
          </p>
        </>
      );
    }
    case "calc": {
      const box = "rounded-[10px] bg-[#F3F7FE] px-3 py-2.5 text-[12.5px] text-[#0B1F4D]";
      const label = "mb-[3px] block text-[10.5px] font-semibold uppercase tracking-[0.04em] text-[#6B7280]";
      return (
        <>
          <div className="grid gap-2 tabular-nums">
            <div className={box}><span className={label}>Step 1 · Skill Track Score (per course)</span>CQ × 10% + MQ × 15% + SA × 25% + FSA × 50%</div>
            <div className={box}><span className={label}>Step 2 · SPI</span>Σ (Level Points × Course Weight) ÷ Σ Course Weights</div>
            <div className="rounded-[10px] bg-[#2563EB] px-3 py-2.5 text-center text-[17px] font-bold text-white">
              {data.spi == null ? "Your SPI = —" : `Your SPI = ${data.totalWeightedPoints} ÷ ${data.totalWeight} = ${data.spi.toFixed(2)} / 10`}
            </div>
          </div>
          <p className="mt-3 text-[12.5px]">Quiz scores count quizzes held so far; a missed quiz counts as 0.</p>
        </>
      );
    }
    case "levels":
      return (
        <table className="w-full border-collapse text-[12.5px] tabular-nums">
          <tbody>
            {LEVEL_ROWS.map(([level, range, points, meaning, tone]) => (
              <tr key={level}>
                <td className="border-b border-[#F1F4F9] px-2 py-[7px]"><Tag tone={tone}>{level}</Tag></td>
                <td className="whitespace-nowrap border-b border-[#F1F4F9] px-2 py-[7px] text-[#6B7280]">{range}</td>
                <td className="border-b border-[#F1F4F9] px-2 py-[7px] font-bold text-[#0B1F4D]">{points}</td>
                <td className="border-b border-[#F1F4F9] px-2 py-[7px]">{meaning}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    case "elig":
      return (
        <>
          <p className="mb-3 text-[12.5px]">You earn SPI only when every requirement below is met.</p>
          <table className="w-full border-collapse text-[12.5px]">
            <tbody>
              {ELIGIBILITY_RULES.map(([rule, need]) => (
                <tr key={rule}>
                  <td className="w-[45%] border-b border-[#F1F4F9] px-2 py-[7px] font-semibold text-[#0B1F4D]">{rule}</td>
                  <td className="border-b border-[#F1F4F9] px-2 py-[7px]">{need}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      );
  }
}

function SpiGuide({ data, start, onClose }: { data: StudentScorecard; start: GuideSection; onClose: () => void }) {
  const scroller = useRef<HTMLDivElement>(null);
  const sections = useRef<Partial<Record<GuideSection, HTMLElement | null>>>({});
  const [current, setCurrent] = useState<GuideSection>(start);

  const jump = (id: GuideSection) => {
    const box = scroller.current, el = sections.current[id];
    if (box && el) box.scrollTo({ top: el.offsetTop - box.offsetTop });
    setCurrent(id);
  };
  useEffect(() => jump(start), [start]); // eslint-disable-line react-hooks/exhaustive-deps

  const onScroll = () => {
    const box = scroller.current;
    if (!box) return;
    const passed = GUIDE_SECTIONS.filter((s) => (sections.current[s.id]?.offsetTop ?? Infinity) - box.offsetTop <= box.scrollTop + 40);
    if (passed.length) setCurrent(passed[passed.length - 1].id);
  };

  return (
    <Overlay onClose={onClose} className="justify-items-end">
      <aside className="grid h-full w-full max-w-[640px] animate-page-in grid-rows-[auto_auto_1fr] bg-white shadow-[-20px_0_50px_rgba(11,31,77,0.2)]">
        <div className="flex items-center gap-3 border-b border-[#E6ECF5] px-[22px] py-[18px]">
          <span className="text-[#2563EB]"><Icon d={ICONS.doc} className="!h-6 !w-6" /></span>
          <div>
            <h2 className="text-lg font-bold text-[#0B1F4D]">How SPI Score works</h2>
            <p className="mt-0.5 text-xs text-[#6B7280]">NIAT-SPI Student Edition</p>
          </div>
          <CloseButton onClose={onClose} />
        </div>
        <nav className="flex flex-wrap gap-1.5 border-b border-[#E6ECF5] bg-[#FAFCFF] px-[22px] py-2.5">
          {GUIDE_SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => jump(s.id)}
              className={`rounded-full px-3 py-[7px] text-xs font-semibold ${current === s.id ? "bg-[#EAF1FF] text-[#2563EB]" : "text-[#6B7280] hover:text-[#0B1F4D]"}`}
            >
              {s.title}
            </button>
          ))}
        </nav>
        <div ref={scroller} onScroll={onScroll} className="overflow-y-auto px-[22px] pb-10 pt-1.5">
          {GUIDE_SECTIONS.map((s) => (
            <section key={s.id} ref={(el) => { sections.current[s.id] = el; }} className="border-b border-[#E6ECF5] py-5 last:border-0">
              <h3 className="mb-3 flex items-center gap-2.5 text-base font-bold text-[#0B1F4D]">
                <span className="text-[#2563EB]"><Icon d={s.icon} /></span>
                {s.title}
              </h3>
              <GuideSectionBody id={s.id} data={data} />
            </section>
          ))}
        </div>
      </aside>
    </Overlay>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                              */
/* ------------------------------------------------------------------ */
export default function StudentReportView({ data }: { data: StudentScorecard }) {
  const [riskOpen, setRiskOpen] = useState(false);
  const [guide, setGuide] = useState<GuideSection | null>(null);
  return (
    <div className="min-h-screen bg-[#F4F7FD] text-[13px] text-[#334155]" style={{ fontFamily: '"Inter", system-ui, sans-serif' }}>
      <main className="mx-auto grid max-w-[1480px] grid-cols-[minmax(0,1fr)] gap-4 px-4 py-[22px] sm:px-8">
        <header className="flex flex-wrap items-center gap-3.5">
          <span className="text-[#2563EB]"><Icon d={ICONS.chart} className="!h-8 !w-8" /></span>
          <div>
            <h1 className="text-[22px] font-bold text-[#0B1F4D]">NIAT - SPI Student Report Card</h1>
            <p className="mt-0.5 text-[13px]">Skill Performance Index</p>
          </div>
          <p className="ml-auto text-[17px] font-bold text-[#0B1F4D]">{data.studentName}</p>
        </header>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-[1.15fr_1fr_1fr]">
          <SpiCard data={data} />
          <AttendanceCard attendance={data.attendance} />
          <SkillDebtStatusCard data={data} onOpen={() => setRiskOpen(true)} />
        </div>

        <EligibilityStrip data={data} onOpenDoc={() => setGuide("elig")} />

        <CourseTable data={data} onOpenGuide={() => setGuide("weight")} />
      </main>

      {riskOpen && <SkillDebtStatusDialog data={data} onClose={() => setRiskOpen(false)} />}
      {guide && <SpiGuide data={data} start={guide} onClose={() => setGuide(null)} />}
    </div>
  );
}
