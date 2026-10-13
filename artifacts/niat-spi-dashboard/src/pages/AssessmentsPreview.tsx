/* ------------------------------------------------------------------ */
/*  Assessments (redesign preview). Phase 1: mock data only.          */
/*  Route: /dashboard/assessments-preview                             */
/* ------------------------------------------------------------------ */
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Columns3, Download, FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PageHeader } from "@/components/PageHeader";
import { useAuth } from "@/contexts/AuthContext";
import { useQueryParams } from "@/hooks/useQueryParams";
import { exportCsv } from "@/lib/csv";
import { ASSESSMENT_TYPES, fmtInt, type AssessmentTypeId } from "@/lib/assessmentMetrics";
import {
  buildMockSummary,
  type AssessmentSummary,
  type SummaryGroupBy,
  type SummaryParams,
  type SummarySemester,
  type SummaryType,
} from "@/lib/assessmentSummary";
import { AssessmentTypeTabs } from "@/components/assessments/AssessmentTypeTabs";
import { AssessmentKpiStrip } from "@/components/assessments/AssessmentKpiStrip";
import { AssessmentFilters, GROUP_OPTIONS, SEMESTER_OPTIONS, type FilterState } from "@/components/assessments/AssessmentFilters";
import { AssessmentTable, OPTIONAL_METRIC_COLUMNS, columnsFor } from "@/components/assessments/AssessmentTable";
import { SemesterPanel } from "@/components/assessments/SemesterPanel";
import { CalcExplainer } from "@/components/assessments/CalcExplainer";

const BASE = "/dashboard/assessments-preview";
const COLUMNS_KEY = "assessments-preview-hidden-columns";
const TYPES: SummaryType[] = ["cq", "mq", "all"];
const GROUPS = GROUP_OPTIONS.map((g) => g.id);
const SEMESTERS = SEMESTER_OPTIONS.map((s) => s.value);

const splitList = (v: string | null) => (v ? v.split("||").map((x) => x.trim()).filter(Boolean) : []);

/**
 * Phase 1: resolves mock data after a short delay so loading and "Updating…" can be seen.
 * Phase 3 replaces this body with the generated React Query call to /api/assessments/summary.
 * Add ?mockError=1 to the URL to see the per-section error states.
 */
async function fetchSummary(params: SummaryParams, fail: boolean): Promise<AssessmentSummary> {
  await new Promise((r) => setTimeout(r, 450));
  if (fail) throw new Error("Mock error");
  return buildMockSummary(params);
}

function readHidden(): string[] {
  try {
    return JSON.parse(window.localStorage.getItem(COLUMNS_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}

export default function AssessmentsPreview() {
  const { user } = useAuth();
  const query = useQueryParams();
  const [, setLocation] = useLocation();
  const panelRef = useRef<HTMLDivElement>(null);
  const [hidden, setHidden] = useState<string[]>(readHidden);

  const lockedCampus = user?.role === "boa" && user?.campuses?.length === 1 ? user.campuses[0]! : null;

  /* ---- URL state ---- */
  const rawType = query.get("type");
  const type: SummaryType = TYPES.includes(rawType as SummaryType) ? (rawType as SummaryType) : "cq";
  const rawGroup = query.get("group");
  const groupBy: SummaryGroupBy = GROUPS.includes(rawGroup as SummaryGroupBy) ? (rawGroup as SummaryGroupBy) : "campus";
  const rawSem = query.get("sem");
  const semester: SummarySemester = SEMESTERS.includes(rawSem as SummarySemester) ? (rawSem as SummarySemester) : "current";
  const campuses = lockedCampus ? [lockedCampus] : splitList(query.get("campuses"));
  const sections = campuses.length ? splitList(query.get("sections")).filter((s) => s.includes("\t")) : [];
  const subjects = splitList(query.get("subjects"));
  const student = query.get("q") ?? "";
  const panelCampus = query.get("semCampus") ?? "";
  const mockError = query.get("mockError") === "1";

  const writeQuery = (patch: Record<string, string | undefined>, replace = false) => {
    const next = new URLSearchParams(query);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    const qs = next.toString();
    setLocation(qs ? `${BASE}?${qs}` : BASE, { replace });
  };

  const onFilters = (patch: Partial<FilterState>) => {
    const out: Record<string, string | undefined> = {};
    if (patch.groupBy) out.group = patch.groupBy === "campus" ? undefined : patch.groupBy;
    if (patch.campuses) out.campuses = patch.campuses.join("||") || undefined;
    if (patch.semester) out.sem = patch.semester === "current" ? undefined : patch.semester;
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
  const params: SummaryParams = { type, groupBy, semester, campuses, sections, subjects, student };
  const summary = useQuery({
    queryKey: ["assessments-summary", params, mockError],
    queryFn: () => fetchSummary(params, mockError),
    placeholderData: keepPreviousData,
    staleTime: 15 * 60_000,
    retry: false,
  });
  const data = summary.data ?? null;
  const loading = summary.isLoading;
  const updating = summary.isPlaceholderData;
  const retry = summary.isError ? () => void summary.refetch() : undefined;

  /* ---- columns ---- */
  const allColumns = useMemo(() => columnsFor(groupBy), [groupBy]);
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
  const semLabel = SEMESTER_OPTIONS.find((s) => s.value === semester)!.label;
  const studentsLabel = data ? `${fmtInt(data.overall.students)} students` : "… students";
  const rollupLabel = groupBy === "campus" ? campusLabel : groupBy === "subject" ? "All subjects" : groupBy === "section" ? "All sections" : groupBy === "semester" ? "All semesters" : "All students";

  /* ---- exports ---- */
  const exportView = () => {
    if (!data) return;
    const headers = columns.map((c) => c.label);
    const total = { ...data.overall, id: "__all", name: rollupLabel, semesters: [] };
    const body = [total, ...data.rows].map((r, i) => columns.map((c) => (i === 0 && c.kind === "identity" ? (c === columns[0] ? rollupLabel : "") : c.csv(r))));
    exportCsv(`assessments-${type}-${groupBy}-${new Date().toISOString().slice(0, 10)}.csv`, headers, body);
  };
  const exportAll = async () => {
    const all = await fetchSummary({ ...params, groupBy: "campus", campuses: lockedCampus ? [lockedCampus] : [], sections: [], student: "" }, false);
    const cols = columnsFor("campus");
    exportCsv(
      `assessments-${type}-all-campuses-${new Date().toISOString().slice(0, 10)}.csv`,
      cols.map((c) => c.label),
      [{ ...all.overall, id: "__all", name: "All campuses", semesters: [] }, ...all.rows].map((r) => cols.map((c) => c.csv(r))),
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
                  {OPTIONAL_METRIC_COLUMNS.filter((c) => allColumns.some((a) => a.key === c.key)).map((c) => (
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
            <Button variant="outline" size="sm" className="gap-2" onClick={exportView} disabled={!data}>
              <Download className="h-4 w-4" aria-hidden="true" /> Export this view
            </Button>
            <Button variant="outline" size="sm" className="gap-2" onClick={() => void exportAll()}>
              <Download className="h-4 w-4" aria-hidden="true" /> Export all campuses
            </Button>
          </div>
        }
      />

      <p className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900 sm:px-5" role="note">
        <FlaskConical className="h-4 w-4 shrink-0" aria-hidden="true" />
        Preview with sample data. The numbers are not real yet; the live page stays at Assessments until this is connected.
      </p>

      <div className="space-y-4 pt-4">
        <AssessmentTypeTabs
          value={type as AssessmentTypeId}
          onChange={(next) => writeQuery({ type: next === "cq" ? undefined : next })}
        />

        <AssessmentKpiStrip metrics={data?.overall ?? null} loading={loading} updating={updating} onRetry={retry} />

        <section className="border-y border-slate-200 bg-white">
          <AssessmentFilters
            state={{ groupBy, campuses, semester, sections, student, subjects }}
            options={data?.options ?? { campuses: [], sections: [], subjects: [] }}
            showCampus={!lockedCampus}
            updating={updating}
            onChange={onFilters}
            onReset={() => setLocation(type === "cq" ? BASE : `${BASE}?type=${type}`)}
          />
          <AssessmentTable
            groupBy={groupBy}
            columns={columns}
            rows={data?.rows ?? []}
            rollup={data?.overall ?? null}
            rollupLabel={rollupLabel}
            loading={loading}
            updating={updating}
            onRetry={retry}
            onShowSemesters={(row) => {
              writeQuery({ semCampus: row.name });
              requestAnimationFrame(() => panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
            }}
          />
        </section>

        <SemesterPanel
          ref={panelRef}
          semesters={data?.semesters ?? []}
          campus={panelCampus}
          campusOptions={[...new Set((data?.semesters ?? []).map((s) => s.campus))].sort()}
          onCampus={(c) => writeQuery({ semCampus: c || undefined })}
          loading={loading}
          updating={updating}
          onRetry={retry}
        />

        <CalcExplainer />
      </div>
    </div>
  );
}
