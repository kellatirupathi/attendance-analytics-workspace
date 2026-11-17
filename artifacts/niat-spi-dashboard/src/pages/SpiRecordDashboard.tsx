import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Building2, ExternalLink, GraduationCap, LayoutGrid, Search, User, X, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/PageHeader";
import { useQueryParams } from "@/hooks/useQueryParams";
import { useAuth } from "@/contexts/AuthContext";
import { fmtInt } from "@/lib/assessmentMetrics";
import { directoryApi, directoryQuery, NO_DIRECTORY_FILTERS, type DirectoryFilters } from "@/lib/directoryReport";
import { Body, Head, Pager, type Sort } from "@/components/assessments/quiz/QuizTables";
import { InfoTip, Pill } from "@/components/assessments/quiz/quizParts";
import { CopyUid } from "@/components/assessments/quiz/CopyUid";
import { CheckMenu } from "@/components/SpiRecordFilterBar";
import { EndedTag, ExportMenu, FilterField, fieldTrigger, focusRing, MoreFiltersSheet, readTermParam, ScopeFilterBar, Segmented, UpdatingBar, type FilterChip } from "@/components/ScopeFilters";

/**
 * SPI Record Dashboard: the interim SPI from the assessments held so far (CQ, MQ, SA), from the saved reports by
 * /api/dashboard/directory/spi-record, so CQ / MQ / SA are the Student Directory's own numbers. "SPI up to" picks the
 * parts counted; the score is scaled to 100. Once Final Skill Assessment scores are in, "All (with FSA)" becomes the
 * real SPI. Filters as on the other pages: College › Batch › Semester › SPI up to, the rest under More filters.
 */
const STALE = 5 * 60_000;
const API = "/api/dashboard/directory/spi-record";
const TARGET = 70;
const selectClass = "h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-600";

type UpTo = "cq" | "cqmq" | "cqmqsa" | "all";
type Grain = "college" | "batch" | "section" | "student";
const UP_TO: { value: UpTo; label: string; hint: string }[] = [
  { value: "cq", label: "CQ", hint: "Interim" },
  { value: "cqmq", label: "CQ + MQ", hint: "Interim" },
  { value: "cqmqsa", label: "CQ + MQ + SA", hint: "Interim" },
  { value: "all", label: "All (with FSA)", hint: "After the Final" },
];
const UP_TO_TEXT: Record<UpTo, string> = { cq: "CQ", cqmq: "CQ 10 + MQ 15", cqmqsa: "CQ 10 + MQ 15 + SA 25", all: "CQ 10 + MQ 15 + SA 25 + FSA 50" };
const VIEWS: { value: Grain; label: string; icon: LucideIcon }[] = [
  { value: "college", label: "College", icon: Building2 },
  { value: "batch", label: "Batch", icon: GraduationCap },
  { value: "section", label: "Section", icon: LayoutGrid },
  { value: "student", label: "Student", icon: User },
];

interface Summary {
  students: number;
  allStudents: number;
  score: number | null;
  spi: number | null;
  atTarget: number;
  atTargetPct: number | null;
  fsaAvailable: boolean;
}
interface GroupRow {
  key: string;
  college: string;
  batch: string | null;
  semester: string | null;
  section: string | null;
  students: number;
  endedStudents: number;
  classroom: number | null;
  module: number | null;
  skill: number | null;
  score: number | null;
  spi: number | null;
  atTarget: number;
  atTargetPct: number | null;
}
interface StudentRow {
  studentId: string;
  name: string | null;
  college: string;
  batch: string;
  semester: string | null;
  section: string;
  classroom: number | null;
  module: number | null;
  skill: number | null;
  score: number | null;
  spi: number | null;
  level: string | null;
  ended?: boolean;
  reportPath: string;
}
interface SpiPage {
  rows: (GroupRow | StudentRow)[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  grain: Grain;
  summary: Summary;
}

type ScoreOp = "any" | "gte" | "lte" | "between";
interface Draft {
  sections: string[];
  subject: string;
  op: ScoreOp;
  a: string;
  b: string;
}

const pctOf = (text: string): number | null => (/^\d{1,3}$/.test(text.trim()) && Number(text) <= 100 ? Number(text) : null);
function scoreRange(op: ScoreOp, a: string, b: string): { min: number; max: number } | string {
  if (op === "any") return { min: 0, max: 100 };
  const x = pctOf(a);
  if (x == null) return "Enter a whole number from 0 to 100.";
  if (op === "gte") return { min: x, max: 100 };
  if (op === "lte") return { min: 0, max: x };
  const y = pctOf(b);
  if (y == null) return "Enter both numbers, 0 to 100.";
  if (x > y) return "From must be less than or equal to To.";
  return { min: x, max: y };
}
const scoreText = (min: number, max: number) => (min <= 0 && max >= 100 ? "" : max >= 100 ? `≥ ${min}%` : min <= 0 ? `≤ ${max}%` : `${min}–${max}%`);

const pctText = (v: number | null | undefined) => (v == null ? "–" : `${v.toFixed(1)}%`);
const shortSemester = (s: string | null) => (s ? s.replace(/^Semester\s+/i, "Sem ") : "—");
const cell = "whitespace-nowrap px-2.5 py-2.5 text-sm text-slate-700";
const num = `${cell} text-right tabular-nums`;
const LEVEL_STYLE: Record<string, string> = {
  "A+": "bg-emerald-50 text-emerald-700",
  A: "bg-teal-50 text-teal-700",
  B: "bg-blue-50 text-blue-700",
  C: "bg-orange-50 text-orange-700",
  D: "bg-red-50 text-red-700",
  F: "bg-slate-100 text-slate-600",
};

/** A quiz or assessment average; "Awaited" when none is held yet. */
function Score({ value }: { value: number | null }) {
  if (value == null) return <span className="inline-block min-w-[3.5rem] rounded-full bg-slate-100 px-2.5 py-0.5 text-center text-xs font-semibold text-slate-500">Awaited</span>;
  return <Pill metric="avg" value={value} />;
}

/** Interim SPI out of 10 and as a %. */
function SpiCell({ value }: { value: number | null }) {
  if (value == null) return <span className="text-slate-400">–</span>;
  return (
    <span className="tabular-nums">
      <span className="font-semibold text-slate-900">{value.toFixed(1)}</span>
      <span className="text-slate-500"> · {Math.round(value * 10)}%</span>
    </span>
  );
}

function Kpi({ label, tip, value, sub, tone = "text-slate-900", loading }: { label: string; tip: string; value: React.ReactNode; sub: string; tone?: string; loading: boolean }) {
  return (
    <div className="flex h-full flex-col gap-1 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <span className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
        {label}
        <InfoTip label={label}>{tip}</InfoTip>
      </span>
      {loading ? <span className="mt-1 h-8 w-20 animate-pulse rounded bg-slate-100" /> : <span className={cn("mt-1 text-2xl font-bold tracking-tight tabular-nums", tone)}>{value}</span>}
      <span className="text-xs text-slate-500">{loading ? " " : sub}</span>
    </div>
  );
}

export default function SpiRecordDashboard() {
  const { user } = useAuth();
  const link = useQueryParams();
  const list = (key: string) => (link.get(key) ?? "").split("||").map((c) => c.trim()).filter(Boolean);
  const [filters, setFilters] = useState<DirectoryFilters>(() => ({
    ...NO_DIRECTORY_FILTERS,
    colleges: list("campuses"),
    batches: list("batches").filter((b) => b.includes("\t")),
    term: readTermParam(link.get("term")),
  }));
  const [upTo, setUpTo] = useState<UpTo>("cqmqsa");
  const [score, setScore] = useState({ min: 0, max: 100 });
  const [grain, setGrain] = useState<Grain>("college");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [sort, setSort] = useState<Sort | null>(null);
  const [pageSize, setPageSize] = useState(50);
  const [moreOpen, setMoreOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>({ sections: [], subject: "", op: "any", a: String(TARGET), b: "100" });

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(search.trim()), 300);
    return () => window.clearTimeout(id);
  }, [search]);

  const options = useQuery({ queryKey: ["directory-options", filters.term], queryFn: () => directoryApi.options(filters.term), staleTime: STALE, placeholderData: keepPreviousData });
  const o = options.data;
  const lockedCampus = user?.campuses?.length === 1 ? user.campuses[0] : undefined;

  const query = (extra: Record<string, string | number | undefined>) =>
    directoryQuery(filters, {
      upTo,
      scoreMin: score.min > 0 ? score.min : undefined,
      scoreMax: score.max < 100 ? score.max : undefined,
      group: grain,
      q: debounced || undefined,
      sort: sort?.key,
      dir: sort?.dir,
      ...extra,
    });
  const viewKey = JSON.stringify([filters, upTo, score, grain, debounced, sort, pageSize]);
  const [pageState, setPageState] = useState({ key: viewKey, page: 1 });
  const page = pageState.key === viewKey ? pageState.page : 1;
  const data = useQuery({
    queryKey: ["spi-record", viewKey, page],
    queryFn: async () => {
      const res = await fetch(`${API}?${query({ page, pageSize })}`, { credentials: "include" });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      return (await res.json()) as SpiPage;
    },
    staleTime: STALE,
    placeholderData: keepPreviousData,
  });
  const updating = data.isFetching && data.isPlaceholderData;
  const s = data.data?.summary;
  const loading = data.isLoading;

  const sectionsFor = (colleges: string[], batches: string[]) =>
    (o?.sections ?? []).filter((x) => (colleges.length || batches.length || lockedCampus) && (!colleges.length || colleges.includes(x.college)) && (!batches.length || batches.includes(`${x.college}\t${x.batch}`)));
  const sectionChoices = useMemo(() => {
    const items = sectionsFor(filters.colleges, filters.batches);
    const manyBatches = new Set(items.map((x) => `${x.college}\t${x.batch}`)).size > 1;
    const seen = new Map<string, string>();
    for (const x of items) seen.set(`${x.batch}\t${x.section}`, manyBatches ? `${x.batch} — ${x.section}` : x.section);
    return [...seen.entries()].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [o, filters.colleges, filters.batches, lockedCampus]);

  const change = (patch: Partial<DirectoryFilters>) =>
    setFilters((f) => {
      const next = { ...f, ...patch };
      if (patch.colleges) next.batches = next.colleges.length ? next.batches.filter((b) => next.colleges.includes(b.split("\t")[0]!)) : next.batches;
      if (patch.colleges || patch.batches) {
        const ok = new Set(sectionsFor(next.colleges, next.batches).map((x) => `${x.batch}\t${x.section}`));
        next.sections = next.sections.filter((x) => ok.has(x));
      }
      return next;
    });
  const draftRange = scoreRange(draft.op, draft.a, draft.b);
  const draftError = typeof draftRange === "string" ? draftRange : "";
  const openMore = () => {
    const op: ScoreOp = score.min <= 0 && score.max >= 100 ? "any" : score.max >= 100 ? "gte" : score.min <= 0 ? "lte" : "between";
    setDraft({ sections: filters.sections, subject: filters.subject, op, a: String(op === "lte" ? score.max : op === "any" ? TARGET : score.min), b: String(score.max) });
    setMoreOpen(true);
  };
  const applyMore = () => {
    if (typeof draftRange === "string") return;
    change({ sections: draft.sections, subject: draft.subject });
    setScore(draftRange);
    setMoreOpen(false);
  };
  const clearAll = () => {
    setFilters(NO_DIRECTORY_FILTERS);
    setScore({ min: 0, max: 100 });
    setSearch("");
  };

  const sectionLabel = (id: string) => sectionChoices.find((x) => x.id === id)?.label ?? id.split("\t")[1] ?? id;
  const scoreChip = scoreText(score.min, score.max);
  const chips: FilterChip[] = [
    ...(scoreChip ? [{ key: "score", label: `Interim score ${scoreChip}`, clear: () => setScore({ min: 0, max: 100 }) }] : []),
    ...filters.sections.map((id) => ({ key: `section-${id}`, label: `Section: ${sectionLabel(id)}`, clear: () => change({ sections: filters.sections.filter((x) => x !== id) }) })),
    ...(filters.subject ? [{ key: "subject", label: `Subject: ${filters.subject}`, clear: () => change({ subject: "" }) }] : []),
  ];
  const moreCount = (scoreChip ? 1 : 0) + (filters.sections.length ? 1 : 0) + (filters.subject ? 1 : 0);
  const anyFilter = filters.colleges.length > 0 || filters.batches.length > 0 || filters.term !== "" || chips.length > 0;
  const interim = upTo !== "all";
  const scoreLabel = interim ? "Interim score" : "Course score";
  const spiLabel = interim ? "Interim SPI" : "SPI";
  // The table follows the view of the rows on screen: after a View by click the old rows stay until the new ones arrive.
  const shown: Grain = data.data?.grain ?? grain;

  const onSort = (key: string) => setSort((cur) => (cur?.key === key ? { key, dir: cur.dir === "asc" ? "desc" : "asc" } : { key, dir: ["college", "batch", "section", "semester", "name"].includes(key) ? "asc" : "desc" }));
  const columns: { key: string; label: string; align?: "right"; sortable?: boolean }[] = [
    ...(shown === "student"
      ? [{ key: "name", label: "Student" }, { key: "uuid", label: "UUID", sortable: false }, { key: "college", label: "College" }, { key: "section", label: "Section" }]
      : [{ key: "college", label: "College" }, ...(shown !== "college" ? [{ key: "batch", label: "Batch" }, { key: "semester", label: "Semester" }] : []), ...(shown === "section" ? [{ key: "section", label: "Section" }] : []), { key: "students", label: "Students", align: "right" as const }]),
    { key: "classroom", label: "CQ", align: "right" },
    { key: "module", label: "MQ", align: "right" },
    { key: "skill", label: "SA", align: "right" },
    { key: "score", label: `${scoreLabel} (scaled to 100)`, align: "right" },
    { key: "spi", label: spiLabel, align: "right" },
    ...(shown === "student" ? [{ key: "level", label: "Level", align: "right" as const }, { key: "report", label: "Report", sortable: false }] : [{ key: "atTarget", label: `≥ ${TARGET}%`, align: "right" as const }]),
  ];
  const rows = data.data?.rows ?? [];

  const runExport = async () => {
    const res = await fetch(`${API}/export?${query({})}`, { credentials: "include" });
    if (!res.ok) throw new Error(String(res.status));
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = `spi-record_${grain}_${upTo}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex min-w-0 flex-col">
      <PageHeader
        title="SPI Record Dashboard"
        subtitle={interim ? "Interim SPI from the assessments held so far. The final SPI comes after the Final Skill Assessment." : undefined}
        right={<ExportMenu disabled={loading} choices={[{ title: "This view", detail: `${VIEWS.find((v) => v.value === grain)!.label}-wise, ${fmtInt(data.data?.total ?? 0)} rows, with your filters`, disabled: (data.data?.total ?? 0) === 0, run: runExport }]} />}
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
        onTerm={(term) => change({ term, batches: [], sections: [] })}
        pastSemesters={o?.pastSemesters}
        moreCount={moreCount}
        onMore={openMore}
        chips={chips}
        anyFilter={anyFilter}
        onClearAll={clearAll}
        updating={updating}
        extra={
          <FilterField label="SPI up to">
            <select className={selectClass} value={upTo} onChange={(e) => setUpTo(e.target.value as UpTo)} aria-label="SPI up to">
              {UP_TO.map((u) => (
                <option key={u.value} value={u.value} disabled={u.value === "all" && !s?.fsaAvailable}>
                  {u.label} · {u.hint}
                </option>
              ))}
            </select>
          </FilterField>
        }
      />

      <MoreFiltersSheet
        open={moreOpen}
        onOpenChange={setMoreOpen}
        description="Narrow the cards and the table by section, subject or interim score."
        onReset={() => setDraft({ sections: [], subject: "", op: "any", a: String(TARGET), b: "100" })}
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
            {(o?.subjects ?? []).map((x) => (
              <option key={x} value={x}>{x}</option>
            ))}
          </select>
        </FilterField>
        <fieldset className="space-y-2">
          <legend className="text-xs font-medium text-slate-600">{scoreLabel} %</legend>
          <Segmented label={`${scoreLabel} %`} value={draft.op} options={[["any", "Any"], ["gte", "≥"], ["lte", "≤"], ["between", "Range"]] as const} onChange={(op) => setDraft((d) => ({ ...d, op }))} />
          {draft.op !== "any" && (
            <div className="flex items-center gap-2">
              <input type="text" inputMode="numeric" aria-label={draft.op === "between" ? "From %" : `${scoreLabel} %`} aria-invalid={Boolean(draftError)} value={draft.a} onChange={(e) => setDraft((d) => ({ ...d, a: e.target.value.replace(/[^\d]/g, "").slice(0, 3) }))} className={cn(selectClass, "text-center tabular-nums")} />
              {draft.op === "between" && (
                <>
                  <span className="text-slate-400" aria-hidden="true">–</span>
                  <input type="text" inputMode="numeric" aria-label="To %" aria-invalid={Boolean(draftError)} value={draft.b} onChange={(e) => setDraft((d) => ({ ...d, b: e.target.value.replace(/[^\d]/g, "").slice(0, 3) }))} className={cn(selectClass, "text-center tabular-nums")} />
                </>
              )}
              <span className="text-sm text-slate-500">%</span>
            </div>
          )}
          {draftError && <p role="alert" className="text-xs font-medium text-red-700">{draftError}</p>}
        </fieldset>
      </MoreFiltersSheet>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Students" tip="Students in these filters." loading={loading} value={fmtInt(s?.students ?? 0)} sub={s && s.students !== s.allStudents ? `of ${fmtInt(s.allStudents)} · ${scoreLabel} ${scoreChip}` : "in these filters"} />
        <Kpi
          label={`Avg ${scoreLabel.toLowerCase()}`}
          tip={`Course score = (${UP_TO_TEXT[upTo]}) ÷ the weights of the parts held, so it is scaled to 100. Example: CQ 80, MQ 70, SA 90 → (800 + 1050 + 2250) ÷ 50 = 82%. A student's score is the average of their courses.`}
          loading={loading}
          value={pctText(s?.score)}
          sub={`${UP_TO.find((u) => u.value === upTo)!.label}, scaled to 100`}
        />
        <Kpi
          label={spiLabel}
          tip="Each course score becomes a level and points: 90+ A+ 10, 80+ A 9, 70+ B 8, 60+ C 7, 50+ D 6, below 50 F 0. SPI is the average of the course points, out of 10."
          loading={loading}
          value={s?.spi == null ? "–" : (
            <span className="inline-flex items-baseline gap-2">
              {s.spi.toFixed(1)} <span className="text-sm font-semibold text-slate-500">/ 10</span>
              <span className="text-lg text-violet-700">{Math.round(s.spi * 10)}%</span>
            </span>
          )}
          sub={interim ? "without FSA" : "with FSA"}
        />
        <Kpi label={`≥ ${TARGET}%`} tip={`Students with a ${scoreLabel.toLowerCase()} of ${TARGET}% or more.`} tone="text-emerald-700" loading={loading} value={fmtInt(s?.atTarget ?? 0)} sub={s?.atTargetPct == null ? "" : `${s.atTargetPct.toFixed(1)}% of ${fmtInt(s.allStudents)} students`} />
      </div>

      <div role="group" aria-label="View by" className="mt-4 flex flex-wrap items-center gap-2">
        <span className="mr-1 text-sm font-bold text-slate-900">View by</span>
        {VIEWS.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            type="button"
            aria-pressed={grain === value}
            onClick={() => {
              if (grain === value) return;
              setGrain(value);
              setSort(null);
              setSearch("");
            }}
            className={cn("inline-flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-semibold transition-colors motion-reduce:transition-none", focusRing, grain === value ? "bg-violet-600 text-white shadow-md shadow-violet-600/30" : "bg-white text-slate-700 shadow-sm hover:bg-slate-50")}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>

      <section className="relative mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm" aria-busy={updating}>
        <UpdatingBar updating={updating} />
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <span className="relative block w-full max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value.slice(0, 100))}
              placeholder={grain === "student" ? "Search name or UUID" : `Search ${grain}`}
              aria-label={grain === "student" ? "Search name or UUID" : `Search ${grain}`}
              className="h-10 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-8 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-600 [&::-webkit-search-cancel-button]:hidden"
            />
            {search && (
              <button type="button" onClick={() => setSearch("")} aria-label="Clear search" className={cn("absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-700", focusRing)}>
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
          </span>
          <span className="text-sm text-slate-500 tabular-nums">{fmtInt(data.data?.total ?? 0)} {shown === "student" ? "students" : shown === "college" ? "colleges" : shown === "batch" ? "batches" : "sections"}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[48rem] text-left">
            <Head columns={columns} sort={sort ?? undefined} onSort={onSort} dense />
            <Body loading={loading} empty="Nothing matches these filters" colSpan={columns.length} rowsCount={rows.length}>
              {shown === "student"
                ? (rows as StudentRow[]).map((r) => (
                    <tr key={r.studentId} className="hover:bg-slate-50">
                      <td className={cn(cell, "font-medium text-slate-900")}>{r.name ?? "—"}</td>
                      <td className={cell}><CopyUid uid={r.studentId} /></td>
                      <td className={cell}>
                        <span className="inline-flex items-center gap-1.5">{r.college}{r.ended && <EndedTag />}</span>
                      </td>
                      <td className={cell}>{r.section}</td>
                      <td className={num}><Score value={r.classroom} /></td>
                      <td className={num}><Score value={r.module} /></td>
                      <td className={num}><Score value={r.skill} /></td>
                      <td className={num}>{r.score == null ? <span className="text-slate-400">–</span> : <Pill metric="avg" value={r.score} />}</td>
                      <td className={num}><SpiCell value={r.spi} /></td>
                      <td className={num}>{r.level ? <span className={cn("inline-block min-w-[2.25rem] rounded-full px-2 py-0.5 text-center text-xs font-bold", LEVEL_STYLE[r.level])}>{r.level}</span> : <span className="text-slate-400">–</span>}</td>
                      <td className={cell}>
                        <a href={r.reportPath} target="_blank" rel="noreferrer" className={cn("inline-flex items-center gap-1 font-semibold text-violet-700 hover:underline", focusRing)}>
                          View <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                        </a>
                      </td>
                    </tr>
                  ))
                : (rows as GroupRow[]).map((r) => (
                    <tr key={r.key} className="hover:bg-slate-50">
                      <td className={cn(cell, "font-medium text-slate-900")}>
                        {shown === "college" ? (
                          <button type="button" className={cn("text-left font-medium text-violet-700 hover:underline", focusRing)} onClick={() => { change({ colleges: [r.college] }); setGrain("section"); setSort(null); }}>
                            {r.college}
                          </button>
                        ) : r.college}
                        {r.endedStudents > 0 && <span className="ml-1.5"><EndedTag label={r.endedStudents >= r.students ? "Ended" : `${fmtInt(r.endedStudents)} ended`} /></span>}
                      </td>
                      {shown !== "college" && <td className={cell}>{r.batch}</td>}
                      {shown !== "college" && <td className={cell}>{shortSemester(r.semester)}</td>}
                      {shown === "section" && <td className={cell}>{r.section}</td>}
                      <td className={num}>{fmtInt(r.students)}</td>
                      <td className={num}><Score value={r.classroom} /></td>
                      <td className={num}><Score value={r.module} /></td>
                      <td className={num}><Score value={r.skill} /></td>
                      <td className={num}>{r.score == null ? <span className="text-slate-400">–</span> : <Pill metric="avg" value={r.score} />}</td>
                      <td className={num}><SpiCell value={r.spi} /></td>
                      <td className={num}>{fmtInt(r.atTarget)}{r.atTargetPct != null && <span className="text-slate-500"> · {r.atTargetPct.toFixed(0)}%</span>}</td>
                    </tr>
                  ))}
            </Body>
          </table>
        </div>
        <Pager page={data.data} unit={shown === "student" ? "students" : shown === "college" ? "colleges" : shown === "batch" ? "batches" : "sections"} pageSize={pageSize} onPage={(next) => setPageState({ key: viewKey, page: next })} onPageSize={setPageSize} />
      </section>
    </div>
  );
}
