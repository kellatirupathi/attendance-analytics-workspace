/* ------------------------------------------------------------------ */
/*  Assessments: classroom and module quiz completion and scores,     */
/*  from GET /api/dashboard/assessments/summary (slot model).         */
/* ------------------------------------------------------------------ */
import { useEffect, useMemo, useRef, useState } from "react";
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
import { AssessmentTable, OPTIONAL_METRIC_COLUMNS, columnsFor, rollupRow } from "@/components/assessments/AssessmentTable";
import { SemesterPanel } from "@/components/assessments/SemesterPanel";
import { CalcExplainer } from "@/components/assessments/CalcExplainer";

const BASE = "/dashboard/assessments";
const COLUMNS_KEY = "assessments-hidden-columns";
const TYPES: SummaryType[] = ["cq", "mq", "all"];
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
  const panelRef = useRef<HTMLDivElement>(null);
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
  const panelCampus = query.get("semCampus") ?? "";

  const writeQuery = (patch: Record<string, string | undefined>, replace = false) => {
    const next = new URLSearchParams(query);
    next.delete("semesters");
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

  const params: GetAssessmentSummaryParams = {
    type,
    groupBy,
    semester,
    ...(campuses.length ? { campuses: campuses.join("||") } : {}),
    ...(sections.length ? { sections: sections.join("||") } : {}),
    ...(subjects.length ? { subjects: subjects.join("||") } : {}),
    ...(debouncedStudent.trim() ? { student: debouncedStudent.trim() } : {}),
  };
  const summary = useGetAssessmentSummary(params, {
    query: { queryKey: getGetAssessmentSummaryQueryKey(params), placeholderData: keepPreviousData, staleTime: 15 * 60_000, enabled: Boolean(user) },
  });
  const data = summary.data ?? null;
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
  const semLabel = semester === CURRENT_SEMESTERS ? "Current semesters" : semester;
  const studentsLabel = data ? `${fmtInt(data.overall.students)} students` : "… students";
  const groupLabel = GROUP_OPTIONS.find((g) => g.value === groupBy)!.label;
  const rollupLabel =
    groupBy === "campus" ? campusLabel : groupBy === "subject" ? "All subjects" : groupBy === "section" ? "All sections" : groupBy === "semester" ? "All semesters" : "All students";

  /* ---- exports ---- */
  const exportView = () => {
    if (!data) return;
    const body = [rollupRow(data.overall, rollupLabel), ...data.rows].map((r, i) =>
      columns.map((c, j) => (i === 0 && c.kind === "identity" ? (j === 0 ? rollupLabel : "") : c.csv(r))),
    );
    exportCsv(`assessments-${type}-${groupBy}-${today()}.csv`, columns.map((c) => c.label), body);
  };
  const exportAll = async () => {
    const all = await getAssessmentSummary({ type, groupBy: "campus", semester, ...(lockedCampus ? { campuses: lockedCampus } : {}) });
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
            <Button variant="outline" size="sm" className="gap-2" onClick={exportView} disabled={!data || !data.rows.length}>
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
          title={groupLabel}
          subtitle="Lowest completion first · click a column to sort"
          updating={updating}
        >
          <AssessmentTable
            groupBy={groupBy}
            columns={columns}
            rows={data?.rows ?? []}
            rollup={data && data.rows.length ? data.overall : null}
            rollupLabel={rollupLabel}
            loading={summary.isLoading}
            updating={false}
            onRetry={retry}
            emptyText={data?.needsCampus ? "Pick a campus or section, or search a student, to list students." : undefined}
            onShowSemesters={(row) => {
              writeQuery({ semCampus: row.name });
              requestAnimationFrame(() => panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
            }}
          />
        </Section>

        <SemesterPanel
          ref={panelRef}
          semesters={data?.semesters ?? []}
          campus={panelCampus}
          campusOptions={[...new Set((data?.semesters ?? []).map((s) => s.campus))].sort()}
          onCampus={(c) => writeQuery({ semCampus: c || undefined })}
          loading={summary.isLoading}
          updating={updating}
          onRetry={retry}
        />

        <CalcExplainer />
      </div>
    </div>
  );
}
