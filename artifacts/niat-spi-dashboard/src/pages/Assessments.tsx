/* ------------------------------------------------------------------ */
/*  Assessments: classroom and module quiz completion and scores,     */
/*  from GET /api/dashboard/assessments/summary (slot model).         */
/* ------------------------------------------------------------------ */
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { keepPreviousData } from "@tanstack/react-query";
import { Columns3, Download } from "lucide-react";
import {
  getAssessmentSummary,
  getGetAssessmentSummaryQueryKey,
  useGetAssessmentSummary,
  type GetAssessmentSummaryParams,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/dashboard/overview";
import { useAuth } from "@/contexts/AuthContext";
import { useQueryParams } from "@/hooks/useQueryParams";
import { exportCsv } from "@/lib/csv";
import { ASSESSMENT_TYPES, fmtInt, type AssessmentTypeId } from "@/lib/assessmentMetrics";
import type { SummaryGroupBy, SummaryType } from "@/lib/assessmentSummary";
import { AssessmentTypeTabs } from "@/components/assessments/AssessmentTypeTabs";
import { AssessmentKpiStrip } from "@/components/assessments/AssessmentKpiStrip";
import { AssessmentFilters, CURRENT_SEMESTERS, GROUP_OPTIONS, type FilterState } from "@/components/assessments/AssessmentFilters";
import { AssessmentTable, DEFAULT_SORT, columnsFor, rollupRow, type Sort } from "@/components/assessments/AssessmentTable";
import { CalcExplainer } from "@/components/assessments/CalcExplainer";

const BASE = "/dashboard/assessments";
const COLUMNS_KEY = "assessments-hidden-columns";
const TYPES: SummaryType[] = ["cq", "mq"];
const GROUPS = GROUP_OPTIONS.map((g) => g.value);

const splitList = (v: string | null) => (v ? v.split("||").map((x) => x.trim()).filter(Boolean) : []);

function readHidden(): string[] {
  try {
    return JSON.parse(window.localStorage.getItem(COLUMNS_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}

const today = () => new Date().toISOString().slice(0, 10);

/** Old links (/dashboard/assessments/students?campus=…) open the matching view of this page. */
export default function Assessments() {
  const [location, setLocation] = useLocation();
  const legacy = location.startsWith(`${BASE}/`);

  useEffect(() => {
    if (!legacy) return;
    const old = new URLSearchParams(window.location.search);
    const next = new URLSearchParams();
    if (location.includes("/students")) next.set("group", "student");
    else if (location.includes("/subjects")) next.set("group", "subject");
    const campus = old.get("campus");
    if (campus && campus !== "all") next.set("campuses", campus);
    const subject = old.get("subject");
    if (subject) next.set("subjects", subject);
    const qs = next.toString();
    setLocation(qs ? `${BASE}?${qs}` : BASE, { replace: true });
  }, [legacy, location, setLocation]);

  return legacy ? null : <AssessmentsPage />;
}

function AssessmentsPage() {
  const { user } = useAuth();
  const query = useQueryParams();
  const [, setLocation] = useLocation();
  const [hidden, setHidden] = useState<string[]>(readHidden);

  const lockedCampus = user?.role === "boa" && user?.campuses?.length === 1 ? user.campuses[0]! : null;

  /* ---- URL state ---- */
  const rawType = query.get("type");
  const type: SummaryType = TYPES.includes(rawType as SummaryType) ? (rawType as SummaryType) : "cq";
  const rawGroup = query.get("group");
  const groupBy: SummaryGroupBy = GROUPS.includes(rawGroup as SummaryGroupBy) ? (rawGroup as SummaryGroupBy) : "campus";
  // `semesters` is what the Overview sends; one value maps to the semester filter.
  const semester = query.get("sem") || (splitList(query.get("semesters")).length === 1 ? splitList(query.get("semesters"))[0]! : CURRENT_SEMESTERS);
  const campuses = lockedCampus ? [lockedCampus] : splitList(query.get("campuses"));
  const sections = campuses.length ? splitList(query.get("sections")).filter((s) => s.includes("\t")) : [];
  const subjects = splitList(query.get("subjects"));
  const student = query.get("q") ?? "";
  // Campus-wise: the campus whose semester split is open.
  const openCampus = query.get("open") ?? "";

  const writeQuery = (patch: Record<string, string | undefined>, replace = false) => {
    const next = new URLSearchParams(query);
    next.delete("semesters");
    next.delete("semCampus");
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    const qs = next.toString();
    setLocation(qs ? `${BASE}?${qs}` : BASE, { replace });
  };

  const onFilters = (patch: Partial<FilterState>) => {
    const out: Record<string, string | undefined> = {};
    if (patch.groupBy) {
      out.group = patch.groupBy === "campus" ? undefined : patch.groupBy;
      out.open = undefined;
    }
    if (patch.campuses) out.campuses = patch.campuses.join("||") || undefined;
    if (patch.semester) out.sem = patch.semester === CURRENT_SEMESTERS ? undefined : patch.semester;
    if (patch.sections) out.sections = patch.sections.join("||") || undefined;
    if (patch.subjects) out.subjects = patch.subjects.join("||") || undefined;
    if (patch.student !== undefined) {
      out.q = patch.student || undefined;
      // Searching a student shows the student list.
      if (patch.student.trim() && groupBy !== "student") out.group = "student";
    }
    // Typing in the search box replaces the history entry instead of adding one per key.
    writeQuery(out, patch.student !== undefined && Object.keys(patch).length === 1);
  };

  /* ---- data ---- */
  const [debouncedStudent, setDebouncedStudent] = useState(student);
  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedStudent(student), 400);
    return () => window.clearTimeout(id);
  }, [student]);

  const viewParams: GetAssessmentSummaryParams = {
    type,
    groupBy,
    semester,
    ...(campuses.length ? { campuses: campuses.join("||") } : {}),
    ...(sections.length ? { sections: sections.join("||") } : {}),
    ...(subjects.length ? { subjects: subjects.join("||") } : {}),
    ...(debouncedStudent.trim() ? { student: debouncedStudent.trim() } : {}),
  };

  /* ---- sort and page: the server sorts and returns one page ---- */
  const [sort, setSort] = useState<Sort>(DEFAULT_SORT);
  const [pageSize, setPageSize] = useState(50);
  // The page belongs to one set of filters: a new filter, group or sort starts again at page 1.
  const viewKey = JSON.stringify([viewParams, sort, pageSize]);
  const [pageState, setPageState] = useState({ key: viewKey, page: 1 });
  const page = pageState.key === viewKey ? pageState.page : 1;
  const sortParams = { sort: sort.key, dir: sort.dir === -1 ? ("desc" as const) : ("asc" as const) };
  const params: GetAssessmentSummaryParams = { ...viewParams, ...sortParams, page, pageSize };
  const summary = useGetAssessmentSummary(params, {
    query: { queryKey: getGetAssessmentSummaryQueryKey(params), placeholderData: keepPreviousData, staleTime: 15 * 60_000, enabled: Boolean(user) },
  });
  const data = summary.data ?? null;
  const updating = summary.isPlaceholderData;
  const retry = summary.isError ? () => void summary.refetch() : undefined;

  /* ---- columns ---- */
  const multiCampus = campuses.length !== 1;
  const allColumns = useMemo(() => columnsFor(groupBy, { multiCampus }), [groupBy, multiCampus]);
  const metricColumns = allColumns.filter((c) => c.kind === "metric");
  const columns = allColumns.filter((c) => c.kind === "identity" || !hidden.includes(c.key));
  useEffect(() => {
    try {
      window.localStorage.setItem(COLUMNS_KEY, JSON.stringify(hidden));
    } catch {
      /* storage unavailable: keep the choice for this visit only */
    }
  }, [hidden]);

  /* ---- labels ---- */
  const typeLabel = ASSESSMENT_TYPES.find((t) => t.id === type)!.short;
  const campusLabel = campuses.length === 0 ? "All campuses" : campuses.length === 1 ? campuses[0]! : `${campuses.length} campuses`;
  const semLabel = semester === CURRENT_SEMESTERS ? "Current semesters" : semester;
  const studentsLabel = data ? `${fmtInt(data.overall.students)} students` : "… students";
  const groupLabel = GROUP_OPTIONS.find((g) => g.value === groupBy)!.label;
  const rollupLabel =
    groupBy === "campus" ? campusLabel : groupBy === "subject" ? "All subjects" : groupBy === "section" ? "All sections" : groupBy === "semester" ? "All semesters" : "All students";

  /* ---- exports ---- */
  /** CSV needs every row, not the page on screen, so it asks the server for the whole view. */
  const exportView = async () => {
    if (!data) return;
    const all = await getAssessmentSummary({ ...viewParams, ...sortParams, export: "1" });
    const body = [rollupRow(all.overall, rollupLabel), ...all.rows].map((r, i) =>
      columns.map((c, j) => (i === 0 && c.kind === "identity" ? (j === 0 ? rollupLabel : "") : c.csv(r))),
    );
    exportCsv(`assessments-${type}-${groupBy}-${today()}.csv`, columns.map((c) => c.label), body);
  };
  const exportAll = async () => {
    const all = await getAssessmentSummary({ type, groupBy: "campus", semester, export: "1", ...(lockedCampus ? { campuses: lockedCampus } : {}) });
    const cols = columnsFor("campus");
    exportCsv(
      `assessments-${type}-all-campuses-${today()}.csv`,
      cols.map((c) => c.label),
      [rollupRow(all.overall, "All campuses"), ...all.rows].map((r) => cols.map((c) => c.csv(r))),
    );
  };

  return (
    <div className="flex min-w-0 flex-col">
      <PageHeader
        title="Assessments"
        subtitle={`${campusLabel} · ${semLabel} · ${studentsLabel} · ${typeLabel}`}
        right={
          <div className="flex flex-wrap items-center gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2">
                  <Columns3 className="h-4 w-4" aria-hidden="true" /> Columns
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-64">
                <fieldset>
                  <legend className="mb-2 text-sm font-medium text-slate-900">Show columns</legend>
                  {metricColumns.map((c) => (
                    <label key={c.key} className="flex items-center gap-2 py-1 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={!hidden.includes(c.key)}
                        onChange={() => setHidden((h) => (h.includes(c.key) ? h.filter((k) => k !== c.key) : [...h, c.key]))}
                      />
                      {c.label}
                    </label>
                  ))}
                </fieldset>
              </PopoverContent>
            </Popover>
            <Button variant="outline" size="sm" className="gap-2" onClick={() => void exportView()} disabled={!data || !data.rows.length}>
              <Download className="h-4 w-4" aria-hidden="true" /> Export this view
            </Button>
            <Button variant="outline" size="sm" className="gap-2" onClick={() => void exportAll()}>
              <Download className="h-4 w-4" aria-hidden="true" /> Export all campuses
            </Button>
          </div>
        }
      />

      <AssessmentTypeTabs value={type as AssessmentTypeId} onChange={(next) => writeQuery({ type: next === "cq" ? undefined : next })} />

      <AssessmentFilters
        state={{ groupBy, campuses, semester, sections, student, subjects }}
        options={data?.options ?? { campuses: [], semesters: [], sections: [], subjects: [] }}
        showCampus={!lockedCampus}
        updating={updating}
        onChange={onFilters}
        onReset={() => setLocation(type === "cq" ? BASE : `${BASE}?type=${type}`)}
      />

      <div className="space-y-6 pt-4">
        <AssessmentKpiStrip metrics={data?.overall ?? null} updating={updating} onRetry={retry} />

        <Section
          title={campuses.length === 1 && groupBy !== "campus" ? `${groupLabel} · ${campuses[0]}` : groupLabel}
          subtitle={
            data?.needsCampus
              ? "Needs a campus"
              : groupBy === "campus"
                ? "Lowest completion first · click a column to sort · click a campus to see its semester split"
                : groupBy === "semester"
                  ? "Each batch uses its own current semester dates · click a column to sort"
                  : "Lowest completion first · click a column to sort"
          }
          updating={updating}
        >
          <AssessmentTable
            groupBy={groupBy}
            columns={columns}
            rows={data?.rows ?? []}
            rollup={data && data.rows.length ? data.overall : null}
            rollupLabel={rollupLabel}
            loading={summary.isLoading}
            onRetry={retry}
            expandedId={openCampus}
            onToggleExpand={(row) => writeQuery({ open: openCampus === row.id ? undefined : row.id }, true)}
            emptyState={data?.needsCampus ? <PickCampus groupBy={groupBy} /> : undefined}
            sort={sort}
            onSort={setSort}
            page={data?.page ?? page}
            pageSize={pageSize}
            totalPages={data?.totalPages ?? 1}
            totalRows={data?.total ?? 0}
            onPage={(next) => setPageState({ key: viewKey, page: next })}
            onPageSize={setPageSize}
          />
        </Section>

        <CalcExplainer />
      </div>
    </div>
  );
}

/** Shown instead of an empty table when Section- or Student-wise has no campus yet. */
function PickCampus({ groupBy }: { groupBy: SummaryGroupBy }) {
  const students = groupBy === "student";
  return (
    <div className="px-5 py-12 text-center">
      <p className="text-sm font-semibold text-slate-900">{students ? "Pick a campus or section to see students" : "Pick a campus to see sections"}</p>
      <p className="mt-1 text-sm text-slate-600">
        {students
          ? "Choose a campus in the Campus filter above, or search a student by name or ID."
          : "Section-wise lists the sections of one campus. Choose one in the Campus filter above."}
      </p>
    </div>
  );
}
