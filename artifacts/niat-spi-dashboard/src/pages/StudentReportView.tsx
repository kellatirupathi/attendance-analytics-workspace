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
  skillAssessment: QuizPart | null;
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
  lowParts: { kind: "classroom" | "module" | "skill"; avgPct: number }[];
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
    skillAssessment: { state: CriterionState; attempted: number; total: number };
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
/*  Top row: SPI · Attendance · Needs Attention                        */
/*  Mid-semester progress report: no SPI number until all 4 parts exist */
/* ------------------------------------------------------------------ */
/** The SPI needs the full Skill Track Score (CQ, MQ, SA, FSA). Until the Final Skill Assessment is in, it is in progress. */
const spiReady = (data: StudentScorecard) => data.eligibility.finalAssessment !== "not_available" && data.spi != null;

/** Each part is filled by the share attempted so far (attempted ÷ held), so an empty part means nothing attempted yet. */
const attemptedShare = (p: { attempted: number; total: number }) => (p.total > 0 ? Math.min(1, p.attempted / p.total) : 0);
const SPI_PARTS: { label: string; weight: number; fill: (d: StudentScorecard) => number }[] = [
  { label: "CQ", weight: 10, fill: (d) => attemptedShare(d.eligibility.classroom) },
  { label: "MQ", weight: 15, fill: (d) => attemptedShare(d.eligibility.module) },
  { label: "SA", weight: 25, fill: (d) => attemptedShare(d.eligibility.skillAssessment) },
  { label: "FSA", weight: 50, fill: (d) => (d.eligibility.finalAssessment === "met" ? 1 : 0) },
];

function SpiCard({ data }: { data: StudentScorecard }) {
  const ready = spiReady(data);
  const fill = ready ? Math.max(0, Math.min(10, data.spi!)) * 10 : 0;
  return (
    <Card>
      <CardTitle icon={ICONS.chart}>Your SPI Score</CardTitle>
      {ready ? (
        <div className="relative mx-auto mt-2 h-[106px] w-[200px]">
          <svg width="200" height="106" viewBox="0 0 200 106" aria-hidden>
            <defs>
              <linearGradient id="spiArc" x1="0" x2="1">
                <stop offset="0" stopColor="#2563EB" />
                <stop offset="1" stopColor="#60A5FA" />
              </linearGradient>
            </defs>
            <path d="M 16 98 A 84 84 0 0 1 184 98" fill="none" stroke="#EEF2F8" strokeWidth="14" strokeLinecap="round" />
            <path d="M 16 98 A 84 84 0 0 1 184 98" fill="none" stroke="url(#spiArc)" strokeWidth="14" strokeLinecap="round" pathLength={100} strokeDasharray={`${fill} 100`} />
          </svg>
          <p className="absolute inset-x-0 bottom-0.5 text-center text-[34px] font-extrabold tabular-nums text-[#0B1F4D]">
            {data.spi!.toFixed(2)} <small className="text-[13px] font-medium text-[#6B7280]">/ 10</small>
          </p>
        </div>
      ) : (
        <>
          <p className="mt-3 text-[34px] font-extrabold leading-none text-[#0B1F4D]">In Progress</p>
          <p className="mt-1.5 text-xs text-[#6B7280]">Calculated once all assessment types are complete</p>
          <div className="mt-[22px] flex gap-1">
            {SPI_PARTS.map((p) => {
              const share = p.fill(data);
              return (
                <div key={p.label} className="grid min-w-0 gap-1.5" style={{ flex: p.weight }} title={`${p.label}: ${Math.round(share * 100)}% attempted`}>
                  <i className="block h-3 overflow-hidden rounded-full bg-[#E2E8F0]">
                    <i className="block h-full rounded-full bg-gradient-to-r from-[#2563EB] to-[#60A5FA]" style={{ width: `${share * 100}%` }} />
                  </i>
                  <span className={`text-center text-[11px] font-semibold ${share > 0 ? "text-[#2563EB]" : "text-[#94A3B8]"}`}>{p.label}</span>
                </div>
              );
            })}
          </div>
        </>
      )}
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
      <p className="mt-4 flex items-center gap-[7px] rounded-lg bg-[#EAF1FF] px-2.5 py-1.5 text-[11.5px] text-[#0B1F4D]">
        <span className="text-[#2563EB]"><Icon d={ICONS.info} className="!h-[15px] !w-[15px]" /></span>
        Calculated on NIAT course sessions only
      </p>
    </Card>
  );
}

/** A course needs attention when its classroom quiz, module quiz or Skill Assessment average so far is below 50% (missed ones count as 0). */
const lowPart = (p: QuizPart | null) => p != null && p.avgPct < 50;
const needsAttention = (c: ScorecardCourse) => lowPart(c.classroom) || lowPart(c.module) || lowPart(c.skillAssessment);

function NeedsAttentionCard({ data, onOpen }: { data: StudentScorecard; onOpen: () => void }) {
  const attention = data.courses.filter(needsAttention).length;
  const noQuizzes = data.courses.filter((c) => !c.classroom && !c.module && !c.skillAssessment).length;
  const onTrack = data.courses.length - attention - noQuizzes;
  const segments = [
    { label: "Needs attention", n: attention, color: "#F59E0B" },
    { label: "On track", n: onTrack, color: "#22C55E" },
    { label: "No scores yet", n: noQuizzes, color: "#CBD5E1" },
  ];
  return (
    <Card className={attention ? "!border-[#F8DFB0] bg-gradient-to-b from-[#FFFBF2] to-[#FFF4DE]" : "!border-[#BBF7D0] !bg-[#F0FDF4]"}>
      <CardTitle icon={ICONS.gauge} color={attention ? "#D97706" : "#16A34A"}>Needs Attention</CardTitle>
      <p className={`mt-3 text-[34px] font-extrabold leading-none tabular-nums ${attention ? "text-[#D97706]" : "text-[#16A34A]"}`}>
        {attention ? `${attention} of ${data.courses.length} ${data.courses.length === 1 ? "course" : "courses"}` : "None"}
      </p>
      <p className="mt-1.5 text-xs text-[#6B7280]">{attention ? "average below 50% so far" : "All averages are 50% or more"}</p>
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
      {attention > 0 && (
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
/*  Pop-ups                                                            */
/* ------------------------------------------------------------------ */
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

function NeedsAttentionDialog({ data, onClose }: { data: StudentScorecard; onClose: () => void }) {
  const courses = data.courses.filter(needsAttention);
  const part = (p: QuizPart | null) =>
    p ? (
      <>
        {p.avgPct}% <small className="text-[#6B7280]">({p.attempted} of {p.total})</small>
      </>
    ) : (
      "—"
    );
  const toDo = (c: ScorecardCourse) => {
    const pending = [
      c.classroom && c.classroom.total > c.classroom.attempted ? `${c.classroom.total - c.classroom.attempted} classroom` : null,
      c.module && c.module.total > c.module.attempted ? `${c.module.total - c.module.attempted} module` : null,
    ].filter(Boolean);
    return pending.length ? `Attempt ${pending.join(" + ")} pending quizzes` : "Improve your quiz scores";
  };
  return (
    <Overlay onClose={onClose} className="place-items-center p-4">
      <div className="max-h-[90vh] w-full max-w-[820px] overflow-y-auto rounded-[18px] bg-white shadow-[0_24px_60px_rgba(11,31,77,0.25)]">
        <div className="flex items-center gap-3 border-b border-[#F8DFB0] bg-gradient-to-b from-[#FFFBF2] to-[#FFF4DE] px-[22px] py-[18px]">
          <span className="text-[#D97706]"><Icon d={ICONS.gauge} className="!h-[26px] !w-[26px]" /></span>
          <div>
            <h2 className="text-lg font-bold text-[#0B1F4D]">Needs attention · {plural(courses.length, "course", "courses")}</h2>
            <p className="mt-0.5 text-xs text-[#6B7280]">There is still time: every quiz you attempt from now lifts your average</p>
          </div>
          <CloseButton onClose={onClose} />
        </div>
        <div className="px-[22px] pb-[22px] pt-[18px]">
          <div className="overflow-x-auto rounded-[10px] border border-[#E6ECF5]">
            <table className="w-full min-w-[720px] border-collapse text-[12.5px] tabular-nums">
              <thead>
                <tr className="bg-[#EAF1FF] text-left text-[11.5px] text-[#0B1F4D]">
                  {["Course", "Classroom Quizzes", "Module Quizzes", "Skill Assessments (best)", "What to do"].map((h) => (
                    <th key={h} className="px-3 py-[9px] font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {courses.map((c) => (
                  <tr key={c.name} className="border-t border-[#F1F4F9]">
                    <td className="px-3 py-2.5 font-medium text-[#0B1F4D]">{c.name}</td>
                    <td className="px-3 py-2.5">{part(c.classroom)}</td>
                    <td className="px-3 py-2.5">{part(c.module)}</td>
                    <td className="px-3 py-2.5">{part(c.skillAssessment)}</td>
                    <td className="px-3 py-2.5">{toDo(c)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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

function EligibilityStrip({ data }: { data: StudentScorecard }) {
  const e = data.eligibility;
  const share = (p: { attempted: number; total: number }) => (p.total > 0 ? `${Math.round((p.attempted / p.total) * 100)}%` : "—");
  const rows: [string, CriterionState, string][] = [
    ["Attendance · 80% per course", e.attendance, data.attendance.coursesBelow > 0 ? `${data.attendance.coursesBelow} courses below` : e.attendance === "met" ? "Met" : "—"],
    ["Classroom Quizzes · 100% completion", e.classroom.state, e.classroom.total > 0 ? `${share(e.classroom)} completed` : "—"],
    ["Module Quizzes · 100% completion", e.module.state, e.module.total > 0 ? `${share(e.module)} completed` : "—"],
    ["Skill Assessments · 100% completion", e.skillAssessment.state, e.skillAssessment.total > 0 ? `${share(e.skillAssessment)} completed` : "Unavailable"],
    ["Final Skill Assessment · mandatory", e.finalAssessment, e.finalAssessment === "not_available" ? "Upcoming" : e.finalAssessment === "met" ? "Met" : "Not met"],
  ];
  return (
    <Card>
      <CardTitle icon={ICONS.shield}>Eligibility Status</CardTitle>
      <ul className="mt-3 grid gap-3 tabular-nums sm:grid-cols-2 lg:grid-cols-5">
        {rows.map(([title, state, value]) => (
          <li key={title} className="grid grid-cols-[26px_1fr] items-center gap-x-2.5 gap-y-1 rounded-xl border border-[#E6ECF5] px-[13px] py-[11px]">
            <StateDot state={state} />
            {/* Name on one line, the requirement on the next, so every box breaks the same way. */}
            <span className="text-xs leading-snug">
              {title.split(" · ")[0]}
              <span className="block text-[#6B7280]">{title.split(" · ")[1]}</span>
            </span>
            <b className="text-[15px] font-bold text-[#0B1F4D]">{value}</b>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Course-wise progress (no score / level / points mid-semester)      */
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
        <span className="text-[15px]">Course-wise Progress</span>
      </CardTitle>
      <div className="mt-3 overflow-x-auto rounded-xl border border-[#E6ECF5]">
        <table className="w-full min-w-[900px] border-collapse text-[12.5px] tabular-nums">
          <thead>
            <tr>
              <th colSpan={3} className="bg-[#DCE6FB]" />
              <th colSpan={4} className={`bg-[#DCE6FB] px-2.5 py-2 text-xs font-bold text-[#0B1F4D] ${sep}`}>Assessments (weight in SPI)</th>
              <th className={`bg-[#DCE6FB] ${sep}`} />
            </tr>
            <tr>
              <th className={th}>#</th>
              <th className={`${th} !text-left`}>Course</th>
              <th className={th}>Attendance</th>
              <th className={`${th} ${sep}`}>Classroom Quizzes<span className={sub}>10%</span></th>
              <th className={th}>Module Quizzes<span className={sub}>15%</span></th>
              <th className={th}>Skill Assessments<span className={sub}>25% · best score</span></th>
              <th className={th}>Final Skill Assessment<span className={sub}>50%</span></th>
              <th className={`${th} ${sep}`}>Course Weight<span className={sub}>credits</span></th>
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
                  <td className={td}>{c.skillAssessment ? <QuizCell part={c.skillAssessment} /> : <Chip tone="grey">Unavailable</Chip>}</td>
                  <td className={td}><Chip tone="grey">Upcoming</Chip></td>
                  <td className={`${td} ${sep}`}>
                    {c.weight == null ? (
                      <Chip tone="grey">Not set</Chip>
                    ) : (
                      <span className="inline-grid h-6 min-w-[26px] place-items-center rounded-[7px] bg-[#EAF1FF] px-1.5 font-bold text-[#2563EB]">{c.weight}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
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
/*  How SPI Score works: one pop-up; the content scrolls inside it    */
/* ------------------------------------------------------------------ */
type GuideSection = "elig" | "weight" | "calc" | "levels" | "att";

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

const ATTENDANCE_ROWS: [string, Tone, string][] = [
  ["Eligible", "green", "80% or more"],
  ["Recovery Eligible", "amber", "60–79%: Recovery Mode, attend recovery classes"],
  ["At Risk", "orange", "50–59%"],
  ["Ineligible", "red", "Below 50%"],
];

const GUIDE_SECTIONS: { id: GuideSection; title: string; icon: string }[] = [
  { id: "elig", title: "Eligibility Criteria", icon: ICONS.shield },
  { id: "weight", title: "SPI Weightage", icon: ICONS.pie },
  { id: "calc", title: "SPI Calculation", icon: ICONS.calc },
  { id: "levels", title: "Skill Level & Points", icon: ICONS.trophy },
  { id: "att", title: "Attendance Status", icon: ICONS.cal },
];

function GuideSectionBody({ id, data }: { id: GuideSection; data: StudentScorecard }) {
  switch (id) {
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
              {spiReady(data)
                ? `Your SPI = ${data.totalWeightedPoints} ÷ ${data.totalWeight} = ${data.spi!.toFixed(2)} / 10`
                : "Your SPI: calculated once all assessment types are complete"}
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
    case "att":
      return (
        <>
          <p className="mb-3 text-[12.5px]">Your attendance status comes from your lowest course. Attendance is calculated on NIAT course sessions only.</p>
          <table className="w-full border-collapse text-[12.5px]">
            <tbody>
              {ATTENDANCE_ROWS.map(([label, tone, meaning]) => (
                <tr key={label}>
                  <td className="w-[45%] border-b border-[#F1F4F9] px-2 py-[7px]"><Tag tone={tone}>{label}</Tag></td>
                  <td className="border-b border-[#F1F4F9] px-2 py-[7px]">{meaning}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      );
  }
}

function SpiGuide({ data, onClose }: { data: StudentScorecard; onClose: () => void }) {
  const scroller = useRef<HTMLDivElement>(null);
  const sections = useRef<Partial<Record<GuideSection, HTMLElement | null>>>({});
  const [current, setCurrent] = useState<GuideSection>(GUIDE_SECTIONS[0].id);

  const jump = (id: GuideSection) => {
    const box = scroller.current, el = sections.current[id];
    if (box && el) box.scrollTo({ top: el.offsetTop - box.offsetTop });
    setCurrent(id);
  };

  const onScroll = () => {
    const box = scroller.current;
    if (!box) return;
    // At the bottom the last (short) sections can't reach the top: mark the last one.
    if (box.scrollTop + box.clientHeight >= box.scrollHeight - 4) {
      setCurrent(GUIDE_SECTIONS[GUIDE_SECTIONS.length - 1].id);
      return;
    }
    const passed = GUIDE_SECTIONS.filter((s) => (sections.current[s.id]?.offsetTop ?? Infinity) - box.offsetTop <= box.scrollTop + 40);
    if (passed.length) setCurrent(passed[passed.length - 1].id);
  };

  return (
    <Overlay onClose={onClose} className="place-items-center p-4">
      <div className="grid max-h-[88vh] w-full max-w-[760px] animate-page-in grid-rows-[auto_auto_minmax(0,1fr)] overflow-hidden rounded-[18px] bg-white shadow-[0_24px_60px_rgba(11,31,77,0.25)]">
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
      </div>
    </Overlay>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                              */
/* ------------------------------------------------------------------ */
export default function StudentReportView({ data }: { data: StudentScorecard }) {
  const [attentionOpen, setAttentionOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const midSemester = !spiReady(data);
  return (
    <div className="min-h-screen bg-[#F4F7FD] text-[13px] text-[#334155]" style={{ fontFamily: '"Inter", system-ui, sans-serif' }}>
      <main className="mx-auto grid max-w-[1480px] grid-cols-[minmax(0,1fr)] gap-4 px-4 py-[22px] sm:px-8">
        <header className="flex flex-wrap items-center gap-3.5">
          <span className="text-[#2563EB]"><Icon d={ICONS.chart} className="!h-8 !w-8" /></span>
          <div>
            <h1 className="text-[22px] font-bold text-[#0B1F4D]">{midSemester ? "NIAT - SPI Progress Report" : "NIAT - SPI Student Report Card"}</h1>
            <p className="mt-0.5 text-[13px]">Skill Performance Index{midSemester ? " · Semester in progress" : ""}</p>
          </div>
          <p className="ml-auto text-[17px] font-bold text-[#0B1F4D]">{data.studentName}</p>
        </header>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-[1.15fr_1fr_1fr]">
          <SpiCard data={data} />
          <AttendanceCard attendance={data.attendance} />
          <NeedsAttentionCard data={data} onOpen={() => setAttentionOpen(true)} />
        </div>

        <EligibilityStrip data={data} />

        <CourseTable data={data} onOpenGuide={() => setGuideOpen(true)} />
      </main>

      {attentionOpen && <NeedsAttentionDialog data={data} onClose={() => setAttentionOpen(false)} />}
      {guideOpen && <SpiGuide data={data} onClose={() => setGuideOpen(false)} />}
    </div>
  );
}
