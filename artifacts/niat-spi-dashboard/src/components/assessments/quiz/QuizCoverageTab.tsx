import { useEffect, useMemo, useState, type ReactNode } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Building2, Search, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/PageHeader";
import { CheckMenu } from "@/components/SpiRecordFilterBar";
import { FilterField, fieldTrigger, MoreFiltersSheet, ScopeFilterBar, UpdatingBar, UpdatingStatus, type FilterChip } from "@/components/ScopeFilters";
import { formatAsOf, isSkill, NO_FILTERS, QUIZ_LABEL, quizApi, type QuizFilters, type QuizType } from "@/lib/quizCoverage";
import { fmtInt } from "@/lib/assessmentMetrics";
import { QuizKpiCards } from "./quizParts";
import { CampusTable, Pager, StudentTable, type Sort } from "./QuizTables";
import { QuizStudentPanel } from "./QuizStudentPanel";
import { QuizDownload } from "./QuizDownload";

type View = "campus" | "students";

const DEFAULT_SORT: Record<View, Sort> = {
  campus: { key: "college", dir: "asc" },
  students: { key: "student", dir: "asc" },
};
const STALE = 5 * 60_000;
const selectClass = "h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-600";

/** More filters before Apply. */
interface Draft {
  sections: string[];
  category: string;
  subject: string;
}

/**
 * Assessments → Classroom Quiz (and Module Quiz, Skill Assessment, by quizType): College › Batch › Semester and
 * More filters (as on Student Attendance Stats), four cards, a Campus | Students table, a student side panel and
 * one Export button. Numbers come from the server; filters apply to everything.
 */
export function QuizCoverageTab({ quizType, tabs, filters, onFiltersChange }: { quizType: QuizType; tabs: ReactNode; filters: QuizFilters; onFiltersChange: (next: QuizFilters) => void }) {
  // Filters live in the page, so Classroom Quiz, Module Quiz and Skill Assessment share them.
  const applied = filters;
  const [view, setView] = useState<View>("campus");
  const [sorts, setSorts] = useState(DEFAULT_SORT);
  const [pageSize, setPageSize] = useState(25);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [openUid, setOpenUid] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>({ sections: [], category: "", subject: "" });

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(search.trim()), 350);
    return () => window.clearTimeout(id);
  }, [search]);

  const options = useQuery({ queryKey: ["quiz-options", quizType], queryFn: () => quizApi.options(quizType), staleTime: STALE });
  const kpis = useQuery({ queryKey: ["quiz-kpis", quizType, applied], queryFn: () => quizApi.kpis(quizType, applied), staleTime: STALE, placeholderData: keepPreviousData });

  // A page belongs to one set of filters, sort, size and search: any change starts again at page 1.
  const sort = sorts[view];
  const viewKey = JSON.stringify([quizType, applied, view, sort, pageSize, view === "students" ? debounced : ""]);
  const [pageState, setPageState] = useState({ key: viewKey, page: 1 });
  const page = pageState.key === viewKey ? pageState.page : 1;

  const campus = useQuery({
    queryKey: ["quiz-campus", viewKey, page],
    queryFn: () => quizApi.campus(quizType, applied, { sort: sort.key, dir: sort.dir, page, pageSize }),
    enabled: view === "campus",
    staleTime: STALE,
    placeholderData: keepPreviousData,
  });
  const students = useQuery({
    queryKey: ["quiz-students", viewKey, page],
    queryFn: () => quizApi.students(quizType, applied, { sort: sort.key, dir: sort.dir, page, pageSize, q: debounced }),
    enabled: view === "students",
    staleTime: STALE,
    placeholderData: keepPreviousData,
  });
  const active = view === "campus" ? campus : students;
  /** Old numbers are on screen while the new filters load. */
  const updating = (kpis.isFetching && kpis.isPlaceholderData) || (active.isFetching && active.isPlaceholderData);

  /* ---- filter choices that depend on each other: college › batch › section; category › subject ---- */
  const o = options.data;
  const sectionsFor = (colleges: string[], batches: string[]) =>
    (o?.sections ?? []).filter(
      (s) => (colleges.length || batches.length) && (!colleges.length || colleges.includes(s.college)) && (!batches.length || batches.includes(`${s.college}\t${s.batch}`)),
    );
  const sectionChoices = useMemo(() => {
    const list = sectionsFor(applied.colleges, applied.batches);
    const manyBatches = new Set(list.map((s) => `${s.college}\t${s.batch}`)).size > 1;
    const seen = new Map<string, string>();
    for (const s of list) seen.set(`${s.batch}\t${s.section}`, manyBatches ? `${s.batch} — ${s.section}` : s.section);
    return [...seen.entries()].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [o, applied.colleges, applied.batches]);
  const subjectNames = (colleges: string[], category: string) =>
    [...new Set((o?.subjects ?? []).filter((s) => (!colleges.length || colleges.includes(s.college)) && (!category || s.category === category)).map((s) => s.subject))].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    );

  /** Changing a parent filter drops choices it no longer has, so no hidden filter stays on. */
  const change = (patch: Partial<QuizFilters>) => {
    const next = { ...filters, ...patch };
    if (patch.colleges) next.batches = next.colleges.length ? next.batches.filter((b) => next.colleges.includes(b.split("\t")[0]!)) : next.batches;
    if (patch.colleges || patch.batches) {
      const ok = new Set(sectionsFor(next.colleges, next.batches).map((s) => `${s.batch}\t${s.section}`));
      next.sections = next.sections.filter((s) => ok.has(s));
    }
    if ((patch.colleges || patch.category !== undefined) && next.subject && !subjectNames(next.colleges, next.category).includes(next.subject)) next.subject = "";
    onFiltersChange(next);
  };
  const clearAll = () => {
    onFiltersChange(NO_FILTERS);
    setSearch("");
  };
  const openMore = () => {
    setDraft({ sections: applied.sections, category: applied.category, subject: applied.subject });
    setMoreOpen(true);
  };
  const applyMore = () => {
    change({ sections: draft.sections, category: draft.category, subject: draft.subject });
    setMoreOpen(false);
  };
  const sectionLabel = (id: string) => sectionChoices.find((s) => s.id === id)?.label ?? id.split("\t")[1] ?? id;
  const chips: FilterChip[] = [
    ...applied.sections.map((id) => ({ key: `section-${id}`, label: `Section: ${sectionLabel(id)}`, clear: () => change({ sections: applied.sections.filter((x) => x !== id) }) })),
    ...(applied.category ? [{ key: "category", label: `Category: ${applied.category}`, clear: () => change({ category: "" }) }] : []),
    ...(applied.subject ? [{ key: "subject", label: `Subject: ${applied.subject}`, clear: () => change({ subject: "" }) }] : []),
  ];
  const moreCount = (applied.sections.length ? 1 : 0) + (applied.category ? 1 : 0) + (applied.subject ? 1 : 0);
  const anyFilter = applied.colleges.length > 0 || applied.batches.length > 0 || applied.term !== "" || chips.length > 0;

  const onSort = (key: string) =>
    setSorts((s) => ({ ...s, [view]: s[view].key === key ? { key, dir: s[view].dir === "asc" ? "desc" : "asc" } : { key, dir: key === "college" || key === "student" || key === "uid" || key === "section" ? "asc" : "desc" } }));

  const segment = (value: View, label: string, Icon: typeof Search) => (
    <button
      type="button"
      aria-pressed={view === value}
      onClick={() => setView(value)}
      className={cn(
        "inline-flex h-9 items-center gap-2 rounded-md px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-1",
        view === value ? "bg-brand-600 text-white shadow-sm" : "text-slate-700 hover:bg-white hover:text-slate-900",
      )}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      {label}
    </button>
  );

  return (
    <div className="flex min-w-0 flex-col">
      <PageHeader
        title="Assessments"
        right={
          <div className="flex flex-col items-end gap-1">
            <QuizDownload quizType={quizType} filters={applied} counts={kpis.data?.counts} />
            {kpis.data?.asOf ? <p className="text-xs text-slate-500">Data as of {formatAsOf(kpis.data.asOf)}</p> : null}
          </div>
        }
      />

      <ScopeFilterBar
        campusOptions={o?.colleges ?? []}
        campuses={applied.colleges}
        onCampuses={(colleges) => change({ colleges })}
        batchOptions={o?.batches ?? []}
        batches={applied.batches}
        onBatches={(batches) => change({ batches })}
        term={applied.term}
        onTerm={(term) => change({ term })}
        moreCount={moreCount}
        onMore={openMore}
        chips={chips}
        anyFilter={anyFilter}
        onClearAll={clearAll}
        updating={updating}
      />

      <MoreFiltersSheet
        open={moreOpen}
        onOpenChange={setMoreOpen}
        description="Narrow the cards and the table by section, subject category or subject."
        onReset={() => setDraft({ sections: [], category: "", subject: "" })}
        onApply={applyMore}
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
        <FilterField label="Subject category">
          <select
            className={selectClass}
            value={draft.category}
            onChange={(e) => {
              const category = e.target.value;
              setDraft((d) => ({ ...d, category, subject: d.subject && !subjectNames(applied.colleges, category).includes(d.subject) ? "" : d.subject }));
            }}
          >
            <option value="">All categories</option>
            {(o?.categories ?? []).map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Subject">
          <select className={selectClass} value={draft.subject} onChange={(e) => setDraft((d) => ({ ...d, subject: e.target.value }))}>
            <option value="">All subjects</option>
            {subjectNames(applied.colleges, draft.category).map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </FilterField>
      </MoreFiltersSheet>

      <div className="mt-2">{tabs}</div>

      <div className="mt-5 space-y-5">
        <div aria-busy={updating} className={cn("transition-opacity duration-200 motion-reduce:transition-none", updating && "opacity-50")}>
          <QuizKpiCards kpis={kpis.data} loading={kpis.isLoading} failed={kpis.isError} onRetry={() => void kpis.refetch()} quizType={quizType} />
        </div>
        {isSkill(quizType) && o?.missingColleges?.length ? (
          <div role="note" className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-900">
            <p>
              <span className="font-semibold">{o.missingColleges.length} {o.missingColleges.length === 1 ? "college has" : "colleges have"} no Skill Assessment results on the student report</span>, so the numbers above do not include {o.missingColleges.length === 1 ? "it" : "them"}. Their assessment data is not linked to report courses yet.
            </p>
            <details className="mt-1">
              <summary className="cursor-pointer text-xs font-medium underline">Show {o.missingColleges.length === 1 ? "college" : "colleges"}</summary>
              <p className="mt-1 text-xs">{o.missingColleges.join(" · ")}</p>
            </details>
          </div>
        ) : null}

        <section className="relative overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm" aria-busy={updating} aria-label={`${QUIZ_LABEL[quizType].name}, ${view === "campus" ? "college-wise" : "student-wise"}`}>
          <UpdatingBar updating={updating} />
          {/* What this table is: the tab, how it is grouped and how many rows. The filters are in the bar above. */}
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-slate-200 px-4 py-3">
            <h2 className="text-base font-bold text-slate-900">
              {QUIZ_LABEL[quizType].name} <span className="font-medium text-slate-400">·</span> <span className="text-violet-700">{view === "campus" ? "College-wise" : "Student-wise"}</span>
            </h2>
            <p className="text-sm tabular-nums text-slate-500">
              <UpdatingStatus updating={updating}>
                {active.data ? <span className="font-semibold text-slate-900">{fmtInt(active.data.total)}</span> : null} {view === "campus" ? "colleges" : "students"}
              </UpdatingStatus>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 p-4">
            <div role="group" aria-label="View" className="inline-flex gap-1 rounded-lg border border-slate-200 bg-slate-100 p-1">
              {segment("campus", "Campus", Building2)}
              {segment("students", "Students", Users)}
            </div>
            {view === "students" && (
              <label className="relative min-w-[14rem] flex-1 sm:max-w-sm">
                <span className="sr-only">Search by student name or UID</span>
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search name or UID"
                  className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
                />
              </label>
            )}
          </div>

          <div className={cn("transition-opacity duration-200 motion-reduce:transition-none", updating && "opacity-60")}>
            {active.isError && !active.data ? (
              <div role="alert" className="flex items-center justify-between gap-3 p-6 text-sm text-red-800">
                <span>We couldn't load this table.</span>
                <button type="button" onClick={() => void active.refetch()} className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold">
                  Retry
                </button>
              </div>
            ) : view === "campus" ? (
              <CampusTable page={campus.data} loading={campus.isLoading} sort={sort} onSort={onSort} skill={isSkill(quizType)} />
            ) : (
              <StudentTable page={students.data} loading={students.isLoading} sort={sort} onSort={onSort} onOpen={setOpenUid} skill={isSkill(quizType)} />
            )}
          </div>

          <Pager
            page={active.data}
            unit={view === "campus" ? "colleges" : "students"}
            pageSize={pageSize}
            onPage={(next) => setPageState({ key: viewKey, page: next })}
            onPageSize={setPageSize}
          />
        </section>
      </div>

      <QuizStudentPanel uid={openUid} quizType={quizType} onClose={() => setOpenUid(null)} />
    </div>
  );
}
