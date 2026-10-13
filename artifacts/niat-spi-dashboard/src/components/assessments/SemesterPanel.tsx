import { forwardRef, useMemo } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { SearchableSelect } from "@/components/SearchableSelect";
import { Section, SectionError } from "@/components/dashboard/overview";
import { fmtInt, fmtScore, rollUp, type AssessmentMetrics } from "@/lib/assessmentMetrics";
import type { SemesterMetrics } from "@/lib/assessmentSummary";
import { CompletionCell, TermWiseTag, fmtDateRange } from "./parts";

const ALL = "__all";

interface PanelRow extends AssessmentMetrics {
  key: string;
  label: string;
  detail?: string;
  termWise: boolean;
}

/** "Overall score, all semesters = (attempts × avg) ÷ expected = overall" from the same raw sums. */
function FormulaStrip({ m, scope }: { m: AssessmentMetrics; scope: string }) {
  if (m.expectedAttempts === 0) {
    return <p className="border-b border-slate-200 bg-slate-50 px-5 py-2.5 text-sm text-slate-700">No assessments conducted yet in {scope}, so there is no score.</p>;
  }
  return (
    <p className="border-b border-slate-200 bg-slate-50 px-5 py-2.5 text-sm tabular-nums text-slate-800">
      <span className="font-medium">Overall score, all semesters</span> = ({fmtInt(m.attempted)} attempts × {fmtScore(m.avgScoreAttempted)} avg) ÷{" "}
      {fmtInt(m.expectedAttempts)} expected attempts = <span className="font-semibold">{fmtScore(m.overallScore)}</span>
    </p>
  );
}

export const SemesterPanel = forwardRef<
  HTMLDivElement,
  {
    semesters: SemesterMetrics[];
    campus: string;
    campusOptions: string[];
    onCampus: (campus: string) => void;
    loading: boolean;
    updating: boolean;
    onRetry?: () => void;
  }
>(function SemesterPanel({ semesters, campus, campusOptions, onCampus, loading, updating, onRetry }, ref) {
  const scoped = campus ? semesters.filter((s) => s.campus === campus) : semesters;
  const scopeLabel = campus || "All campuses";

  const rows: PanelRow[] = useMemo(() => {
    if (campus) {
      // One campus: each batch on its own semester and dates (section-level window).
      return scoped
        .slice()
        .sort((a, b) => (a.startDate ?? "").localeCompare(b.startDate ?? ""))
        .map((s) => ({ ...s, key: s.id, label: `${s.batch} · ${s.semester}`, detail: `${s.title} · ${fmtDateRange(s.startDate, s.endDate)}` }));
    }
    // All campuses: add raw counts per derived semester, then divide once.
    const bySem = new Map<string, SemesterMetrics[]>();
    for (const s of scoped) bySem.set(s.semester, [...(bySem.get(s.semester) ?? []), s]);
    return [...bySem.entries()]
      .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
      .map(([sem, list]) => {
        const term = list.filter((s) => s.termWise);
        return {
          ...rollUp(list),
          key: sem,
          label: sem,
          detail: `${list.length} batch${list.length === 1 ? "" : "es"}${term.length ? ` · incl. ${[...new Set(term.map((t) => t.campus))].join(", ")}` : ""}`,
          termWise: term.length > 0,
        };
      });
  }, [scoped, campus]);

  const total = rollUp(scoped);
  const hasTermWise = scoped.some((s) => s.termWise);

  return (
    <div ref={ref} className="scroll-mt-4">
    <Section
      title={`Semester-wise · ${scopeLabel}`}
      subtitle="Each batch uses its own current semester dates"
      updating={updating}
      action={
        <SearchableSelect
          value={campus || ALL}
          onValueChange={(v) => onCampus(v === ALL ? "" : v)}
          options={[{ value: ALL, label: "All campuses" }, ...campusOptions.map((c) => ({ value: c, label: c }))]}
          className="w-[220px]"
        />
      }
    >
      {onRetry ? (
        <SectionError what="semester-wise numbers" onRetry={onRetry} />
      ) : loading && !semesters.length ? (
        <div className="p-5"><Skeleton className="h-40 w-full" /></div>
      ) : !rows.length ? (
        <p className="p-5 text-sm text-slate-600">No semesters match these filters.</p>
      ) : (
        <>
          <FormulaStrip m={total} scope={scopeLabel} />
          {hasTermWise && (
            <p className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-5 py-2 text-xs text-slate-700">
              <TermWiseTag />
              Term-wise institutes have batches on different semesters at the same time, each with its own dates.
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[60rem] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-600">
                  <th scope="col" className="sticky left-0 z-10 bg-white px-4 py-2 font-medium">Semester</th>
                  {["Conducted / scheduled", "Students", "Expected attempts", "Attempted", "Not attempted", "Completion", "Avg (attempted)", "Overall (absent = 0)"].map((h) => (
                    <th key={h} scope="col" className="whitespace-nowrap px-4 py-2 text-right font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className="group border-b border-slate-100 hover:bg-slate-50">
                    <td className="sticky left-0 z-10 bg-white px-4 py-2 group-hover:bg-slate-50">
                      <span className="flex flex-wrap items-center gap-2 font-medium text-slate-900">
                        {r.label}
                        {r.termWise && <TermWiseTag />}
                      </span>
                      {r.detail && <span className="block text-xs text-slate-600">{r.detail}</span>}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{r.scheduled ? `${fmtInt(r.conducted)} / ${fmtInt(r.scheduled)}` : "–"}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmtInt(r.students)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmtInt(r.expectedAttempts)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmtInt(r.attempted)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmtInt(r.expectedAttempts ? r.notAttempted : null)}</td>
                    <td className="px-4 py-2 text-right"><CompletionCell pct={r.completionPct} /></td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmtScore(r.avgScoreAttempted)}</td>
                    <td className="px-4 py-2 text-right font-medium tabular-nums">{fmtScore(r.overallScore)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Section>
    </div>
  );
});
