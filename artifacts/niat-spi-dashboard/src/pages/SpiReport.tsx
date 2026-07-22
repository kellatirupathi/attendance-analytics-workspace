import { useMemo, useState } from "react";
import { useParams } from "wouter";
import {
  useFetchStudentOverview,
  getFetchStudentOverviewQueryKey,
  useFetchStudentSubjects,
  getFetchStudentSubjectsQueryKey,
  useFetchStudentRecentSessions,
  getFetchStudentRecentSessionsQueryKey,
  useFetchStudentQuizzes,
  getFetchStudentQuizzesQueryKey,
  type SubjectAttendance,
  type QuizItem,
} from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { pctColor, pctTextColor, cn } from "@/lib/utils";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Calendar as CalendarIcon,
  ChevronRight,
  BookOpen,
  ClipboardList,
  Briefcase,
  Users,
  Star,
  CalendarPlus,
  Plus,
  Trash2,
  Pencil,
  X,
  Check,
} from "lucide-react";
import { format } from "date-fns";

const REQUIRED_PCT = 80;

/* ------------------------------------------------------------------ */
/*  Section wrapper — numbered, hairline-separated (editorial layout)  */
/* ------------------------------------------------------------------ */
function Section({
  num,
  title,
  aside,
  children,
}: {
  num: string;
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_10px_30px_-16px_rgba(0,0,0,0.1)] sm:p-8">
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-3">
          <span className="text-sm font-semibold tabular-nums text-brand-300">
            {num}
          </span>
          <h2 className="font-serif text-2xl font-semibold text-gray-900">
            {title}
          </h2>
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Attendance donut ring                                             */
/* ------------------------------------------------------------------ */
function Donut({ pct }: { pct: number }) {
  const size = 150;
  const stroke = 14;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = (Math.min(100, Math.max(0, pct)) / 100) * c;
  const color = pctColor(pct);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="#eceef2"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeDasharray={`${dash} ${c - dash}`}
          strokeLinecap="round"
          style={{ transition: "stroke-dasharray 1s cubic-bezier(.4,0,.2,1)" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          className="font-serif text-3xl font-bold leading-none"
          style={{ color: pctTextColor(pct) }}
        >
          {pct}%
        </span>
        <span className="mt-1 text-[10px] font-medium uppercase tracking-wide text-gray-400">
          this semester
        </span>
      </div>
    </div>
  );
}

const CONSEQUENCES = [
  { icon: BookOpen, label: "SPI", text: "Not earned this cycle" },
  { icon: ClipboardList, label: "Assessments", text: "Can't sit them" },
  { icon: Briefcase, label: "Placements", text: "Drives paused" },
  { icon: Users, label: "Internships", text: "Nominations paused" },
  { icon: Star, label: "MINT · BRAVE · GRIT", text: "On hold" },
];

type CategoryKey = "classroom" | "module" | "skill" | "final";

const SPI_CATEGORIES: {
  key: CategoryKey;
  label: string;
  weight: string;
  soon: boolean;
}[] = [
  { key: "classroom", label: "Classroom Quizzes", weight: "10%", soon: false },
  { key: "module", label: "Module Quizzes", weight: "15%", soon: false },
  { key: "skill", label: "Skill Assessments", weight: "25%", soon: true },
  { key: "final", label: "Final Assessment", weight: "50%", soon: true },
];

export default function SpiReport() {
  const { studentId } = useParams<{ studentId: string }>();
  const token =
    new URLSearchParams(window.location.search).get("t") ?? undefined;
  const params = token ? { t: token } : undefined;

  type Panel =
    | { type: "course"; subjectTitle: string }
    | { type: "category"; category: CategoryKey }
    | null;
  const [panel, setPanel] = useState<Panel>(null);
  const [sessionsEnabled, setSessionsEnabled] = useState(false);
  const openSubject = panel?.type === "course" ? panel.subjectTitle : null;

  const { data: overview, isLoading: overviewLoading } =
    useFetchStudentOverview(studentId || "", params, {
      query: {
        enabled: !!studentId,
        queryKey: getFetchStudentOverviewQueryKey(studentId || "", params),
      },
    });

  const { data: subjects, isLoading: subjectsLoading } =
    useFetchStudentSubjects(studentId || "", params, {
      query: {
        enabled: !!studentId,
        queryKey: getFetchStudentSubjectsQueryKey(studentId || "", params),
      },
    });

  const { data: quizzes, isLoading: quizzesLoading } = useFetchStudentQuizzes(
    studentId || "",
    params,
    {
      query: {
        enabled: !!studentId,
        queryKey: getFetchStudentQuizzesQueryKey(studentId || "", params),
      },
    },
  );

  const { data: recentSessions, isLoading: sessionsLoading } =
    useFetchStudentRecentSessions(studentId || "", params, {
      query: {
        enabled: !!studentId && sessionsEnabled,
        queryKey: getFetchStudentRecentSessionsQueryKey(
          studentId || "",
          params,
        ),
      },
    });

  const recoverySubjects = useMemo(
    () => (subjects ?? []).filter((s) => !s.meetsRequirement),
    [subjects],
  );
  const recoveryCount = recoverySubjects.length;

  const modalSessions = useMemo(
    () => (recentSessions ?? []).filter((s) => s.subjectTitle === openSubject),
    [recentSessions, openSubject],
  );
  const modalPresent = modalSessions.filter(
    (s) => s.attendanceStatus.toLowerCase() === "present",
  ).length;
  const modalAbsent = modalSessions.filter(
    (s) => s.attendanceStatus.toLowerCase() === "absent",
  ).length;

  const openSessions = (subjectTitle: string) => {
    setSessionsEnabled(true);
    setPanel({ type: "course", subjectTitle });
  };
  const openCategory = (category: CategoryKey) => {
    setPanel({ type: "category", category });
  };

  /* -------- Request Attendance (multi-date, accordion) -------- */
  type ReqRow = { date: string; reason: string };
  const [reqOpen, setReqOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reqRows, setReqRows] = useState<ReqRow[]>([{ date: "", reason: "" }]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [reqSubmitting, setReqSubmitting] = useState(false);
  const [reqDone, setReqDone] = useState<string | null>(null);
  const [reqError, setReqError] = useState<string | null>(null);

  const openRequest = () => {
    setReqRows([{ date: "", reason: "" }]);
    setActiveIndex(0);
    setReqError(null);
    setReqDone(null);
    setReqOpen(true);
  };

  // Save the current entry (must have a date) and open a fresh one.
  const addReqRow = () => {
    const cur = reqRows[activeIndex];
    if (!cur?.date) {
      setReqError("Pick a date for this entry before adding another.");
      return;
    }
    setReqError(null);
    setReqRows((r) => [...r, { date: "", reason: "" }]);
    setActiveIndex(reqRows.length);
  };

  const removeReqRow = (i: number) => {
    if (reqRows.length <= 1) return;
    setReqError(null);
    const filtered = reqRows.filter((_, idx) => idx !== i);
    setReqRows(filtered);
    setActiveIndex((prev) => {
      let next = i < prev ? prev - 1 : prev === i ? prev : prev;
      if (next > filtered.length - 1) next = filtered.length - 1;
      return Math.max(0, next);
    });
  };

  // Expand a saved entry for editing; discard the current one if it's empty.
  const focusRow = (i: number) => {
    if (i === activeIndex) return;
    setReqError(null);
    const cur = reqRows[activeIndex];
    const dropEmpty =
      !!cur && !cur.date && !cur.reason.trim() && reqRows.length > 1;
    if (dropEmpty) {
      const filtered = reqRows.filter((_, idx) => idx !== activeIndex);
      setReqRows(filtered);
      setActiveIndex(i > activeIndex ? i - 1 : i);
    } else {
      setActiveIndex(i);
    }
  };

  const setReqRow = (i: number, patch: Partial<ReqRow>) =>
    setReqRows((r) =>
      r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)),
    );

  const validRows = reqRows.filter((r) => r.date.trim() !== "");
  const activeHasDate = !!reqRows[activeIndex]?.date;

  const submitRequest = async () => {
    setReqSubmitting(true);
    setReqError(null);
    try {
      const qs = token ? `?t=${encodeURIComponent(token)}` : "";
      const res = await fetch(
        `/api/attendance/students/${encodeURIComponent(studentId || "")}/requests${qs}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ dates: validRows }),
        },
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(data.error || "Failed to submit request");
      }
      setConfirmOpen(false);
      setReqOpen(false);
      setReqDone(
        `Your attendance request for ${validRows.length} date${validRows.length === 1 ? "" : "s"} was submitted.`,
      );
    } catch (e) {
      setReqError(e instanceof Error ? e.message : "Something went wrong");
      setConfirmOpen(false);
    } finally {
      setReqSubmitting(false);
    }
  };

  /* Per-category quiz data + summary for the cards / slide-over */
  const categoryData: Record<
    CategoryKey,
    { items: QuizItem[]; avgPct: number; attempted: number; total: number }
  > = {
    classroom: {
      items: quizzes?.classroomQuizzes ?? [],
      avgPct: quizzes?.classroomSummary.avgPct ?? 0,
      attempted: quizzes?.classroomSummary.attempted ?? 0,
      total: quizzes?.classroomSummary.total ?? 0,
    },
    module: {
      items: quizzes?.moduleQuizzes ?? [],
      avgPct: quizzes?.moduleSummary.avgPct ?? 0,
      attempted: quizzes?.moduleSummary.attempted ?? 0,
      total: quizzes?.moduleSummary.total ?? 0,
    },
    skill: { items: [], avgPct: 0, attempted: 0, total: 0 },
    final: { items: [], avgPct: 0, attempted: 0, total: 0 },
  };

  /* ---------------------------- Loading ---------------------------- */
  if (overviewLoading) {
    return (
      <div className="min-h-screen bg-[#f7f7f5] px-6 py-12">
        <div className="mx-auto max-w-3xl space-y-8">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      </div>
    );
  }

  /* --------------------------- Not found --------------------------- */
  if (!overview) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f7f7f5] p-4">
        <div className="w-full max-w-md text-center">
          <AlertCircle className="mx-auto mb-4 h-10 w-10 text-red-500" />
          <h2 className="mb-2 text-xl font-bold text-gray-900">
            No Student Data Found
          </h2>
          <p className="text-sm text-gray-500">
            This report link may be invalid or expired. Please contact your
            administrator.
          </p>
        </div>
      </div>
    );
  }

  const onTrack = overview.attendancePct >= REQUIRED_PCT;

  return (
    <div className="min-h-screen bg-[#f4f5f9]">
      <div className="mx-auto max-w-6xl space-y-6 px-4 pb-12 pt-6 sm:px-6 sm:pt-8">
        {/* ============================ HEADER ============================ */}
        <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          {/* Left: label + student name */}
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-500">
              Attendance &amp; Eligibility Report
            </p>
            <h1 className="mt-2 font-serif text-3xl font-semibold leading-tight text-gray-900 sm:text-4xl md:text-5xl">
              {overview.studentName}
            </h1>
          </div>

          {/* Right: meta aligned to the two left rows */}
          <div className="shrink-0 text-left sm:text-right">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-gray-400">
              Current semester · classes still in progress
            </p>
            <div className="mt-2 flex h-auto items-center justify-start sm:h-[3.5rem] sm:justify-end">
              <span className="inline-flex items-center gap-1.5 text-emerald-600">
                <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
                <span className="text-xs font-medium">Live</span>
              </span>
            </div>
          </div>
        </header>

        {/* ==================== 01 · ATTENDANCE ==================== */}
        <Section
          num="01"
          title="Attendance"
          aside={
            <Button
              onClick={openRequest}
              className="gap-2 bg-brand-600 text-white hover:bg-brand-700"
            >
              <CalendarPlus className="h-4 w-4" />
              Request Attendance
            </Button>
          }
        >
          {reqDone && (
            <div className="mb-5 flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              {reqDone}
            </div>
          )}
          <div className="grid gap-8 sm:grid-cols-2">
            {/* Donut ring + inline stats */}
            <div className="flex flex-col items-center gap-6 sm:flex-row">
              <Donut pct={overview.attendancePct} />
              <div className="flex gap-6 sm:flex-col sm:gap-3">
                <Stat value={String(overview.presentCount)} label="Present" />
                <Stat
                  value={String(overview.absentCount)}
                  label="Absent"
                  tone="red"
                />
                <Stat value={`${REQUIRED_PCT}%`} label="Required" />
              </div>
            </div>

            {/* Message + key/value standing */}
            <div>
              <p className="text-sm leading-relaxed text-gray-600">
                {onTrack ? (
                  "You're on track — keep attending to stay eligible."
                ) : (
                  <>
                    {recoveryCount} course{recoveryCount === 1 ? "" : "s"} below
                    80% — complete recovery to earn your SPI this cycle.
                  </>
                )}
              </p>
              <dl className="mt-4 space-y-0">
                <KeyVal
                  label="Recovery Mode"
                  value={recoveryCount > 0 ? "Active" : "Not active"}
                  ok={recoveryCount === 0}
                />
                <KeyVal
                  label="SPI Eligibility"
                  value={onTrack ? "On track" : "Not on track"}
                  ok={onTrack}
                />
                <KeyVal
                  label="Courses in Recovery"
                  value={recoveryCount > 0 ? String(recoveryCount) : "None"}
                  ok={recoveryCount === 0}
                />
              </dl>
            </div>
          </div>
        </Section>

        {/* ==================== RECOVERY MODE (amber card) ==================== */}
        {recoveryCount > 0 && (
          <div className="overflow-hidden rounded-2xl border border-orange-200/70 bg-[#fff8ef]">
            <div className="p-6 sm:p-8">
              <div className="flex items-center gap-2.5">
                <AlertTriangle className="h-5 w-5 shrink-0 text-orange-500" />
                <h3 className="text-lg font-bold text-orange-900">
                  You&apos;re in Recovery Mode
                </h3>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-orange-800">
                {recoveryCount} course{recoveryCount === 1 ? "" : "s"} below 80%
                — you need to attend the assigned recovery classes to get them
                back above 80% and stay eligible for SPI.
              </p>

              <p className="mb-3 mt-6 text-[11px] font-bold uppercase tracking-wider text-orange-600">
                Courses in Recovery Mode
              </p>
              <div className="flex flex-wrap gap-2.5">
                {recoverySubjects.map((s, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-2 rounded-full border border-orange-200 bg-white px-3.5 py-1.5 text-[13px] font-medium text-gray-700"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-orange-500" />
                    {s.subjectTitle} · {s.pct}%
                  </span>
                ))}
              </div>

              <div className="mt-6 border-t border-orange-200/60 pt-6">
                <p className="mb-3 text-[11px] font-bold uppercase tracking-wider text-orange-600">
                  If recovery isn&apos;t completed
                </p>
                <p className="mb-4 text-sm text-gray-700">
                  Skip the recovery classes and a course moves into{" "}
                  <span className="font-bold text-orange-900">Skill Debt</span>{" "}
                  — a single Skill Debt puts all of this on hold:
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                  {CONSEQUENCES.map((c) => (
                    <div
                      key={c.label}
                      className="rounded-xl border border-orange-100 bg-white p-3.5"
                    >
                      <div className="flex items-center gap-2 text-orange-500">
                        <c.icon className="h-4 w-4 shrink-0" />
                        <p className="text-[13px] font-bold text-gray-900">
                          {c.label}
                        </p>
                      </div>
                      <p className="mt-1 text-xs text-gray-500">{c.text}</p>
                    </div>
                  ))}
                </div>
                <p className="mt-4 text-sm text-gray-600">
                  Stay clear: attend every assigned recovery class and restore
                  attendance to 80% — then SPI, assessments and all activities
                  stay open.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ==================== 02 · SPI ==================== */}
        <Section num="02" title="Skill Performance Index">
          {quizzesLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-28 w-full rounded-2xl" />
              <Skeleton className="h-28 w-full rounded-2xl" />
              <Skeleton className="h-28 w-full rounded-2xl" />
              <Skeleton className="h-28 w-full rounded-2xl" />
            </div>
          ) : (
            <div className="space-y-3">
              {SPI_CATEGORIES.map((cat) => (
                <CategoryCard
                  key={cat.key}
                  label={cat.label}
                  weight={cat.weight}
                  soon={cat.soon}
                  data={categoryData[cat.key]}
                  onClick={() => openCategory(cat.key)}
                />
              ))}
            </div>
          )}
        </Section>

        {/* ==================== 03 · COURSE-WISE ==================== */}
        <Section
          num="03"
          title="Course-wise attendance"
          aside={
            <span className="text-xs text-gray-400">
              | marks the <span className="font-semibold">80%</span> minimum
            </span>
          }
        >
          {subjectsLoading ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Skeleton className="h-32 w-full rounded-xl" />
              <Skeleton className="h-32 w-full rounded-xl" />
              <Skeleton className="h-32 w-full rounded-xl" />
            </div>
          ) : !subjects?.length ? (
            <p className="py-6 text-sm text-gray-500">
              No course attendance recorded yet.
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {subjects.map((sub: SubjectAttendance, i) => (
                <button
                  key={i}
                  onClick={() => openSessions(sub.subjectTitle)}
                  className="group flex flex-col rounded-2xl border border-gray-100 bg-white p-5 text-left transition-all hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-md"
                >
                  <div className="flex items-start justify-between gap-3">
                    <h4
                      className="min-w-0 flex-1 font-serif text-base font-semibold leading-snug text-gray-900"
                      title={sub.subjectTitle}
                    >
                      {sub.subjectTitle}
                    </h4>
                    <span
                      className="shrink-0 text-xl font-bold tabular-nums"
                      style={{ color: pctTextColor(sub.pct) }}
                    >
                      {sub.pct}%
                    </span>
                  </div>

                  <div className="relative mt-4 h-2 overflow-hidden rounded-full bg-gray-100">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{
                        width: `${Math.min(100, sub.pct)}%`,
                        backgroundColor: pctColor(sub.pct),
                      }}
                    />
                    <div
                      className="absolute top-1/2 h-3 w-0.5 -translate-y-1/2 bg-gray-400/70"
                      style={{ left: `${REQUIRED_PCT}%` }}
                    />
                  </div>

                  <div className="mt-2.5 flex items-center justify-between">
                    <span className="text-xs text-gray-500">
                      {sub.present} / {sub.total} sessions
                    </span>
                    <span
                      className={cn(
                        "text-xs font-semibold",
                        sub.meetsRequirement
                          ? "text-emerald-600"
                          : "text-orange-500",
                      )}
                    >
                      {sub.meetsRequirement ? "Meets 80%" : "Recovery"}
                    </span>
                  </div>

                  <p className="mt-3 text-right text-xs font-medium text-gray-400 transition-colors group-hover:text-brand-600">
                    Tap to view sessions →
                  </p>
                </button>
              ))}
            </div>
          )}
        </Section>

        {/* Support footer */}
        <p className="mt-12 border-t border-gray-200 pt-8 text-center text-sm text-gray-500">
          Need help or spotted something off?{" "}
          <a
            href="mailto:learning.support@nxtwave.co.in"
            className="font-semibold text-brand-600 hover:text-brand-700 hover:underline"
          >
            learning.support@nxtwave.co.in
          </a>
        </p>
      </div>

      {/* ==================== RIGHT SLIDE-OVER PANEL ==================== */}
      <Sheet open={panel !== null} onOpenChange={(o) => !o && setPanel(null)}>
        <SheetContent
          side="right"
          className="w-full overflow-y-auto p-0 sm:max-w-xl"
        >
          {panel?.type === "course" && (
            <>
              <SheetHeader className="border-b border-gray-100 bg-gray-50/60 px-6 py-5 text-left">
                <span className="text-[11px] font-bold uppercase tracking-widest text-brand-600">
                  Course Attendance
                </span>
                <SheetTitle className="pr-8 font-serif text-xl leading-snug">
                  {openSubject}
                </SheetTitle>
                <div className="mt-2 flex flex-wrap gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Present:{" "}
                    {modalPresent}
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-3 py-1 text-xs font-semibold text-red-600">
                    <AlertCircle className="h-3.5 w-3.5" /> Absent:{" "}
                    {modalAbsent}
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-600">
                    Total: {modalSessions.length}
                  </span>
                </div>
              </SheetHeader>
              <div className="p-6">
                {sessionsLoading ? (
                  <div className="space-y-3">
                    <Skeleton className="h-14 w-full rounded-xl" />
                    <Skeleton className="h-14 w-full rounded-xl" />
                    <Skeleton className="h-14 w-full rounded-xl" />
                  </div>
                ) : modalSessions.length === 0 ? (
                  <p className="py-12 text-center text-gray-500">
                    No sessions found for this course.
                  </p>
                ) : (
                  <div className="space-y-2.5">
                    {modalSessions.map((session, i) => {
                      const status = session.attendanceStatus.toLowerCase();
                      const present = status === "present";
                      const absent = status === "absent";
                      return (
                        <div
                          key={i}
                          className={cn(
                            "flex items-center justify-between gap-3 rounded-xl border p-3.5",
                            present
                              ? "border-emerald-100 bg-emerald-50/40"
                              : absent
                                ? "border-red-100 bg-red-50/40"
                                : "border-gray-100 bg-gray-50/60",
                          )}
                        >
                          <div className="min-w-0">
                            <p className="truncate font-medium text-gray-900">
                              {session.sessionTitle}
                            </p>
                            <span className="mt-1 flex items-center gap-1 text-xs text-gray-500">
                              <CalendarIcon className="h-3 w-3" />
                              {format(new Date(session.date), "MMM d, yyyy")}
                            </span>
                          </div>
                          <span
                            className={cn(
                              "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide",
                              present
                                ? "bg-emerald-100 text-emerald-700"
                                : absent
                                  ? "bg-red-100 text-red-700"
                                  : "bg-gray-100 text-gray-600",
                            )}
                          >
                            <span
                              className={cn(
                                "h-1.5 w-1.5 rounded-full",
                                present
                                  ? "bg-emerald-500"
                                  : absent
                                    ? "bg-red-500"
                                    : "bg-gray-400",
                              )}
                            />
                            {session.attendanceStatus}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}

          {panel?.type === "category" &&
            (() => {
              const cat = SPI_CATEGORIES.find((c) => c.key === panel.category)!;
              const data = categoryData[panel.category];
              return (
                <CategoryDetail
                  label={cat.label}
                  weight={cat.weight}
                  soon={cat.soon}
                  data={data}
                />
              );
            })()}
        </SheetContent>
      </Sheet>

      {/* ============ Request Attendance modal ============ */}
      <Dialog open={reqOpen} onOpenChange={setReqOpen}>
        <DialogContent className="max-h-[92vh] gap-0 overflow-hidden p-0 sm:max-w-[520px]">
          <DialogHeader className="space-y-0 border-b border-gray-100 px-6 pb-5 pt-6 text-left">
            <div className="flex items-start gap-3.5 pr-6">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600 ring-1 ring-inset ring-brand-100">
                <CalendarPlus className="h-5 w-5" />
              </div>
              <div className="space-y-1">
                <DialogTitle className="text-[17px] font-semibold text-gray-900">
                  Request Attendance Correction
                </DialogTitle>
                <DialogDescription className="text-[13px] leading-relaxed text-gray-500">
                  Add the dates you were marked absent by mistake and tell us
                  why. Your campus team reviews each one.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="max-h-[calc(92vh-15rem)] space-y-4 overflow-y-auto px-6 py-5">
            {/* Saved dates — compact cards, one row */}
            {(() => {
              const saved = reqRows
                .map((row, idx) => ({ row, idx }))
                .filter(({ row, idx }) => idx !== activeIndex && row.date);
              if (saved.length === 0) return null;
              return (
                <div className="space-y-2">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
                    Added dates · {saved.length}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {saved.map(({ row, idx }) => {
                      const d = parseYmd(row.date);
                      return (
                        <div
                          key={idx}
                          className="group inline-flex items-stretch overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm transition-colors hover:border-brand-300"
                        >
                          <button
                            type="button"
                            onClick={() => focusRow(idx)}
                            className="flex items-center gap-2 py-1.5 pl-2 pr-2.5 text-left"
                          >
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                              <Check className="h-3.5 w-3.5" />
                            </span>
                            <span className="min-w-0">
                              <span className="block text-[13px] font-semibold leading-tight text-gray-900">
                                {d ? format(d, "EEE, MMM d") : row.date}
                              </span>
                              {row.reason.trim() && (
                                <span className="block max-w-[150px] truncate text-[11px] leading-tight text-gray-400">
                                  {row.reason}
                                </span>
                              )}
                            </span>
                            <Pencil className="h-3.5 w-3.5 shrink-0 text-gray-300 transition-colors group-hover:text-brand-500" />
                          </button>
                          <button
                            type="button"
                            onClick={() => removeReqRow(idx)}
                            aria-label="Remove date"
                            className="flex items-center border-l border-gray-100 px-2 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* Active entry — the only expanded editor */}
            <div className="rounded-2xl border border-brand-200 bg-white p-4 shadow-sm ring-4 ring-brand-50">
              <div className="mb-3 flex items-center justify-between">
                <span className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-brand-600">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-600 text-[11px] font-bold text-white">
                    {activeIndex + 1}
                  </span>
                  {validRows.length > 0 && !activeHasDate
                    ? "New date"
                    : `Date ${activeIndex + 1}`}
                </span>
                {reqRows.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeReqRow(activeIndex)}
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600"
                    aria-label="Remove date"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-gray-600">
                    Date
                  </Label>
                  <DatePicker
                    value={reqRows[activeIndex]?.date ?? ""}
                    onChange={(date) => setReqRow(activeIndex, { date })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-gray-600">
                    Reason{" "}
                    <span className="font-normal text-gray-400">
                      (optional)
                    </span>
                  </Label>
                  <Textarea
                    rows={2}
                    placeholder="e.g. I attended but was marked absent by mistake"
                    value={reqRows[activeIndex]?.reason ?? ""}
                    onChange={(e) =>
                      setReqRow(activeIndex, { reason: e.target.value })
                    }
                    className="resize-none rounded-lg border-gray-200 text-sm placeholder:text-gray-400 focus-visible:border-brand-400 focus-visible:ring-brand-100"
                  />
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={addReqRow}
              disabled={!activeHasDate}
              className={cn(
                "flex w-full items-center justify-center gap-2 rounded-xl border border-dashed py-2.5 text-sm font-medium transition-colors",
                activeHasDate
                  ? "border-gray-300 text-gray-500 hover:border-brand-300 hover:bg-brand-50/40 hover:text-brand-600"
                  : "cursor-not-allowed border-gray-200 text-gray-300",
              )}
            >
              <Plus className="h-4 w-4" /> Add another date
            </button>

            {reqError && (
              <p className="flex items-center gap-1.5 text-sm text-red-600">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {reqError}
              </p>
            )}
          </div>

          <DialogFooter className="items-center gap-2 border-t border-gray-100 bg-gray-50/60 px-6 py-4 sm:justify-between">
            <span className="hidden text-xs text-gray-400 sm:block">
              {validRows.length === 0
                ? "Add at least one date to submit"
                : `${validRows.length} date${validRows.length === 1 ? "" : "s"} ready`}
            </span>
            <div className="flex w-full gap-2 sm:w-auto">
              <Button
                variant="outline"
                onClick={() => setReqOpen(false)}
                className="flex-1 border-gray-200 sm:flex-none"
              >
                Cancel
              </Button>
              <Button
                className="flex-1 bg-brand-600 text-white shadow-sm hover:bg-brand-700 disabled:opacity-40 sm:flex-none"
                disabled={validRows.length === 0}
                onClick={() => setConfirmOpen(true)}
              >
                Submit request
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============ Confirmation dialog ============ */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Confirm your request</DialogTitle>
            <DialogDescription>
              Please confirm these {validRows.length} date
              {validRows.length === 1 ? "" : "s"} are correct before submitting.
            </DialogDescription>
          </DialogHeader>
          <ul className="max-h-56 space-y-2 overflow-y-auto">
            {validRows.map((r, i) => {
              const d = parseYmd(r.date);
              return (
                <li
                  key={i}
                  className="flex items-start gap-2 rounded-lg border border-gray-100 bg-gray-50/60 px-3 py-2 text-sm"
                >
                  <CalendarIcon className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" />
                  <span>
                    <span className="font-semibold text-gray-900">
                      {d ? format(d, "EEE, MMM d, yyyy") : r.date}
                    </span>
                    {r.reason && (
                      <span className="text-gray-500"> — {r.reason}</span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={reqSubmitting}
            >
              Go back
            </Button>
            <Button
              className="bg-brand-600 text-white hover:bg-brand-700"
              onClick={submitRequest}
              disabled={reqSubmitting}
            >
              {reqSubmitting ? "Submitting…" : "Yes, submit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Date picker — calendar popover (value/onChange are yyyy-mm-dd)     */
/* ------------------------------------------------------------------ */
function parseYmd(value: string): Date | undefined {
  if (!value) return undefined;
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d);
}
function toYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function DatePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = parseYmd(value);
  const today = new Date();
  today.setHours(23, 59, 59, 999);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-10 w-full items-center gap-2.5 rounded-lg border bg-white px-3 text-left text-sm font-medium transition-colors",
            open
              ? "border-brand-400 ring-4 ring-brand-50"
              : "border-gray-200 hover:border-gray-300",
            selected ? "text-gray-900" : "text-gray-400",
          )}
        >
          <CalendarIcon
            className={cn(
              "h-4 w-4 shrink-0",
              selected ? "text-brand-500" : "text-gray-400",
            )}
          />
          {selected ? format(selected, "EEE, MMM d, yyyy") : "Pick a date"}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-auto rounded-xl border-gray-200 p-0 shadow-lg"
        align="start"
        sideOffset={8}
      >
        <Calendar
          mode="single"
          selected={selected}
          onSelect={(date) => {
            if (date) onChange(toYmd(date));
            setOpen(false);
          }}
          disabled={{ after: today }}
          defaultMonth={selected ?? today}
          className="p-3 [--cell-size:2.4rem]"
        />
      </PopoverContent>
    </Popover>
  );
}

/* Small inline stat (Present / Absent / Required) */
function Stat({
  value,
  label,
  tone,
}: {
  value: string;
  label: string;
  tone?: "red";
}) {
  return (
    <div>
      <p
        className={cn(
          "text-lg font-bold tabular-nums",
          tone === "red" ? "text-red-600" : "text-gray-900",
        )}
      >
        {value}
      </p>
      <p className="text-xs text-gray-400">{label}</p>
    </div>
  );
}

/* Key/value standing row */
function KeyVal({
  label,
  value,
  ok,
}: {
  label: string;
  value: string;
  ok: boolean;
}) {
  return (
    <div className="flex items-center justify-between border-b border-gray-100 py-2.5 last:border-0">
      <dt className="text-sm text-gray-500">{label}</dt>
      <dd
        className={cn(
          "text-sm font-bold",
          ok ? "text-emerald-600" : "text-orange-500",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  SPI category — shared data shape                                  */
/* ------------------------------------------------------------------ */
interface CategoryData {
  items: QuizItem[];
  avgPct: number;
  attempted: number;
  total: number;
}

/* ------------------------------------------------------------------ */
/*  SPI category card (clickable, single row of 4)                    */
/* ------------------------------------------------------------------ */
function CategoryCard({
  label,
  weight,
  soon,
  data,
  onClick,
}: {
  label: string;
  weight: string;
  soon: boolean;
  data: CategoryData;
  onClick: () => void;
}) {
  const hasData = !soon && data.items.length > 0;
  const completionPct =
    data.total > 0
      ? Math.min(100, Math.round((data.attempted / data.total) * 100))
      : 0;
  return (
    <button
      onClick={onClick}
      className={cn(
        "group flex w-full items-center gap-4 rounded-2xl border p-5 text-left transition-all hover:shadow-md sm:gap-6",
        soon
          ? "border-gray-100 bg-gray-50/50 hover:border-gray-200"
          : "border-gray-100 bg-white hover:border-brand-200",
      )}
    >
      {/* Left: name + weight badge + counts + progress */}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h4
            className={cn(
              "font-serif text-base font-semibold leading-snug sm:text-lg",
              soon ? "text-gray-400" : "text-gray-900",
            )}
          >
            {label}
          </h4>
          <span
            className={cn(
              "inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold",
              soon ? "bg-gray-100 text-gray-400" : "bg-brand-50 text-brand-600",
            )}
          >
            {weight} weight
          </span>
        </div>

        <p className="mt-1.5 text-xs text-gray-500">
          {soon ? (
            "Not yet available"
          ) : (
            <>
              <span className="font-semibold text-gray-700">
                {data.attempted}
              </span>{" "}
              / {data.total} completed
              <span className="mx-2 text-gray-300">·</span>
              {data.items.length} set{data.items.length === 1 ? "" : "s"}
            </>
          )}
        </p>

        <div className="mt-3 h-1.5 w-full max-w-md overflow-hidden rounded-full bg-gray-100">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{
              width: `${soon ? 0 : completionPct}%`,
              backgroundColor: soon ? "#d1d5db" : pctColor(data.avgPct),
            }}
          />
        </div>
      </div>

      {/* Right: average % + arrow */}
      <div className="flex shrink-0 items-center gap-3 sm:gap-5">
        <div className="text-right">
          {hasData ? (
            <p
              className="text-2xl font-extrabold tabular-nums leading-none sm:text-3xl"
              style={{ color: pctTextColor(data.avgPct) }}
            >
              {data.avgPct}
              <span className="text-base sm:text-lg">%</span>
            </p>
          ) : (
            <p className="text-2xl font-bold leading-none text-gray-300 sm:text-3xl">
              —
            </p>
          )}
          <p className="mt-1 text-[10px] font-medium uppercase tracking-wide text-gray-400">
            {soon ? "Coming soon" : "Average score"}
          </p>
        </div>
        <ChevronRight
          className={cn(
            "h-5 w-5 shrink-0 transition-colors",
            soon ? "text-gray-300" : "text-gray-300 group-hover:text-brand-500",
          )}
        />
      </div>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  SPI category detail (right slide-over content)                    */
/* ------------------------------------------------------------------ */
function CategoryDetail({
  label,
  weight,
  soon,
  data,
}: {
  label: string;
  weight: string;
  soon: boolean;
  data: CategoryData;
}) {
  return (
    <>
      <SheetHeader className="border-b border-gray-100 bg-gray-50/60 px-6 py-5 text-left">
        <span className="text-[11px] font-bold uppercase tracking-widest text-brand-600">
          Skill Performance Index · {weight} weight
        </span>
        <SheetTitle className="pr-8 font-serif text-xl leading-snug">
          {label}
        </SheetTitle>
        {!soon && (
          <div className="mt-2 flex flex-wrap gap-2">
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold"
              style={{
                backgroundColor: `${pctColor(data.avgPct)}1a`,
                color: pctTextColor(data.avgPct),
              }}
            >
              {data.avgPct}% avg
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-600">
              {data.attempted}/{data.total} completed
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-600">
              {data.items.length} set{data.items.length === 1 ? "" : "s"}
            </span>
          </div>
        )}
      </SheetHeader>

      <div className="p-6">
        {soon ? (
          <div className="rounded-2xl border border-dashed border-gray-200 p-10 text-center">
            <ClipboardList className="mx-auto mb-3 h-8 w-8 text-gray-300" />
            <p className="text-sm font-medium text-gray-600">
              {label} are coming soon.
            </p>
            <p className="mt-1 text-xs text-gray-400">
              This assessment carries {weight} of the SPI and will appear here
              once available.
            </p>
          </div>
        ) : data.items.length === 0 ? (
          <p className="py-12 text-center text-gray-500">
            No {label.toLowerCase()} recorded yet.
          </p>
        ) : (
          <div>
            {data.items.map((q, i) => {
              const completed = String(q.status).toLowerCase() !== "pending";
              return (
                <div
                  key={i}
                  className="flex w-full items-center justify-between gap-3 border-b border-gray-100 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-gray-800">
                      {q.title}
                    </p>
                    <p className="truncate text-xs text-gray-400">
                      {q.subjectTitle}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2.5">
                    <span
                      className="text-sm font-bold tabular-nums"
                      style={{ color: pctColor(q.percentage) }}
                    >
                      {q.score}/{q.maxScore}
                    </span>
                    <span
                      className={cn(
                        "text-[10px] font-bold uppercase tracking-wide",
                        completed ? "text-emerald-600" : "text-gray-400",
                      )}
                    >
                      {completed ? "Completed" : "Pending"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
