import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ExternalLink, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/PageHeader";
import { useQueryParams } from "@/hooks/useQueryParams";
import { useAuth } from "@/contexts/AuthContext";
import { fmtInt } from "@/lib/assessmentMetrics";
import { directoryApi, NO_DIRECTORY_FILTERS, type DirectoryFilters, type DirectoryRow, type QuizTypeFilter } from "@/lib/directoryReport";
import { Body, Head, Pager, type Sort } from "@/components/assessments/quiz/QuizTables";
import { AttendanceCaption } from "@/components/AttendanceInfo";
import { Pill } from "@/components/assessments/quiz/quizParts";
import { CopyUid } from "@/components/assessments/quiz/CopyUid";
import { CheckMenu } from "@/components/SpiRecordFilterBar";
import {
  EndedTag,
  ExportMenu,
  FilterField,
  fieldTrigger,
  focusRing,
  MoreFiltersSheet,
  ScopeFilterBar,
  Segmented,
  UpdatingBar,
  UpdatingStatus,
  type FilterChip,
} from "@/components/ScopeFilters";

/**
 * Student Directory: every number is the student report's own (eligibility, attendance, quiz averages,
 * expected SPI, skill debt), read from the saved reports by /api/dashboard/directory. The filter bar is the one on
 * Student Attendance Stats: College › Batch › Semester and Student search in view, the rest under More filters.
 */
const STALE = 5 * 60_000;
const selectClass = "h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-600";
const QUIZ_TYPES: { value: QuizTypeFilter; label: string }[] = [
  { value: "", label: "All quiz types" },
  { value: "classroom", label: "Classroom Quiz" },
  { value: "module", label: "Module Quiz" },
  { value: "skill", label: "Skill Assessment" },
];
const TIERS: { value: string; label: string }[] = [
  { value: "", label: "All tiers" },
  { value: "eligible", label: "Eligible (≥ 80%)" },
  { value: "recovery_eligible", label: "Recovery (60–79%)" },
  { value: "at_risk", label: "At risk (50–59%)" },
  { value: "ineligible", label: "Ineligible (< 50%)" },
];
const TIER_LABEL: Record<string, string> = { eligible: "Eligible", recovery_eligible: "Recovery", at_risk: "At risk", ineligible: "Ineligible" };

const COLUMNS: { key: string; label: string; align?: "right"; sortable?: boolean }[] = [
  { key: "batch", label: "Batch" },
  { key: "name", label: "Student name" },
  { key: "uuid", label: "UUID", sortable: false },
  { key: "semester", label: "Semester" },
  { key: "section", label: "Section" },
  { key: "attendance", label: "Attendance %", align: "right" },
  { key: "classroom", label: "Classroom Quiz avg", align: "right" },
  { key: "module", label: "Module Quiz avg", align: "right" },
  { key: "skill", label: "Skill Assessment avg", align: "right" },
  { key: "fsa", label: "Final Skill Assessment", align: "right", sortable: false },
  { key: "spi", label: "Expected SPI", align: "right" },
  { key: "report", label: "Report", sortable: false },
];

const TONE = { main: "text-violet-700", good: "text-emerald-700", bad: "text-red-700", warn: "text-amber-700", plain: "text-slate-900" } as const;

function Kpi({ label, value, tone = "plain", loading, onClick, pressed }: { label: string; value: string; tone?: keyof typeof TONE; loading: boolean; onClick?: () => void; pressed?: boolean }) {
  const body = (
    <>
      <span className="text-xs font-medium text-slate-500">{label}</span>
      {/* mt-auto: every value sits on the card's bottom line, so values stay level when a label wraps to two lines. */}
      {loading ? <span className="mt-auto h-7 w-16 animate-pulse rounded bg-slate-100" /> : <span className={cn("mt-auto text-xl font-bold tracking-tight tabular-nums", TONE[tone])}>{value}</span>}
    </>
  );
  const box = "flex h-full flex-col gap-1 rounded-lg border bg-white px-3.5 py-2.5 text-left shadow-sm";
  if (!onClick) return <div className={cn(box, "border-slate-200")}>{body}</div>;
  // A card that filters the table: pressed while its filter is on.
  return (
    <button type="button" aria-pressed={pressed} onClick={onClick} title={pressed ? "Show all students" : "Show these students"} className={cn(box, "transition-colors hover:border-violet-300", focusRing, pressed ? "border-violet-500 ring-1 ring-violet-500" : "border-slate-200")}>
      {body}
    </button>
  );
}

/** A card whose number needs the Final Skill Assessment (FSA): shown as Coming soon until FSA results are in. */
function SoonKpi({ label }: { label: string }) {
  return (
    <div className="flex h-full flex-col gap-1 rounded-lg border border-dashed border-slate-300 bg-white px-3.5 py-2.5 shadow-sm">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <span className="mt-auto inline-flex w-fit items-center rounded-full bg-violet-50 px-2.5 py-0.5 text-xs font-semibold text-violet-700">Coming soon</span>
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

/** Tighter cells: eleven columns have to fit next to the sidebar. */
const cell = "whitespace-nowrap px-2.5 py-2.5 text-sm text-slate-700";
const num = `${cell} text-right tabular-nums`;
/** A % with one decimal, or "–" when there is nothing to average. */
const pctText = (v: number | null | undefined) => (v == null ? "–" : `${v.toFixed(1)}%`);
const shortSemester = (s: string | null) => (s ? s.replace(/^Semester\s+/i, "Sem ") : "—");

type AttendanceOp = "any" | "gte" | "lte" | "between";

/** The attendance choice in More filters, before Apply. */
interface Draft {
  sections: string[];
  subject: string;
  tier: string;
  quiz: QuizTypeFilter;
  attOp: AttendanceOp;
  attA: string;
  attB: string;
}

/** A whole number from 0 to 100, or null when the text is not one. */
const pctOf = (text: string): number | null => (/^\d{1,3}$/.test(text.trim()) && Number(text) <= 100 ? Number(text) : null);

/** The attendance filter as the server's range (attMin, attMax); an error text when the numbers are not valid. */
function attendanceRange(op: AttendanceOp, a: string, b: string): { attMin: number; attMax: number } | string {
  if (op === "any") return { attMin: 0, attMax: 100 };
  const x = pctOf(a);
  if (x == null) return "Enter a whole number from 0 to 100.";
  if (op === "gte") return { attMin: x, attMax: 100 };
  if (op === "lte") return { attMin: 0, attMax: x };
  const y = pctOf(b);
  if (y == null) return "Enter both numbers, 0 to 100.";
  if (x > y) return "From must be less than or equal to To.";
  return { attMin: x, attMax: y };
}

/** The attendance filter back as the four fields (for the draft). */
function attendanceDraft(f: DirectoryFilters): Pick<Draft, "attOp" | "attA" | "attB"> {
  if (f.attMin <= 0 && f.attMax >= 100) return { attOp: "any", attA: "80", attB: "100" };
  if (f.attMax >= 100) return { attOp: "gte", attA: String(f.attMin), attB: "100" };
  if (f.attMin <= 0) return { attOp: "lte", attA: String(f.attMax), attB: "100" };
  return { attOp: "between", attA: String(f.attMin), attB: String(f.attMax) };
}

const attendanceText = (f: DirectoryFilters) =>
  f.attMin <= 0 && f.attMax >= 100 ? "" : f.attMax >= 100 ? `≥ ${f.attMin}%` : f.attMin <= 0 ? `≤ ${f.attMax}%` : `${f.attMin}–${f.attMax}%`;

export default function Students() {
  const { user } = useAuth();
  const link = useQueryParams();
  // Links from Overview may carry colleges, a semester, a search or a tier.
  const [filters, setFilters] = useState<DirectoryFilters>(() => ({
    ...NO_DIRECTORY_FILTERS,
    colleges: (link.get("campuses") ?? "").split("||").map((c) => c.trim()).filter(Boolean),
    semester: link.get("semesters")?.split("||")[0] ?? "",
    q: link.get("q") ?? "",
    tier: ["eligible", "recovery_eligible", "at_risk", "ineligible"].includes(link.get("tier") ?? "") ? link.get("tier")! : "",
  }));
  const [debouncedQ, setDebouncedQ] = useState(filters.q);
  const [quiz, setQuiz] = useState<QuizTypeFilter>("");
  const [sort, setSort] = useState<Sort>({ key: "batch", dir: "asc" });
  const [pageSize, setPageSize] = useState(25);
  const [moreOpen, setMoreOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>({ sections: [], subject: "", tier: "", quiz: "", attOp: "any", attA: "80", attB: "100" });

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
  /** Old numbers are on screen while the new filters load (or the search is still being typed). */
  const updating = (data.isFetching && data.isPlaceholderData) || filters.q.trim() !== debouncedQ;

  const o = options.data;
  /** A single-college user: the college is fixed. */
  const lockedCampus = o?.colleges.length === 1 ? o.colleges[0] : undefined;
  const sectionsFor = (colleges: string[], batches: string[]) =>
    (o?.sections ?? []).filter(
      (s) => (colleges.length || batches.length || lockedCampus) && (!colleges.length || colleges.includes(s.college)) && (!batches.length || batches.includes(`${s.college}\t${s.batch}`)),
    );
  const sectionChoices = useMemo(() => {
    const list = sectionsFor(filters.colleges, filters.batches);
    const manyBatches = new Set(list.map((s) => `${s.college}\t${s.batch}`)).size > 1;
    const seen = new Map<string, string>();
    for (const s of list) seen.set(`${s.batch}\t${s.section}`, manyBatches ? `${s.batch} — ${s.section}` : s.section);
    return [...seen.entries()].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [o, filters.colleges, filters.batches, lockedCampus]);

  /** Changing a parent filter drops choices it no longer has, so no hidden filter stays on. */
  const change = (patch: Partial<DirectoryFilters>) =>
    setFilters((f) => {
      const next = { ...f, ...patch };
      if (patch.colleges) next.batches = next.colleges.length ? next.batches.filter((b) => next.colleges.includes(b.split("\t")[0]!)) : next.batches;
      if (patch.colleges || patch.batches) {
        const ok = new Set(sectionsFor(next.colleges, next.batches).map((s) => `${s.batch}\t${s.section}`));
        next.sections = next.sections.filter((s) => ok.has(s));
      }
      return next;
    });
  const clearAll = () => {
    setFilters(NO_DIRECTORY_FILTERS);
    setQuiz("");
  };
  const openMore = () => {
    setDraft({ sections: filters.sections, subject: filters.subject, tier: filters.tier, quiz, ...attendanceDraft(filters) });
    setMoreOpen(true);
  };
  const draftRange = attendanceRange(draft.attOp, draft.attA, draft.attB);
  const draftError = typeof draftRange === "string" ? draftRange : "";
  const applyMore = () => {
    if (typeof draftRange === "string") return;
    change({ sections: draft.sections, subject: draft.subject, tier: draft.tier, ...draftRange });
    setQuiz(draft.quiz);
    setMoreOpen(false);
  };

  const sectionLabel = (id: string) => sectionChoices.find((s) => s.id === id)?.label ?? id.split("\t")[1] ?? id;
  const att = attendanceText(filters);
  const chips: FilterChip[] = [
    ...filters.sections.map((id) => ({ key: `section-${id}`, label: `Section: ${sectionLabel(id)}`, clear: () => change({ sections: filters.sections.filter((x) => x !== id) }) })),
    ...(filters.subject ? [{ key: "subject", label: `Subject: ${filters.subject}`, clear: () => change({ subject: "" }) }] : []),
    ...(att ? [{ key: "att", label: `Attendance ${att}`, clear: () => change({ attMin: 0, attMax: 100 }) }] : []),
    ...(filters.tier ? [{ key: "tier", label: `Tier: ${TIER_LABEL[filters.tier]}`, clear: () => change({ tier: "" }) }] : []),
    ...(quiz ? [{ key: "quiz", label: `Quiz type: ${QUIZ_TYPES.find((t) => t.value === quiz)!.label}`, clear: () => setQuiz("") }] : []),
    // From an Overview link only: there is no Semester-title field on this page.
    ...(filters.semester ? [{ key: "semester", label: `Semester: ${filters.semester}`, clear: () => change({ semester: "" }) }] : []),
  ];
  const moreCount = (filters.sections.length ? 1 : 0) + (filters.subject ? 1 : 0) + (att ? 1 : 0) + (filters.tier ? 1 : 0) + (quiz ? 1 : 0);
  const anyFilter = filters.colleges.length > 0 || filters.batches.length > 0 || filters.term !== "" || filters.q.trim() !== "" || chips.length > 0;

  const exportStudents = async () => {
    const res = await fetch(directoryApi.exportUrl(applied, { sort: sort.key, dir: sort.dir }), { credentials: "include" });
    if (!res.ok) throw new Error(String(res.status));
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stem = filters.colleges.length === 1 ? filters.colleges[0]! : filters.colleges.length ? `${filters.colleges.length}-colleges` : "all-colleges";
    a.href = url;
    a.download = `student-directory_${stem.replace(/[^\w.-]+/g, "-")}${filters.term ? `_${filters.term}` : ""}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const onSort = (key: string) => setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: ["college", "batch", "name", "semester", "section"].includes(key) ? "asc" : "desc" }));
  const rows = data.data?.rows ?? [];
  const summary = data.data?.summary;
  const loading = data.isLoading;
  /** A user limited to some colleges or subjects sees that scope next to the title. */
  const scope = [user?.campuses?.length ? (user.campuses.length <= 2 ? user.campuses.join(" · ") : `${user.campuses.length} colleges`) : "", user?.subjects?.length ? (user.subjects.length <= 3 ? user.subjects.join(" · ") : `${user.subjects.length} subjects`) : ""].filter(Boolean).join(" · ");
  const highlight = quiz === "classroom" ? "classroom" : quiz === "module" ? "module" : quiz === "skill" ? "skill" : undefined;
  const dim = (key: string) => (highlight && highlight !== key ? "opacity-40" : "");

  return (
    <div className="flex min-w-0 flex-col">
      <PageHeader
        title="Student Directory"
        right={
          <div className="flex items-start gap-2">
          {scope && <span className="mt-2 hidden rounded-full bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-700 sm:inline">{scope}</span>}
          <ExportMenu
            disabled={loading}
            choices={[
              {
                title: "Students in these filters",
                detail: `One row per student (${fmtInt(data.data?.total ?? 0)}): batch, semester, attendance, quiz averages, SPI, eligibility`,
                disabled: (data.data?.total ?? 0) === 0,
                run: exportStudents,
              },
            ]}
          />
          </div>
        }
      />

      <ScopeFilterBar
        campusOptions={o?.colleges ?? []}
        campuses={filters.colleges}
        onCampuses={(colleges) => change({ colleges })}
        lockedCampus={lockedCampus}
        batchOptions={o?.batches ?? []}
        batches={filters.batches}
        onBatches={(batches) => change({ batches })}
        term={filters.term}
        onTerm={(term) => change({ term })}
        moreCount={moreCount}
        onMore={openMore}
        chips={chips}
        anyFilter={anyFilter}
        onClearAll={clearAll}
        updating={updating}
        extra={
          <FilterField label="Student name / UUID">
            <span className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <input
                type="search"
                value={filters.q}
                onChange={(e) => change({ q: e.target.value.slice(0, 100) })}
                placeholder="Search name or UUID"
                className="h-10 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-8 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-600 [&::-webkit-search-cancel-button]:hidden"
              />
              {filters.q && (
                <button type="button" onClick={() => change({ q: "" })} aria-label="Clear search" className={cn("absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-700", focusRing)}>
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              )}
            </span>
          </FilterField>
        }
      />

      <MoreFiltersSheet
        open={moreOpen}
        onOpenChange={setMoreOpen}
        description="Narrow the cards and the table by section, subject, attendance or tier, or pick a quiz type to highlight."
        onReset={() => setDraft({ sections: [], subject: "", tier: "", quiz: "", attOp: "any", attA: "80", attB: "100" })}
        onApply={applyMore}
        applyDisabled={Boolean(draftError)}
      >
        <FilterField label="Section">
          <CheckMenu
            chevron
            className={fieldTrigger}
            label={draft.sections.length ? `${draft.sections.length} selected` : sectionChoices.length ? "All sections" : "Pick a college or batch first"}
            options={sectionChoices}
            selected={draft.sections}
            onChange={(next) => setDraft((d) => ({ ...d, sections: next }))}
          />
        </FilterField>
        <FilterField label="Subject">
          <select className={selectClass} value={draft.subject} onChange={(e) => setDraft((d) => ({ ...d, subject: e.target.value }))}>
            <option value="">{user?.subjects?.length ? "My subjects" : "All subjects"}</option>
            {(o?.subjects ?? []).map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </FilterField>
        <fieldset className="space-y-2">
          <legend className="text-xs font-medium text-slate-600">Attendance %</legend>
          <Segmented
            label="Attendance %"
            value={draft.attOp}
            options={[["any", "Any"], ["gte", "≥"], ["lte", "≤"], ["between", "Range"]] as const}
            onChange={(attOp) => setDraft((d) => ({ ...d, attOp, attA: attOp === "lte" && d.attA === "80" ? "60" : d.attA }))}
          />
          {draft.attOp !== "any" && (
            <div className="flex items-center gap-2">
              <input
                type="text"
                inputMode="numeric"
                aria-label={draft.attOp === "between" ? "From attendance %" : "Attendance %"}
                aria-invalid={Boolean(draftError)}
                value={draft.attA}
                onChange={(e) => setDraft((d) => ({ ...d, attA: e.target.value.replace(/[^\d]/g, "").slice(0, 3) }))}
                className={cn(selectClass, "text-center tabular-nums")}
              />
              {draft.attOp === "between" && (
                <>
                  <span className="text-slate-400" aria-hidden="true">–</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    aria-label="To attendance %"
                    aria-invalid={Boolean(draftError)}
                    value={draft.attB}
                    onChange={(e) => setDraft((d) => ({ ...d, attB: e.target.value.replace(/[^\d]/g, "").slice(0, 3) }))}
                    className={cn(selectClass, "text-center tabular-nums")}
                  />
                </>
              )}
              <span className="text-sm text-slate-500">%</span>
            </div>
          )}
          {draftError && <p role="alert" className="text-xs font-medium text-red-700">{draftError}</p>}
        </fieldset>
        <FilterField label="Attendance tier (from the report)">
          <select className={selectClass} value={draft.tier} onChange={(e) => setDraft((d) => ({ ...d, tier: e.target.value }))}>
            {TIERS.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Quiz type (highlights that column)">
          <select className={selectClass} value={draft.quiz} onChange={(e) => setDraft((d) => ({ ...d, quiz: e.target.value as QuizTypeFilter }))}>
            {QUIZ_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </FilterField>
      </MoreFiltersSheet>

      <div aria-busy={updating} className={cn("grid grid-cols-2 gap-2.5 transition-opacity duration-200 motion-reduce:transition-none md:grid-cols-4 xl:grid-cols-7", updating && "opacity-50")}>
        <Kpi label="Students" value={fmtInt(summary?.students ?? 0)} tone="main" loading={loading} />
        <Kpi label="Overall attendance" value={pctText(summary?.avgAttendance)} loading={loading} />
        <Kpi label="Classroom Quiz avg" value={pctText(summary?.classroomAvg)} loading={loading} />
        <Kpi label="Module Quiz avg" value={pctText(summary?.moduleAvg)} loading={loading} />
        <Kpi label="Skill Assessment avg" value={pctText(summary?.skillAvg)} loading={loading} />
        <SoonKpi label="FSA avg" />
        <SoonKpi label="SPI" />
      </div>

      <section className="relative mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm" aria-label="Students" aria-busy={updating}>
        <UpdatingBar updating={updating} />
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-3 py-2.5">
          <p className="text-sm text-slate-500 tabular-nums">
            <UpdatingStatus updating={updating}>
              <span className="font-semibold text-slate-900">{fmtInt(data.data?.total ?? 0)}</span> students
            </UpdatingStatus>
          </p>
        </div>
        {data.isError && !data.data ? (
          <div role="alert" className="flex items-center justify-between gap-3 p-6 text-sm text-red-800">
            <span>We couldn't load the students.</span>
            <button type="button" onClick={() => void data.refetch()} className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold">
              Retry
            </button>
          </div>
        ) : (
          <div className={cn("overflow-x-auto transition-opacity duration-200 motion-reduce:transition-none", updating && "opacity-60")}>
            <table className="w-full min-w-[68rem] text-left">
              <Head columns={COLUMNS} sort={sort} onSort={onSort} highlight={highlight} dense />
              <Body loading={loading} empty="No students match these filters" colSpan={COLUMNS.length} rowsCount={rows.length}>
                {rows.map((r: DirectoryRow) => (
                  <tr key={r.studentId} className="hover:bg-slate-50">
                    <td className={cn(cell, "max-w-[11rem] truncate")} title={`${r.batch} · ${r.college}`}>{r.batch}</td>
                    <td className={cn(cell, "max-w-[10rem] truncate font-semibold text-slate-900")} title={r.name ?? undefined}>{r.name || "—"}</td>
                    <td className={cell}><CopyUid uid={r.studentId} /></td>
                    <td className={cell} title={r.semester ?? undefined}>
                      <span className="inline-flex items-center gap-1.5">
                        {shortSemester(r.semester)}
                        {r.ended && <EndedTag />}
                      </span>
                    </td>
                    <td className={cell}>{r.section || "—"}</td>
                    <td className={num}>{r.attendancePct == null ? <span className="text-slate-400">–</span> : `${r.attendancePct.toFixed(1)}%`}</td>
                    <td className={cn(num, dim("classroom"))}><Score value={r.classroom} /></td>
                    <td className={cn(num, dim("module"))}><Score value={r.module} /></td>
                    <td className={cn(num, dim("skill"))}><Score value={r.skill} /></td>
                    <td className={num}><span className="text-xs font-medium text-slate-400">Coming soon</span></td>
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
        <AttendanceCaption className="mx-3 mb-2" />
        <Pager page={data.data} unit="students" pageSize={pageSize} onPage={(next) => setPageState({ key: viewKey, page: next })} onPageSize={setPageSize} />
      </section>
    </div>
  );
}
