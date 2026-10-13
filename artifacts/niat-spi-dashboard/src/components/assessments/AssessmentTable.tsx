import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { ArrowDown, ArrowUp, ChevronsLeft, ChevronsRight, ChevronLeft, ChevronRight, ChevronsUpDown, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionError } from "@/components/dashboard/overview";
import { cn } from "@/lib/utils";
import { courseWeight, fmtInt, fmtPct, fmtScore, type AssessmentMetrics } from "@/lib/assessmentMetrics";
import type { SummaryGroupBy, SummaryRow } from "@/lib/assessmentSummary";
import { CompletionCell, FOCUS_RING, TermWiseTag, fmtDateRange } from "./parts";

export interface TableColumn {
  key: string;
  label: string;
  /** Identity columns are always shown; metric columns can be hidden from the Columns menu. */
  kind: "identity" | "metric";
  align?: "left" | "right";
  sortValue?: (row: SummaryRow) => string | number | null;
  render: (row: SummaryRow) => ReactNode;
  /** Plain value for CSV export. */
  csv: (row: SummaryRow) => string | number;
}

const conductedText = (m: AssessmentMetrics) => (m.scheduled ? `${fmtInt(m.conducted)} / ${fmtInt(m.scheduled)}` : "–");

const METRIC_COLUMNS: TableColumn[] = [
  {
    key: "conducted",
    label: "Conducted / scheduled",
    kind: "metric",
    align: "right",
    sortValue: (r) => r.conducted,
    render: (r) => <span className="tabular-nums">{conductedText(r)}</span>,
    csv: (r) => conductedText(r),
  },
  { key: "students", label: "Students", kind: "metric", align: "right", sortValue: (r) => r.students, render: (r) => <span className="tabular-nums">{fmtInt(r.students)}</span>, csv: (r) => r.students },
  { key: "completion", label: "Completion", kind: "metric", align: "right", sortValue: (r) => r.completionPct, render: (r) => <CompletionCell pct={r.completionPct} />, csv: (r) => fmtPct(r.completionPct) },
  { key: "notAttempted", label: "Not attempted", kind: "metric", align: "right", sortValue: (r) => r.notAttempted, render: (r) => <span className="tabular-nums">{fmtInt(r.expectedAttempts ? r.notAttempted : null)}</span>, csv: (r) => (r.expectedAttempts ? r.notAttempted : "–") },
  { key: "avg", label: "Avg (attempted)", kind: "metric", align: "right", sortValue: (r) => r.avgScoreAttempted, render: (r) => <span className="tabular-nums">{fmtScore(r.avgScoreAttempted)}</span>, csv: (r) => fmtScore(r.avgScoreAttempted) },
  { key: "overall", label: "Overall (absent = 0)", kind: "metric", align: "right", sortValue: (r) => r.overallScore, render: (r) => <span className="font-medium tabular-nums">{fmtScore(r.overallScore)}</span>, csv: (r) => fmtScore(r.overallScore) },
];

export const OPTIONAL_METRIC_COLUMNS = METRIC_COLUMNS.map((c) => ({ key: c.key, label: c.label }));

export function columnsFor(groupBy: SummaryGroupBy, campusOnSemesterRows = true): TableColumn[] {
  const text = (key: string, label: string, get: (r: SummaryRow) => string | undefined, extra?: Partial<TableColumn>): TableColumn => ({
    key,
    label,
    kind: "identity",
    sortValue: (r) => get(r) ?? "",
    render: (r) => get(r) ?? "–",
    csv: (r) => get(r) ?? "",
    ...extra,
  });
  const name = (label: string) =>
    text("name", label, (r) => r.name, { render: (r) => <span className="font-medium text-slate-900">{r.name}</span> });

  let identity: TableColumn[];
  switch (groupBy) {
    case "subject":
      identity = [
        name("Subject"),
        {
          key: "weight",
          label: "Course weight",
          kind: "identity",
          align: "right",
          sortValue: (r) => courseWeight(r.name),
          render: (r) => <span className="tabular-nums">{courseWeight(r.name) ?? "–"}</span>,
          csv: (r) => courseWeight(r.name) ?? "",
        },
      ];
      break;
    case "section":
      identity = [name("Section"), text("campus", "Campus", (r) => r.campus), text("semester", "Semester", (r) => r.semester)];
      break;
    case "semester":
      identity = [
        ...(campusOnSemesterRows ? [name("Campus")] : []),
        text("batch", "Batch", (r) => r.batch),
        text("semesterTitle", "Semester title", (r) => r.semesterTitle, {
          render: (r) => (
            <span className="inline-flex items-center gap-2">
              {r.semesterTitle ?? "–"}
              {r.termWise && <TermWiseTag />}
            </span>
          ),
        }),
        text("semester", "Derived semester", (r) => r.semester),
        text("dates", "Dates", (r) => fmtDateRange(r.startDate, r.endDate), { sortValue: (r) => r.startDate ?? "", render: (r) => <span className="whitespace-nowrap tabular-nums">{fmtDateRange(r.startDate, r.endDate)}</span> }),
      ];
      break;
    case "student":
      identity = [
        name("Student"),
        text("studentId", "Student ID", (r) => r.studentId, { render: (r) => <span className="font-mono text-xs">{r.studentId}</span> }),
        text("campus", "Campus", (r) => r.campus),
        text("section", "Section", (r) => r.section),
      ];
      break;
    default:
      identity = [name("Campus")];
  }
  const metrics = groupBy === "student" ? METRIC_COLUMNS.filter((c) => c.key !== "students") : METRIC_COLUMNS;
  return [...identity, ...metrics];
}

type Sort = { key: string; dir: 1 | -1 };

function compare(a: string | number | null, b: string | number | null): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1; // blanks last
  if (b == null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

const PAGE_SIZES = [25, 50, 100];

export function AssessmentTable({
  groupBy,
  columns,
  rows,
  rollup,
  rollupLabel,
  loading,
  updating,
  onRetry,
  onShowSemesters,
}: {
  groupBy: SummaryGroupBy;
  columns: TableColumn[];
  rows: SummaryRow[];
  rollup: AssessmentMetrics | null;
  rollupLabel: string;
  loading: boolean;
  updating: boolean;
  onRetry?: () => void;
  onShowSemesters?: (row: SummaryRow) => void;
}) {
  const [sort, setSort] = useState<Sort>({ key: "completion", dir: 1 });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  useEffect(() => setPage(1), [groupBy, rows, pageSize]);

  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sort.key) ?? columns[0]!;
    const get = col.sortValue ?? (() => null);
    return rows.slice().sort((a, b) => compare(get(a), get(b)) * sort.dir || a.name.localeCompare(b.name));
  }, [rows, columns, sort]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const current = Math.min(page, totalPages);
  const shown = sorted.slice((current - 1) * pageSize, current * pageSize);
  const showSemesters = Boolean(onShowSemesters) && groupBy === "campus";

  if (onRetry) return <SectionError what="the table" onRetry={onRetry} />;
  if (loading && !rows.length) return <div className="p-5"><Skeleton className="h-64 w-full" /></div>;
  if (!rows.length) return <p className="p-5 text-sm text-slate-600">No assessments match these filters.</p>;

  const cellAlign = (c: TableColumn) => (c.align === "right" ? "text-right" : "text-left");
  const sticky = "sticky left-0 z-10";

  return (
    <div aria-busy={updating || undefined} className={cn("transition-opacity", updating && "opacity-60")}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[56rem] text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-white text-xs uppercase tracking-wide text-slate-600">
              {columns.map((c, i) => (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={sort.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : undefined}
                  className={cn("whitespace-nowrap bg-white px-4 py-2 font-medium", cellAlign(c), i === 0 && cn(sticky, "border-r border-slate-100"))}
                >
                  <button
                    type="button"
                    className={cn("inline-flex items-center gap-1 hover:text-slate-900", FOCUS_RING)}
                    onClick={() => setSort((s) => (s.key === c.key ? { key: c.key, dir: s.dir === 1 ? -1 : 1 } : { key: c.key, dir: c.kind === "identity" ? 1 : -1 }))}
                  >
                    {c.label}
                    {sort.key !== c.key ? (
                      <ChevronsUpDown className="h-3 w-3 text-slate-400" aria-hidden="true" />
                    ) : sort.dir === 1 ? (
                      <ArrowUp className="h-3 w-3 text-slate-900" aria-hidden="true" />
                    ) : (
                      <ArrowDown className="h-3 w-3 text-slate-900" aria-hidden="true" />
                    )}
                  </button>
                </th>
              ))}
              {(showSemesters || groupBy === "student") && <th scope="col" className="bg-white px-4 py-2"><span className="sr-only">Actions</span></th>}
            </tr>
          </thead>
          <tbody>
            {rollup && (
              <tr className="border-b-2 border-slate-200 bg-slate-50 font-semibold">
                {columns.map((c, i) => (
                  <td key={c.key} className={cn("px-4 py-2.5", cellAlign(c), i === 0 && cn(sticky, "border-r border-slate-100 bg-slate-50"))}>
                    {i === 0 ? rollupLabel : c.kind === "metric" ? c.render({ ...rollup, id: "__all", name: rollupLabel, semesters: [] }) : ""}
                  </td>
                ))}
                {(showSemesters || groupBy === "student") && <td className="px-4 py-2.5" />}
              </tr>
            )}
            {shown.map((row) => (
              <tr key={row.id} className="group border-b border-slate-100 hover:bg-slate-50">
                {columns.map((c, i) => (
                  <td key={c.key} className={cn("px-4 py-2", cellAlign(c), i === 0 && cn(sticky, "border-r border-slate-100 bg-white group-hover:bg-slate-50"))}>
                    {c.render(row)}
                  </td>
                ))}
                {showSemesters && (
                  <td className="px-4 py-2 text-right">
                    <Button type="button" variant="outline" size="sm" className="h-7" onClick={() => onShowSemesters!(row)} aria-label={`Show semesters for ${row.name}`}>
                      Semesters
                    </Button>
                  </td>
                )}
                {groupBy === "student" && (
                  <td className="whitespace-nowrap px-4 py-2 text-right">
                    {row.spiPath ? (
                      <Link href={row.spiPath} className={cn("inline-flex items-center gap-1 text-xs font-medium text-brand-800 hover:underline", FOCUS_RING)}>
                        View SPI report <ExternalLink className="h-3 w-3" aria-hidden="true" />
                      </Link>
                    ) : (
                      <span className="text-xs text-slate-500" title="Available once live data is connected">View SPI report</span>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <nav aria-label="Table pages" className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-sm text-slate-600">
        <label className="flex items-center gap-2">
          Rows per page
          <select
            className={cn("h-8 rounded-md border border-slate-200 bg-white px-2 tabular-nums", FOCUS_RING)}
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
          >
            {PAGE_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <span className="tabular-nums">· {fmtInt(sorted.length)} rows</span>
        </label>
        <div className="flex items-center gap-1">
          <span className="mr-2 tabular-nums">Page {current} of {totalPages}</span>
          {([
            ["First page", ChevronsLeft, 1, current <= 1],
            ["Previous page", ChevronLeft, current - 1, current <= 1],
            ["Next page", ChevronRight, current + 1, current >= totalPages],
            ["Last page", ChevronsRight, totalPages, current >= totalPages],
          ] as const).map(([label, Icon, target, disabled]) => (
            <Button key={label} type="button" variant="outline" size="sm" className="h-8 w-8 p-0" aria-label={label} disabled={disabled} onClick={() => setPage(target)}>
              <Icon className="h-4 w-4" aria-hidden="true" />
            </Button>
          ))}
        </div>
      </nav>
    </div>
  );
}
