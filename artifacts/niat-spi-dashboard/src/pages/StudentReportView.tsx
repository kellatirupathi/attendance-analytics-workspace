import { useMemo, type ReactNode } from "react";
import { AlertTriangle, Check } from "lucide-react";
import { computeSpiScore } from "@/lib/spiScore";
import {
  ATTENDANCE_TIERS,
  eligibilityAttendancePct,
  getTier,
  sessionsShortOfTarget,
  TIER_ELIGIBLE,
} from "@/lib/attendanceTiers";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export interface ReportCourse {
  name: string | null;
  attended: number;
  total: number;
  pct: number;
}

interface StudentReportViewProps {
  name: string;
  userId: string;
  campus: string;
  section: string;
  attendancePct: number;
  attended: number;
  totalSessions: number;
  courses: ReportCourse[];
  classroomAttempted: number;
  classroomTotal: number;
  classroomAvg: number;
  moduleAttempted: number;
  moduleTotal: number;
  moduleAvg: number;
  pendingCount: number;
  notice: string | null;
  onRequestCorrection: () => void;
  onMyRequests: () => void;
}

const PAUSED = [
  "MINT",
  "BRAVE",
  "GRIT",
  "Placements",
  "Internships",
  "Co-curricular support",
];

function formatUpdated(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(date);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const hour = pick("hour");
  const minute = pick("minute");
  const dayPeriod = pick("dayPeriod").toUpperCase();
  return `${pick("day")} ${pick("month")} ${pick("year")}, ${hour}:${minute} ${dayPeriod} IST`;
}

function ratioPct(done: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((done / total) * 100);
}

function oneDecimal(value: number): string {
  return value.toFixed(1);
}

function courseLabel(name: string | null | undefined): string {
  return (name ?? "").trim();
}

function namedCourse(name: string | null | undefined): boolean {
  const trimmed = courseLabel(name);
  return trimmed.length > 0 && trimmed.toLowerCase() !== "null";
}

function dataIssue(name: string | null | undefined, pct: number): boolean {
  const trimmed = courseLabel(name);
  return pct === 0 || trimmed.length === 0 || /quizzes$/i.test(trimmed);
}

function MarkerBar({ pct, color }: { pct: number; color: string }) {
  const width = Math.max(0, Math.min(100, pct));
  return (
    <div className="relative h-2 rounded-full bg-[#E5E7EB]">
      <div
        className="h-full rounded-full"
        style={{ width: `${width}%`, backgroundColor: color }}
      />
      <span
        className="absolute top-[-3px] h-[14px] w-[2px] bg-black"
        style={{ left: `${TIER_ELIGIBLE}%` }}
        aria-hidden
      />
    </div>
  );
}

function StatusBadge({
  label,
  tone,
}: {
  label: string;
  tone: "met" | "not_met" | "upcoming";
}) {
  const style =
    tone === "met"
      ? { color: "#1E7F4F", backgroundColor: "#E7F5EE" }
      : tone === "not_met"
        ? { color: "#B91C1C", backgroundColor: "#FDECEC" }
        : { color: "#4B5563", backgroundColor: "#F3F4F6" };
  return (
    <span
      className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide"
      style={style}
    >
      {label}
    </span>
  );
}

export default function StudentReportView(props: StudentReportViewProps) {
  const courses = useMemo(
    () =>
      props.courses
        .filter((course) => namedCourse(course.name))
        .sort((a, b) => a.pct - b.pct || courseLabel(a.name).localeCompare(courseLabel(b.name))),
    [props.courses],
  );
  // Sessions with a blank or "null" course still count in the headline attendance,
  // so show them as one row to keep the table adding up to the headline.
  const unlinked = useMemo(() => {
    let attended = 0;
    let total = 0;
    for (const course of props.courses) {
      if (namedCourse(course.name)) continue;
      attended += course.attended;
      total += course.total;
    }
    return total > 0 ? { attended, total, pct: (attended / total) * 100 } : null;
  }, [props.courses]);
  const tierPct = eligibilityAttendancePct(
    props.attendancePct,
    courses.map((course) => course.pct),
    "overall",
  );
  const tier = getTier(tierPct);
  const coursesAtTarget = courses.filter((course) => course.pct >= TIER_ELIGIBLE).length;
  const coursesBelow = courses.filter((course) => course.pct < TIER_ELIGIBLE);
  const attendanceMet = courses.length > 0 && coursesBelow.length === 0;
  const classroomPct = ratioPct(props.classroomAttempted, props.classroomTotal);
  const modulePct = ratioPct(props.moduleAttempted, props.moduleTotal);
  const classroomMet =
    props.classroomTotal > 0 && props.classroomAttempted >= props.classroomTotal;
  const moduleMet = props.moduleTotal > 0 && props.moduleAttempted >= props.moduleTotal;
  const spi = computeSpiScore(props.classroomAvg, props.moduleAvg, 0, 0);
  const spiColor =
    spi.points >= 7 ? "#1E7F4F" : spi.points >= 5 ? "#B45309" : "#B91C1C";
  const fullyEligible = attendanceMet && classroomMet && moduleMet;
  const noAttendance = props.totalSessions === 0;

  const steps: string[] = [];
  if (coursesBelow.length > 0) {
    const countLabel =
      coursesBelow.length === courses.length
        ? `all ${coursesBelow.length} course${coursesBelow.length === 1 ? "" : "s"}`
        : `${coursesBelow.length} course${coursesBelow.length === 1 ? "" : "s"}`;
    steps.push(
      `Attend recovery classes for ${countLabel}. Skipping them turns the course into a Skill Debt.`,
    );
  }
  if (!classroomMet && props.classroomTotal > props.classroomAttempted) {
    const left = props.classroomTotal - props.classroomAttempted;
    steps.push(
      `Complete ${left} classroom quiz${left === 1 ? "" : "zes"}`,
    );
  }
  if (!moduleMet && props.moduleTotal > props.moduleAttempted) {
    const left = props.moduleTotal - props.moduleAttempted;
    steps.push(
      `Complete ${left} module quiz${left === 1 ? "" : "zes"} before the Final Skill Assessment`,
    );
  }
  const visibleSteps = steps.slice(0, 3);

  const classroomKnown = props.classroomTotal > 0;
  const moduleKnown = props.moduleTotal > 0;
  const classroomForSkill = classroomKnown ? props.classroomAvg : null;
  const moduleForSkill = moduleKnown ? props.moduleAvg : null;
  const skillDebt =
    (classroomForSkill == null && moduleForSkill == null) ||
    Math.min(classroomForSkill ?? 100, moduleForSkill ?? 100) < 50;

  const meta = [
    props.campus || "Campus unavailable",
    props.section || "Batch / section unavailable",
  ].join(" · ");

  return (
    <div
      className="min-h-screen bg-[#F3F4F7] text-[#1F2937]"
      style={{ fontFamily: '"DM Sans", system-ui, sans-serif' }}
    >
      <div className="mx-auto max-w-[1280px] px-4 py-6 sm:px-6 sm:py-8">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 lg:max-w-[420px]">
            <h1
              className="truncate text-[32px] font-bold leading-none text-[#111827] sm:text-[36px]"
              style={{ fontFamily: '"Fraunces", Georgia, serif' }}
            >
              {props.name}
            </h1>
            <p className="mt-2 text-sm text-[#4B5563]">{meta}</p>
            <p className="mt-2 flex items-center gap-2 text-sm text-[#374151]">
              <span className="h-2 w-2 shrink-0 rounded-full bg-[#1E7F4F]" aria-hidden />
              Updated {formatUpdated(new Date())} · Classes in progress
            </p>
          </div>

          <section
            className="w-full rounded-2xl bg-white px-4 py-3 lg:min-w-[460px] lg:flex-1"
            aria-label="SPI eligibility status"
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-[11px] font-semibold tracking-[0.14em] text-[#4B5563]">
                SPI ELIGIBILITY STATUS
              </p>
              <p className="text-sm font-semibold text-[#111827]">
                Attendance {oneDecimal(tierPct)}%
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {ATTENDANCE_TIERS.map((item) => {
                const active = item.id === tier.id;
                return (
                  <div
                    key={item.id}
                    className="flex min-h-11 items-center justify-center rounded-xl px-2 py-1.5 text-center text-xs font-semibold leading-tight"
                    style={
                      active
                        ? { backgroundColor: item.color, color: "#FFFFFF" }
                        : { backgroundColor: "#F3F4F6", color: "#4B5563" }
                    }
                  >
                    <span>
                      {active ? "✓ " : ""}
                      {item.label}
                      <span className="mt-0.5 block text-[10px] font-medium opacity-90">
                        {item.hint}
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
          </section>

          <div className="flex shrink-0 flex-col items-stretch gap-2 lg:w-[230px]">
            <button
              type="button"
              onClick={props.onRequestCorrection}
              className="min-h-11 rounded-xl bg-[#F25C05] px-4 text-sm font-semibold text-white hover:bg-[#D24E04]"
            >
              Request attendance correction
            </button>
            <button
              type="button"
              onClick={props.onMyRequests}
              className="min-h-11 text-sm font-semibold text-[#C2410C] underline-offset-2 hover:underline"
            >
              My requests ({props.pendingCount} pending)
            </button>
          </div>
        </header>

        {props.notice && (
          <p className="mt-4 rounded-xl bg-[#E7F5EE] px-4 py-3 text-sm text-[#1E7F4F]">
            {props.notice}
          </p>
        )}

        <section className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-6 lg:grid-cols-5">
          <StatCard
            className="sm:col-span-2 lg:col-span-1"
            title="Attendance"
            badge={attendanceMet ? "MET" : "NOT MET"}
            tone={attendanceMet ? "met" : "not_met"}
            value={noAttendance ? "—" : `${oneDecimal(props.attendancePct)}%`}
            hint="target 80%"
            bar={
              noAttendance ? null : (
                <MarkerBar pct={props.attendancePct} color={tier.color} />
              )
            }
            footer={
              noAttendance
                ? "No classes recorded yet"
                : `${props.attended} / ${props.totalSessions} sessions · ${coursesAtTarget} of ${courses.length} courses at ${TIER_ELIGIBLE}%`
            }
          />
          <StatCard
            className="sm:col-span-2 lg:col-span-1"
            title="Classroom Quizzes"
            badge={classroomMet ? "MET" : "NOT MET"}
            tone={classroomMet ? "met" : "not_met"}
            value={props.classroomTotal === 0 ? "—" : `${classroomPct}%`}
            hint="attempted · need 100%"
            bar={<MarkerBar pct={classroomPct} color={getTier(classroomPct).color} />}
            footer={
              <span className="flex items-center justify-between gap-2">
                <span>
                  {props.classroomAttempted} / {props.classroomTotal} · 10% weight
                </span>
                <AvgText pct={props.classroomAvg} />
              </span>
            }
          />
          <StatCard
            className="sm:col-span-2 lg:col-span-1"
            title="Module Quizzes"
            badge={moduleMet ? "MET" : "NOT MET"}
            tone={moduleMet ? "met" : "not_met"}
            value={props.moduleTotal === 0 ? "—" : `${modulePct}%`}
            hint="completed · need 100%"
            bar={<MarkerBar pct={modulePct} color={getTier(modulePct).color} />}
            footer={
              <span className="flex items-center justify-between gap-2">
                <span>
                  {props.moduleAttempted} / {props.moduleTotal} · 15% weight
                </span>
                <AvgText pct={props.moduleAvg} />
              </span>
            }
          />
          <StatCard
            className="sm:col-span-3 lg:col-span-1"
            title="Skill Assessments"
            badge="UPCOMING"
            tone="upcoming"
            value="—"
            hint="need 100%"
            bar={null}
            footer={
              <span className="flex items-center justify-between gap-2">
                <span>Opens [Date TBA] · 25% weight</span>
                <span>Avg —</span>
              </span>
            }
          />
          <StatCard
            className="sm:col-span-3 lg:col-span-1"
            title="Final Assessment"
            badge="UPCOMING"
            tone="upcoming"
            value="—"
            hint="mandatory"
            bar={null}
            footer={
              <span className="flex items-center justify-between gap-2">
                <span>Opens [Date TBA] · 50% weight</span>
                <span>Score —</span>
              </span>
            }
          />
        </section>

        <div className="mt-5 flex flex-col gap-4 lg:flex-row">
          <div className="flex w-full flex-col gap-4 lg:w-[340px] lg:shrink-0">
            <section className="rounded-2xl bg-white p-5">
              <p className="text-[11px] font-semibold tracking-[0.14em] text-[#4B5563]">
                SKILL PERFORMANCE INDEX
              </p>
              <div className="mt-4 flex justify-center">
                <SpiRing points={spi.points} color={spiColor} />
              </div>
              {!fullyEligible && (
                <p className="mt-4 rounded-xl bg-[#FEF3E2] px-3 py-2 text-sm leading-relaxed text-[#9A3412]">
                  Provisional. SPI counts only once all eligibility criteria are met.
                </p>
              )}
            </section>

            <section className="rounded-2xl bg-[#141827] p-5 text-white">
              <h2
                className="text-2xl font-semibold"
                style={{ fontFamily: '"Fraunces", Georgia, serif' }}
              >
                Next steps
              </h2>
              {visibleSteps.length === 0 ? (
                <p className="mt-4 text-sm leading-relaxed text-white/90">
                  You're on track — keep attending every class.
                </p>
              ) : (
                <ol className="mt-4 space-y-3">
                  {visibleSteps.map((step, index) => (
                    <li key={step} className="flex gap-3 text-sm leading-relaxed">
                      <span
                        className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold"
                        style={{
                          backgroundColor: index === 0 ? "#F25C05" : "#374151",
                          color: "#FFFFFF",
                        }}
                      >
                        {index + 1}
                      </span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-4">
            <section className="rounded-2xl bg-white p-5">
              <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
                <h2
                  className="text-2xl font-semibold text-[#111827]"
                  style={{ fontFamily: '"Fraunces", Georgia, serif' }}
                >
                  Course attendance
                </h2>
                <p className="text-xs font-medium text-[#4B5563]">
                  Lowest first · target {TIER_ELIGIBLE}%
                </p>
              </div>
              {courses.length === 0 ? (
                <p className="py-8 text-sm text-[#4B5563]">No classes recorded yet</p>
              ) : (
                <>
                  <div className="hidden md:block">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="text-[11px] font-semibold tracking-wide text-[#4B5563]">
                          <th className="pb-2 font-semibold">COURSE</th>
                          <th className="pb-2 font-semibold">SESSIONS</th>
                          <th className="pb-2 font-semibold">ATTENDANCE</th>
                          <th className="pb-2 font-semibold">SHORT OF {TIER_ELIGIBLE}%</th>
                          <th className="pb-2 font-semibold">STATUS</th>
                        </tr>
                      </thead>
                      <tbody>
                        {courses.map((course) => (
                          <CourseRow key={course.name} course={course} />
                        ))}
                        {unlinked && (
                          <tr className="border-t border-[#F3F4F6] text-[#4B5563]">
                            <td className="py-3 pr-3 font-medium">
                              <span className="inline-flex items-center gap-1">
                                Other sessions (no course)
                                <DataWarning />
                              </span>
                            </td>
                            <td className="py-3 pr-3 tabular-nums">
                              {unlinked.attended} / {unlinked.total}
                            </td>
                            <td className="py-3 pr-3 tabular-nums">{oneDecimal(unlinked.pct)}%</td>
                            <td className="py-3 pr-3">—</td>
                            <td className="py-3 text-xs">Not a course</td>
                          </tr>
                        )}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-[#E5E7EB] font-semibold text-[#111827]">
                          <td className="pt-3 pr-3">Total</td>
                          <td className="pt-3 pr-3 tabular-nums">
                            {props.attended} / {props.totalSessions}
                          </td>
                          <td className="pt-3 pr-3 tabular-nums">{oneDecimal(props.attendancePct)}%</td>
                          <td className="pt-3 pr-3" />
                          <td className="pt-3" />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                  <ul className="space-y-3 md:hidden">
                    {courses.map((course) => (
                      <CourseCard key={course.name} course={course} />
                    ))}
                    {unlinked && (
                      <li className="rounded-xl border border-dashed border-[#E5E7EB] p-3 text-[#4B5563]">
                        <p className="font-medium">
                          Other sessions (no course)
                          <DataWarning />
                        </p>
                        <p className="mt-1 text-sm tabular-nums">
                          {oneDecimal(unlinked.pct)}% · {unlinked.attended} / {unlinked.total} sessions
                        </p>
                      </li>
                    )}
                    <li className="flex justify-between px-1 text-sm font-semibold text-[#111827]">
                      <span>Total</span>
                      <span className="tabular-nums">
                        {props.attended} / {props.totalSessions} · {oneDecimal(props.attendancePct)}%
                      </span>
                    </li>
                  </ul>
                  <p className="mt-3 text-xs text-[#4B5563]">
                    Short of {TIER_ELIGIBLE}% = extra sessions to attend in a row, with no further absences.
                    {unlinked &&
                      ` "Other sessions" were recorded without a course name. They count toward your overall attendance but not toward any course.`}
                  </p>
                </>
              )}
            </section>

            <section className="rounded-2xl bg-white p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <h2
                  className="text-2xl font-semibold text-[#111827]"
                  style={{ fontFamily: '"Fraunces", Georgia, serif' }}
                >
                  Skill Debt
                </h2>
                {skillDebt ? (
                  <span className="inline-flex min-h-8 items-center gap-1 rounded-full bg-[#FDECEC] px-3 text-xs font-semibold text-[#B91C1C]">
                    <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                    Skill Debt
                  </span>
                ) : (
                  <span className="inline-flex min-h-8 items-center gap-1 rounded-full bg-[#E7F5EE] px-3 text-xs font-semibold text-[#1E7F4F]">
                    <Check className="h-3.5 w-3.5" aria-hidden />
                    No active Skill Debts
                  </span>
                )}
              </div>
              <div className="mt-4 grid gap-6 md:grid-cols-2">
                <div>
                  <p className="text-xs font-bold tracking-wide text-[#B91C1C]">
                    A SKILL DEBT IS CREATED IF YOU
                  </p>
                  <ul className="mt-3 space-y-2 text-sm text-[#1F2937]">
                    <li>
                      • Skip assigned recovery classes
                      {coursesBelow.length > 0 && (
                        <span className="font-semibold text-[#B91C1C]">
                          {" "}
                          · applies to you now
                        </span>
                      )}
                    </li>
                    <li>• Score below 50% in, or miss, the Final Skill Assessment</li>
                    <li>• Don't meet eligibility by the end of the skill cycle</li>
                  </ul>
                </div>
                <div>
                  <p className="text-xs font-bold tracking-wide text-[#4B5563]">
                    WHILE A SKILL DEBT IS ACTIVE, THESE ARE PAUSED
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {PAUSED.map((item) => (
                      <span
                        key={item}
                        className="rounded-full border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-1 text-sm font-medium text-[#374151]"
                      >
                        {item}
                      </span>
                    ))}
                  </div>
                  <p className="mt-4 text-sm leading-relaxed text-[#4B5563]">
                    Debts must be cleared within 2 years by attending recovery classes and re-sitting the Final Skill Assessment.
                  </p>
                </div>
              </div>
            </section>
          </div>
        </div>

        <p className="mt-8 text-center text-sm text-[#4B5563]">
          Need help or spotted something off?{" "}
          <a
            className="font-semibold text-[#1D4ED8] underline"
            href="mailto:learning.support@nxtwave.co.in"
          >
            learning.support@nxtwave.co.in
          </a>
        </p>
      </div>
    </div>
  );
}

function AvgText({ pct }: { pct: number }) {
  const tier = getTier(pct);
  return (
    <span className="font-semibold" style={{ color: tier.color }}>
      Avg {oneDecimal(pct)}%
    </span>
  );
}

function StatCard({
  className,
  title,
  badge,
  tone,
  value,
  hint,
  bar,
  footer,
}: {
  className?: string;
  title: string;
  badge: string;
  tone: "met" | "not_met" | "upcoming";
  value: string;
  hint: string;
  bar: ReactNode;
  footer: ReactNode;
}) {
  const border =
    tone === "met" ? "#1E7F4F" : tone === "not_met" ? "#B91C1C" : "#D1D5DB";
  return (
    <article
      className={`rounded-2xl border-t-4 bg-white p-4 ${className ?? ""}`}
      style={{ borderTopColor: border }}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold leading-5 text-[#111827]">{title}</h3>
        <StatusBadge label={badge} tone={tone} />
      </div>
      <p
        className="mt-3 text-4xl font-bold leading-none"
        style={{
          fontFamily: '"Fraunces", Georgia, serif',
          color: tone === "upcoming" || value === "—" ? "#9CA3AF" : "#111827",
        }}
      >
        {value}
      </p>
      <p className="mt-2 text-xs text-[#4B5563]">{hint}</p>
      <div className="mt-3 min-h-2">{bar}</div>
      <div className="mt-3 text-xs text-[#374151]">{footer}</div>
    </article>
  );
}

function SpiRing({ points, color }: { points: number; color: string }) {
  const size = 168;
  const stroke = 14;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const filled = Math.max(0, Math.min(1, points / 10));
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#E5E7EB" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeDasharray={`${c * filled} ${c}`}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          className="text-5xl font-bold leading-none"
          style={{ fontFamily: '"Fraunces", Georgia, serif', color }}
        >
          {points.toFixed(1)}
        </span>
        <span className="mt-1 text-sm text-[#4B5563]">out of 10</span>
      </div>
    </div>
  );
}

function CourseStatus({ course }: { course: ReportCourse }) {
  const courseTier = getTier(course.pct);
  const short = sessionsShortOfTarget(course.attended, course.total);
  const warn = dataIssue(course.name, course.pct);
  return { courseTier, short, warn };
}

function CourseRow({ course }: { course: ReportCourse }) {
  const { courseTier, short, warn } = CourseStatus({ course });
  return (
    <tr className="border-t border-[#F3F4F6]">
      <td className="py-3 pr-3 font-medium text-[#111827]">
        <span className="inline-flex items-center gap-1">
          {course.name || "Unnamed course"}
          {warn && <DataWarning />}
        </span>
      </td>
      <td className="py-3 pr-3 tabular-nums text-[#374151]">
        {course.attended} / {course.total}
      </td>
      <td className="py-3 pr-3">
        <div className="flex items-center gap-2">
          <div className="w-24">
            <MarkerBar pct={course.pct} color={courseTier.color} />
          </div>
          <span className="font-semibold tabular-nums" style={{ color: courseTier.color }}>
            {oneDecimal(course.pct)}%
          </span>
        </div>
      </td>
      <td className="py-3 pr-3 font-medium text-[#B91C1C]">
        {short > 0 ? `+${short} sessions` : "—"}
      </td>
      <td className="py-3">
        <span
          className="inline-flex rounded-full px-2 py-1 text-[10px] font-bold tracking-wide"
          style={{ color: courseTier.color, backgroundColor: courseTier.bg }}
        >
          {courseTier.label.toUpperCase()}
        </span>
      </td>
    </tr>
  );
}

function CourseCard({ course }: { course: ReportCourse }) {
  const { courseTier, short, warn } = CourseStatus({ course });
  return (
    <li className="rounded-xl border border-[#E5E7EB] p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium text-[#111827]">
          {course.name || "Unnamed course"}
          {warn && <DataWarning />}
        </p>
        <span
          className="shrink-0 rounded-full px-2 py-1 text-[10px] font-bold"
          style={{ color: courseTier.color, backgroundColor: courseTier.bg }}
        >
          {courseTier.label.toUpperCase()}
        </span>
      </div>
      <p className="mt-2 text-sm font-semibold" style={{ color: courseTier.color }}>
        {oneDecimal(course.pct)}% · {course.attended} / {course.total} sessions
      </p>
      <div className="mt-2">
        <MarkerBar pct={course.pct} color={courseTier.color} />
      </div>
      <p className="mt-2 text-xs text-[#374151]">
        Short of {TIER_ELIGIBLE}%: {short > 0 ? `+${short} sessions` : "—"}
      </p>
    </li>
  );
}

function DataWarning() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="ml-1 inline-flex h-6 w-6 items-center justify-center text-[#B45309]"
          aria-label="This may be a data issue — contact support."
        >
          <AlertTriangle className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent>This may be a data issue — contact support.</TooltipContent>
    </Tooltip>
  );
}
