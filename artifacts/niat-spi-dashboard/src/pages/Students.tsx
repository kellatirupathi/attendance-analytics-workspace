import { useEffect, useMemo, useState, type ReactNode } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Download, ExternalLink, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/PageHeader";
import { useAuth } from "@/contexts/AuthContext";
import { useQueryParams } from "@/hooks/useQueryParams";
import { fmtInt } from "@/lib/assessmentMetrics";
import { directoryApi, NO_DIRECTORY_FILTERS, type DirectoryFilters, type DirectoryRow, type QuizTypeFilter } from "@/lib/directoryReport";
import { Body, Head, Pager, type Sort } from "@/components/assessments/quiz/QuizTables";
import { Pill } from "@/components/assessments/quiz/quizParts";
import { CopyUid } from "@/components/assessments/quiz/CopyUid";

/**
 * Student Directory: every number is the student report's own (eligibility, attendance, quiz averages,
 * expected SPI, skill debt), read from the saved reports by /api/dashboard/directory. Filters apply as soon
 * as they change; the server filters, sorts and pages.
 */
const STALE = 5 * 60_000;
const selectClass = "h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-600 disabled:bg-slate-50 disabled:text-slate-500";
const QUIZ_TYPES: { value: QuizTypeFilter; label: string }[] = [
  { value: "", label: "All quiz types" },
  { value: "classroom", label: "Classroom Quiz" },
  { value: "module", label: "Module Quiz" },
  { value: "skill", label: "Skill Assessment" },
];

const COLUMNS: { key: string; label: string; align?: "right"; sortable?: boolean }[] = [
  { key: "college", label: "College" },
  { key: "name", label: "Student name" },
  { key: "uuid", label: "UUID", sortable: false },
  { key: "semester", label: "Semester" },
  { key: "section", label: "Section" },
  { key: "classroom", label: "Classroom Quiz avg", align: "right" },
  { key: "module", label: "Module Quiz avg", align: "right" },
  { key: "skill", label: "Skill Assessment avg", align: "right" },
  { key: "spi", label: "Expected SPI", align: "right" },
  { key: "report", label: "Report", sortable: false },
];

function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn("flex min-w-0 flex-col gap-1.5 text-xs font-medium text-slate-600", className)}>
      {label}
      {children}
    </label>
  );
}

const TONE = { main: "text-violet-700", good: "text-emerald-700", bad: "text-red-700", warn: "text-amber-700", plain: "text-slate-900" } as const;

function Kpi({ label, value, tone = "plain", loading }: { label: string; value: string; tone?: keyof typeof TONE; loading: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 shadow-sm">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      {loading ? <span className="h-7 w-16 animate-pulse rounded bg-slate-100" /> : <span className={cn("text-xl font-bold tracking-tight tabular-nums", TONE[tone])}>{value}</span>}
    </div>
  );
}

/** A quiz average as a coloured pill; "Awaited" when no quiz of that type is held yet. */
function Score({ value }: { value: number | null }) {
  if (value == null) return <span className="inline-block min-w-[3.5rem] rounded-full bg-slate-100 px-2.5 py-0.5 text-center text-xs font-semibold text-slate-500">Awaited</span>;
  return <Pill metric="avg" value={value} />;
}

function Spi({ value }: { value: number | null }) {
  if (value == null) return <span className="text-slate-400">–</span>;
  const tone = value >= 7 ? "bg-emerald-50 text-emerald-700" : value >= 4.5 ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-700";
  return <span className={cn("inline-block min-w-[3.5rem] rounded-full px-2.5 py-0.5 text-center text-xs font-bold tabular-nums", tone)}>{value.toFixed(2)}</span>;
}

/** Tighter cells than the Assessments tables: ten columns have to fit next to the sidebar. */
const cell = "whitespace-nowrap px-2.5 py-2.5 text-sm text-slate-700";
const num = `${cell} text-right tabular-nums`;
const shortSemester = (s: string | null) => (s ? s.replace(/^Semester\s+/i, "Sem ") : "—");

const TIER_LABEL: Record<string, string> = { eligible: "Eligible", recovery_eligible: "Recovery", at_risk: "At risk", ineligible: "Ineligible" };

const clampPct = (v: string) => Math.max(0, Math.min(100, Math.round(Number(v) || 0)));

type AttendanceOp = "gte" | "lte" | "between";
const ATTENDANCE_OPS: { value: AttendanceOp; label: string }[] = [
  { value: "gte", label: "≥" },
  { value: "lte", label: "≤" },
  { value: "between", label: "Range" },
];
/** The operator and values as the server's attendance range (attMin, attMax). */
function attendanceRange(op: AttendanceOp, a: string, b: string): { attMin: number; attMax: number } {
  const x = clampPct(a);
  const y = clampPct(b);
  if (op === "gte") return { attMin: x, attMax: 100 };
  if (op === "lte") return { attMin: 0, attMax: x };
  return { attMin: Math.min(x, y), attMax: Math.max(x, y) };
}

export default function Students() {
  const { user } = useAuth();
  const link = useQueryParams();
  // Links from Overview may carry a college, semester or search.
  const [filters, setFilters] = useState<DirectoryFilters>(() => ({
    ...NO_DIRECTORY_FILTERS,
    college: link.get("campuses")?.split("||")[0] ?? "",
    semester: link.get("semesters")?.split("||")[0] ?? "",
    q: link.get("q") ?? "",
    tier: ["eligible", "recovery_eligible", "at_risk", "ineligible"].includes(link.get("tier") ?? "") ? link.get("tier")! : "",
  }));
  const [debouncedQ, setDebouncedQ] = useState(filters.q);
  const [quiz, setQuiz] = useState<QuizTypeFilter>("");
  const [attOp, setAttOp] = useState<AttendanceOp>("gte");
  const [attA, setAttA] = useState("0");
  const [attB, setAttB] = useState("100");
  const [sort, setSort] = useState<Sort>({ key: "college", dir: "asc" });
  const [pageSize, setPageSize] = useState(25);

  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedQ(filters.q.trim()), 300);
    return () => window.clearTimeout(id);
  }, [filters.q]);

  const applied = useMemo(() => ({ ...filters, q: debouncedQ }), [filters, debouncedQ]);
  const options = useQuery({ queryKey: ["directory-options"], queryFn: directoryApi.options, staleTime: STALE });
  const viewKey = JSON.stringify([applied, sort, pageSize]);
  const [pageState, setPageState] = useState({ key: viewKey, page: 1 });
  const page = pageState.key === viewKey ? pageState.page : 1;
  const data = useQuery({
    queryKey: ["directory", viewKey, page],
    queryFn: () => directoryApi.page(applied, { sort: sort.key, dir: sort.dir, page, pageSize }),
    staleTime: STALE,
    placeholderData: keepPreviousData,
  });

  const o = options.data;
  const semesterNames = useMemo(() => [...new Set((o?.sections ?? []).filter((s) => !filters.college || s.college === filters.college).map((s) => s.semester).filter((s): s is string => !!s))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })), [o, filters.college]);
  const sectionNames = useMemo(
    () => [...new Set((o?.sections ?? []).filter((s) => (!filters.college || s.college === filters.college) && (!filters.semester || s.semester === filters.semester)).map((s) => s.section))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    [o, filters.college, filters.semester],
  );
  const change = (patch: Partial<DirectoryFilters>) =>
    setFilters((f) => {
      const next = { ...f, ...patch };
      if (patch.college !== undefined && next.semester && !(o?.sections ?? []).some((s) => (!next.college || s.college === next.college) && s.semester === next.semester)) next.semester = "";
      if (patch.college !== undefined || patch.semester !== undefined) {
        const ok = (o?.sections ?? []).some((s) => (!next.college || s.college === next.college) && (!next.semester || s.semester === next.semester) && s.section === next.section);
        if (next.section && !ok) next.section = "";
      }
      return next;
    });
  const setAttendance = (op: AttendanceOp, a: string, b: string) => {
    setAttOp(op);
    setAttA(a);
    setAttB(b);
    change(attendanceRange(op, a, b));
  };
  const reset = () => {
    setFilters(NO_DIRECTORY_FILTERS);
    setQuiz("");
    setAttOp("gte");
    setAttA("0");
    setAttB("100");
  };

  const onSort = (key: string) => setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: ["college", "name", "semester", "section"].includes(key) ? "asc" : "desc" }));
  const rows = data.data?.rows ?? [];
  const summary = data.data?.summary;
  const loading = data.isLoading;
  const scope = [user?.campuses?.length ? (user.campuses.length <= 2 ? user.campuses.join(" · ") : `${user.campuses.length} colleges`) : "", user?.subjects?.length ? (user.subjects.length <= 3 ? user.subjects.join(" · ") : `${user.subjects.length} subjects`) : ""].filter(Boolean).join(" · ");
  const highlight = quiz === "classroom" ? "classroom" : quiz === "module" ? "module" : quiz === "skill" ? "skill" : undefined;
  const dim = (key: string) => (highlight && highlight !== key ? "opacity-40" : "");

  return (
    <div className="flex min-w-0 flex-col">
      <PageHeader
        title="Student Directory"
        right={
          <div className="flex items-center gap-2">
            {scope && <span className="hidden rounded-full bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-700 sm:inline">{scope}</span>}
            <a
              href={directoryApi.exportUrl(applied, { sort: sort.key, dir: sort.dir })}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-violet-600 px-3.5 text-sm font-semibold text-white hover:bg-violet-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-600 focus-visible:ring-offset-2"
            >
              <Download className="h-4 w-4" aria-hidden="true" /> Export CSV
            </a>
          </div>
        }
      />

      <div role="group" aria-label="Filters" className="mt-4 grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-[repeat(4,minmax(0,1fr))_minmax(0,1.7fr)_minmax(0,1fr)]">
        <Field label="College">
          <select className={selectClass} value={filters.college} disabled={o?.colleges.length === 1} onChange={(e) => change({ college: e.target.value })}>
            {o?.colleges.length === 1 ? null : <option value="">All colleges</option>}
            {(o?.colleges ?? []).map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </Field>
        <Field label="Semester">
          <select className={selectClass} value={filters.semester} onChange={(e) => change({ semester: e.target.value })}>
            <option value="">All semesters</option>
            {semesterNames.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </Field>
        <Field label="Section">
          <select className={selectClass} value={filters.section} onChange={(e) => change({ section: e.target.value })}>
            <option value="">All sections</option>
            {sectionNames.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </Field>
        <Field label="Subject">
          <select className={selectClass} value={filters.subject} onChange={(e) => change({ subject: e.target.value })}>
            <option value="">{user?.subjects?.length ? "My subjects" : "All subjects"}</option>
            {(o?.subjects ?? []).map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </Field>
        <Field label="Attendance %">
          <div className="flex items-center gap-1.5">
            <select
              aria-label="Attendance comparison"
              value={attOp}
              onChange={(e) => {
                const op = e.target.value as AttendanceOp;
                // A single-sided filter starts from a sensible value: 80 for ≥, 60 for ≤ (the tier lines).
                setAttendance(op, op === "gte" && attA === "0" ? "80" : op === "lte" && (attA === "0" || attA === "80") ? "60" : attA, attB);
              }}
              className={cn(selectClass, "w-[4.75rem] shrink-0 px-2 text-center font-semibold")}
            >
              {ATTENDANCE_OPS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={100}
              aria-label={attOp === "between" ? "From attendance %" : "Attendance %"}
              value={attA}
              onChange={(e) => setAttendance(attOp, e.target.value, attB)}
              className={cn(selectClass, "min-w-0 px-2 text-center")}
            />
            {attOp === "between" && (
              <>
                <span className="text-slate-400" aria-hidden="true">–</span>
                <input type="number" inputMode="numeric" min={0} max={100} aria-label="To attendance %" value={attB} onChange={(e) => setAttendance(attOp, attA, e.target.value)} className={cn(selectClass, "min-w-0 px-2 text-center")} />
              </>
            )}
          </div>
        </Field>
        <Field label="Quiz type">
          <select className={selectClass} value={quiz} onChange={(e) => setQuiz(e.target.value as QuizTypeFilter)}>
            {QUIZ_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Student name / UUID" className="sm:col-span-2 lg:col-span-3 xl:col-span-6">
          <span className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input
              type="search"
              value={filters.q}
              onChange={(e) => change({ q: e.target.value })}
              placeholder="Search name or UUID"
              className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-600"
            />
          </span>
        </Field>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Total students" value={fmtInt(summary?.students ?? 0)} tone="main" loading={loading} />
        <Kpi label="Average attendance" value={summary?.avgAttendance == null ? "–" : `${summary.avgAttendance.toFixed(1)}%`} loading={loading} />
        <Kpi label="Eligible students" value={fmtInt(summary?.eligible ?? 0)} tone="good" loading={loading} />
        <Kpi label="Not eligible" value={fmtInt(summary?.notEligible ?? 0)} tone="bad" loading={loading} />
        <Kpi label="Average SPI" value={summary?.avgSpi == null ? "–" : summary.avgSpi.toFixed(2)} loading={loading} />
        <Kpi label="Skill debt" value={fmtInt(summary?.skillDebt ?? 0)} tone="warn" loading={loading} />
      </div>

      <section className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm" aria-label="Students">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm text-slate-500 tabular-nums">
              <span className="font-semibold text-slate-900">{fmtInt(data.data?.total ?? 0)}</span> students
            </p>
            {filters.tier && (
              <button
                type="button"
                onClick={() => change({ tier: "" })}
                aria-label={`Remove the ${TIER_LABEL[filters.tier]} tier filter`}
                className="inline-flex items-center gap-1.5 rounded-full bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-700 hover:bg-violet-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-600"
              >
                Tier: {TIER_LABEL[filters.tier]} <span aria-hidden="true">×</span>
              </button>
            )}
          </div>
          <button type="button" onClick={reset} className="h-9 rounded-lg border border-slate-200 bg-white px-3.5 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-600">
            Reset filters
          </button>
        </div>
        {data.isError && !data.data ? (
          <div role="alert" className="flex items-center justify-between gap-3 p-6 text-sm text-red-800">
            <span>We couldn't load the students.</span>
            <button type="button" onClick={() => void data.refetch()} className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold">
              Retry
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[56rem] text-left">
              <Head columns={COLUMNS} sort={sort} onSort={onSort} highlight={highlight} dense />
              <Body loading={loading} empty="No students match these filters" colSpan={COLUMNS.length} rowsCount={rows.length}>
                {rows.map((r: DirectoryRow) => (
                  <tr key={r.studentId} className="hover:bg-slate-50">
                    <td className={cn(cell, "max-w-[11rem] truncate")} title={r.college}>{r.college}</td>
                    <td className={cn(cell, "max-w-[10rem] truncate font-semibold text-slate-900")} title={r.name ?? undefined}>{r.name || "—"}</td>
                    <td className={cell}><CopyUid uid={r.studentId} /></td>
                    <td className={cell} title={r.semester ?? undefined}>{shortSemester(r.semester)}</td>
                    <td className={cell}>{r.section || "—"}</td>
                    <td className={cn(num, dim("classroom"))}><Score value={r.classroom} /></td>
                    <td className={cn(num, dim("module"))}><Score value={r.module} /></td>
                    <td className={cn(num, dim("skill"))}><Score value={r.skill} /></td>
                    <td className={num}><Spi value={r.spi} /></td>
                    <td className={cell}>
                      <a href={r.reportPath} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-violet-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-600">
                        View <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                      </a>
                    </td>
                  </tr>
                ))}
              </Body>
            </table>
          </div>
        )}
        <Pager page={data.data} unit="students" pageSize={pageSize} onPage={(next) => setPageState({ key: viewKey, page: next })} onPageSize={setPageSize} />
      </section>
    </div>
  );
}
