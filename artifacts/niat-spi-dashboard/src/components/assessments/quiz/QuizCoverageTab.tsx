import { useEffect, useMemo, useState, type ReactNode } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/PageHeader";
import { formatAsOf, NO_FILTERS, quizApi, type QuizFilters, type QuizType } from "@/lib/quizCoverage";
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
const selectClass = "h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 disabled:bg-slate-50 disabled:text-slate-500";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex min-w-[10rem] flex-1 flex-col gap-1.5 text-xs font-medium text-slate-600">
      {label}
      {children}
    </label>
  );
}

/**
 * Assessments → Classroom Quiz (and Module Quiz, by quizType): filters, four cards, a Campus | Students table,
 * a student side panel and one Download button. Numbers come from the server; filters apply to everything.
 */
export function QuizCoverageTab({ quizType, tabs }: { quizType: QuizType; tabs: ReactNode }) {
  // Draft = what the selects show; applied = what the page uses (changes on Apply).
  const [draft, setDraft] = useState<QuizFilters>(NO_FILTERS);
  const [applied, setApplied] = useState<QuizFilters>(NO_FILTERS);
  const [view, setView] = useState<View>("campus");
  const [sorts, setSorts] = useState(DEFAULT_SORT);
  const [pageSize, setPageSize] = useState(25);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [openUid, setOpenUid] = useState<string | null>(null);

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

  /* ---- filter choices that depend on each other ---- */
  const o = options.data;
  const sectionNames = useMemo(
    () => [...new Set((o?.sections ?? []).filter((s) => !draft.college || s.college === draft.college).map((s) => s.section))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    [o, draft.college],
  );
  const subjectNames = useMemo(
    () => [...new Set((o?.subjects ?? []).filter((s) => (!draft.college || s.college === draft.college) && (!draft.category || s.category === draft.category)).map((s) => s.subject))].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })),
    [o, draft.college, draft.category],
  );
  const change = (patch: Partial<QuizFilters>) =>
    setDraft((d) => {
      const next = { ...d, ...patch };
      if (patch.college !== undefined || patch.category !== undefined) {
        const sections = (o?.sections ?? []).filter((s) => !next.college || s.college === next.college).map((s) => s.section);
        if (next.section && !sections.includes(next.section)) next.section = "";
        const subjects = (o?.subjects ?? []).filter((s) => (!next.college || s.college === next.college) && (!next.category || s.category === next.category)).map((s) => s.subject);
        if (next.subject && !subjects.includes(next.subject)) next.subject = "";
      }
      return next;
    });
  const reset = () => {
    setDraft(NO_FILTERS);
    setApplied(NO_FILTERS);
    setSearch("");
  };

  const onSort = (key: string) =>
    setSorts((s) => ({ ...s, [view]: s[view].key === key ? { key, dir: s[view].dir === "asc" ? "desc" : "asc" } : { key, dir: key === "college" || key === "student" || key === "uid" || key === "section" ? "asc" : "desc" } }));

  const segment = (value: View, label: string) => (
    <button
      type="button"
      aria-pressed={view === value}
      onClick={() => setView(value)}
      className={cn("h-9 rounded-md px-4 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600", view === value ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900")}
    >
      {label}
    </button>
  );

  return (
    <div className="flex min-w-0 flex-col">
      <PageHeader title="Assessments" right={kpis.data?.asOf ? <p className="text-sm text-slate-500">Data as of {formatAsOf(kpis.data.asOf)}</p> : undefined} />

      <form
        className="mt-4 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
        onSubmit={(e) => {
          e.preventDefault();
          setApplied(draft);
        }}
      >
        <Field label="College">
          <select className={selectClass} value={draft.college} onChange={(e) => change({ college: e.target.value })}>
            <option value="">All colleges</option>
            {(o?.colleges ?? []).map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </Field>
        <Field label="Semester">
          <select className={selectClass} value="current" disabled onChange={() => undefined}>
            <option value="current">Current semester</option>
          </select>
        </Field>
        <Field label="Section">
          <select className={selectClass} value={draft.section} onChange={(e) => change({ section: e.target.value })}>
            <option value="">All sections</option>
            {sectionNames.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </Field>
        <Field label="Subject category">
          <select className={selectClass} value={draft.category} onChange={(e) => change({ category: e.target.value })}>
            <option value="">All categories</option>
            {(o?.categories ?? []).map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </Field>
        <Field label="Subject">
          <select className={selectClass} value={draft.subject} onChange={(e) => change({ subject: e.target.value })}>
            <option value="">All subjects</option>
            {subjectNames.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </Field>
        <div className="flex gap-2">
          <button type="button" onClick={reset} className="h-10 rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600">
            Reset
          </button>
          <button type="submit" className="h-10 rounded-lg bg-brand-600 px-5 text-sm font-semibold text-white hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2">
            Apply
          </button>
        </div>
      </form>

      <div className="mt-5">{tabs}</div>

      <div className="mt-5 space-y-5">
        <QuizKpiCards kpis={kpis.data} loading={kpis.isLoading} failed={kpis.isError} onRetry={() => void kpis.refetch()} quizType={quizType} />

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm" aria-label="Results">
          <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 p-4">
            <div role="group" aria-label="View" className="inline-flex rounded-lg bg-slate-100 p-1">
              {segment("campus", "Campus")}
              {segment("students", "Students")}
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
            <div className="ml-auto">
              <QuizDownload quizType={quizType} filters={applied} counts={kpis.data?.counts} />
            </div>
          </div>

          {active.isError && !active.data ? (
            <div role="alert" className="flex items-center justify-between gap-3 p-6 text-sm text-red-800">
              <span>We couldn't load this table.</span>
              <button type="button" onClick={() => void active.refetch()} className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold">
                Retry
              </button>
            </div>
          ) : view === "campus" ? (
            <CampusTable page={campus.data} loading={campus.isLoading} sort={sort} onSort={onSort} />
          ) : (
            <StudentTable page={students.data} loading={students.isLoading} sort={sort} onSort={onSort} onOpen={setOpenUid} />
          )}

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
