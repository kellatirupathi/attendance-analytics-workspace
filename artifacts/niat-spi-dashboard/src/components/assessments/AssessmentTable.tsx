import { Fragment, type ReactNode } from "react";
import { Link } from "wouter";
import { ArrowDown, ArrowUp, Building2, ChevronDown, ChevronRight, ChevronsLeft, ChevronsRight, ChevronLeft, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionError } from "@/components/dashboard/overview";
import { cn } from "@/lib/utils";
import { BAND_LABEL, completionBand, fmtInt, fmtPct, fmtScore } from "@/lib/assessmentMetrics";
import type { SemesterMetrics, SummaryGroupBy, SummaryMetrics, SummaryRow } from "@/lib/assessmentSummary";
import { BandPill, CompletionCell, CoveragePill, FOCUS_RING, TermWiseTag, fmtDateRange, isDataIncomplete } from "./parts";

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

const conductedText = (m: SummaryMetrics) => (m.scheduled ? `${fmtInt(m.conducted)} / ${fmtInt(m.scheduled)}` : "–");
const num = (n: number) => <span className="tabular-nums">{fmtInt(n)}</span>;

/** Every metric column, by key. Each view picks its own set and order (VIEW_METRICS). */
const METRICS: Record<string, TableColumn> = {
  campuses: { key: "campuses", label: "Campuses", kind: "metric", align: "right", sortValue: (r) => r.campuses, render: (r) => num(r.campuses), csv: (r) => r.campuses },
  students: { key: "students", label: "Students", kind: "metric", align: "right", sortValue: (r) => r.students, render: (r) => num(r.students), csv: (r) => r.students },
  conducted: {
    key: "conducted",
    label: "Conducted / scheduled",
    kind: "metric",
    align: "right",
    sortValue: (r) => r.conducted,
    render: (r) => (
      <span className="tabular-nums">
        <span className="font-medium text-[#0B1F4D]">{conductedText(r)}</span>
        {r.scheduled > 0 && <span className="block text-xs text-[#6B7280]">{fmtPct(r.conductedPct)}</span>}
      </span>
    ),
    csv: (r) => conductedText(r),
  },
  // Student-wise: the student's own conducted quizzes, i.e. their expected attempts (the roll-up adds them up).
  studentConducted: { key: "studentConducted", label: "Conducted", kind: "metric", align: "right", sortValue: (r) => r.expectedAttempts, render: (r) => num(r.expectedAttempts), csv: (r) => r.expectedAttempts },
  expected: { key: "expected", label: "Expected attempts", kind: "metric", align: "right", sortValue: (r) => r.expectedAttempts, render: (r) => num(r.expectedAttempts), csv: (r) => r.expectedAttempts },
  attempted: { key: "attempted", label: "Attempted", kind: "metric", align: "right", sortValue: (r) => r.attempted, render: (r) => num(r.attempted), csv: (r) => r.attempted },
  notAttempted: { key: "notAttempted", label: "Not attempted", kind: "metric", align: "right", sortValue: (r) => r.notAttempted, render: (r) => <span className="tabular-nums">{fmtInt(r.expectedAttempts ? r.notAttempted : null)}</span>, csv: (r) => (r.expectedAttempts ? r.notAttempted : "–") },
  completion: { key: "completion", label: "Completion %", kind: "metric", align: "right", sortValue: (r) => r.completionPct, render: (r) => <CompletionCell pct={r.completionPct} />, csv: (r) => fmtPct(r.completionPct) },
  // Good / Watch / Low stays the performance band; "Data incomplete" is separate and only shows where quiz records are missing.
  status: {
    key: "status",
    label: "Performance status",
    kind: "metric",
    align: "left",
    sortValue: (r) => r.completionPct,
    render: (r) => (
      <div className="flex flex-col items-start gap-1">
        {r.completionPct != null ? <BandPill pct={r.completionPct} /> : <span className="text-slate-500">–</span>}
        <CoveragePill m={r} />
      </div>
    ),
    csv: (r) => {
      const band = completionBand(r.completionPct);
      return [band ? BAND_LABEL[band] : "–", isDataIncomplete(r) ? "Data incomplete" : ""].filter(Boolean).join(" · ");
    },
  },
  avg: { key: "avg", label: "Avg (attempted)", kind: "metric", align: "right", sortValue: (r) => r.avgScoreAttempted, render: (r) => <span className="tabular-nums">{fmtScore(r.avgScoreAttempted)}</span>, csv: (r) => fmtScore(r.avgScoreAttempted) },
  overall: { key: "overall", label: "Overall (absent = 0)", kind: "metric", align: "right", sortValue: (r) => r.overallScore, render: (r) => <span className="font-medium tabular-nums">{fmtScore(r.overallScore)}</span>, csv: (r) => fmtScore(r.overallScore) },
};

const VIEW_METRICS: Record<SummaryGroupBy, string[]> = {
  campus: ["students", "conducted", "expected", "attempted", "notAttempted", "completion", "avg", "overall", "status"],
  subject: ["campuses", "students", "conducted", "completion", "notAttempted", "avg", "overall", "status"],
  section: ["students", "conducted", "completion", "notAttempted", "avg", "overall", "status"],
  semester: ["students", "conducted", "expected", "attempted", "completion", "avg", "overall", "status"],
  student: ["studentConducted", "attempted", "notAttempted", "completion", "avg", "overall", "status"],
};

/** A full row object for the roll-up ("All campuses") line and its CSV export. */
export function rollupRow(m: SummaryMetrics, label: string): SummaryRow {
  return {
    ...m,
    id: "__all",
    name: label,
    campus: null,
    section: null,
    semester: null,
    batch: null,
    semesterTitle: null,
    startDate: null,
    endDate: null,
    termWise: false,
    studentId: null,
    spiPath: null,
    semesters: [],
  };
}

/** Columns of one Group by view. Section-wise adds a Campus column only when several campuses are picked. */
export function columnsFor(groupBy: SummaryGroupBy, opts: { multiCampus?: boolean } = {}): TableColumn[] {
  const text = (key: string, label: string, get: (r: SummaryRow) => string | null | undefined, extra?: Partial<TableColumn>): TableColumn => ({
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
      identity = [name("Subject")];
      break;
    case "section":
      identity = [name("Section"), ...(opts.multiCampus ? [text("campus", "Campus", (r) => r.campus)] : []), text("semester", "Semester", (r) => r.semester)];
      break;
    case "semester":
      identity = [
        name("Campus"),
        text("batch", "Batch", (r) => r.batch),
        text("semester", "Semester (derived)", (r) => r.semester, {
          render: (r) => (
            <span className="inline-flex items-center gap-2 whitespace-nowrap" title={r.semesterTitle ?? undefined}>
              {r.semester ?? "–"}
              {r.termWise && <TermWiseTag />}
            </span>
          ),
        }),
        text("dates", "Dates", (r) => fmtDateRange(r.startDate, r.endDate), { sortValue: (r) => r.startDate ?? "", render: (r) => <span className="whitespace-nowrap tabular-nums">{fmtDateRange(r.startDate, r.endDate)}</span> }),
      ];
      break;
    case "student":
      identity = [
        name("Student"),
        text("studentId", "Student ID", (r) => r.studentId, { render: (r) => <span className="font-mono text-xs">{r.studentId}</span> }),
        text("section", "Section", (r) => r.section),
      ];
      break;
    default:
      identity = [name("Campus")];
  }
  return [...identity, ...VIEW_METRICS[groupBy].map((key) => METRICS[key]!)];
}

/** One campus's batches, each on its own current semester and dates. Opens under the campus row. */
function SemesterSplit({ semesters }: { semesters: SemesterMetrics[] }) {
  if (!semesters.length) return <p className="px-5 py-3 text-sm text-slate-600">No semesters for this campus.</p>;
  const rows = semesters.slice().sort((a, b) => (a.startDate ?? "").localeCompare(b.startDate ?? ""));
  const heads = ["Batch · semester", "Dates", "Students", "Conducted / scheduled", "Expected attempts", "Attempted", "Completion", "Avg (attempted)", "Overall (absent = 0)"];
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-brand-100 text-left text-xs uppercase tracking-wide text-slate-500">
          {heads.map((h, i) => (
            <th key={h} scope="col" className={cn("whitespace-nowrap px-4 py-2 font-medium", i > 1 && "text-right", i === 0 && "pl-12")}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((s) => (
          <tr key={s.id} className="border-b border-brand-100 last:border-b-0">
            <td className="py-2 pl-12 pr-4">
              <span className="flex flex-wrap items-center gap-2 font-medium text-slate-900">
                {s.batch} · {s.semester}
                {s.termWise && <TermWiseTag />}
              </span>
              <span className="block text-xs text-slate-600">{s.title}</span>
            </td>
            <td className="whitespace-nowrap px-4 py-2 tabular-nums">{fmtDateRange(s.startDate, s.endDate)}</td>
            <td className="px-4 py-2 text-right tabular-nums">{fmtInt(s.students)}</td>
            <td className="px-4 py-2 text-right tabular-nums">{conductedText(s)}</td>
            <td className="px-4 py-2 text-right tabular-nums">{fmtInt(s.expectedAttempts)}</td>
            <td className="px-4 py-2 text-right tabular-nums">{fmtInt(s.attempted)}</td>
            <td className="px-4 py-2 text-right">
              <span className="inline-flex items-center justify-end gap-2">
                <CompletionCell pct={s.completionPct} />
                <BandPill pct={s.completionPct} />
              </span>
            </td>
            <td className="px-4 py-2 text-right tabular-nums">{fmtScore(s.avgScoreAttempted)}</td>
            <td className="px-4 py-2 text-right font-medium tabular-nums">{fmtScore(s.overallScore)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Column key and direction; the server sorts the rows (see assessmentSummarySort.ts in the API server). */
export type Sort = { key: string; dir: 1 | -1 };

export const DEFAULT_SORT: Sort = { key: "completion", dir: 1 };

/** Next sort after clicking a header: the same column flips; a new column starts A–Z for text, high-first for numbers. */
export function nextSort(current: Sort, column: TableColumn): Sort {
  if (current.key === column.key) return { key: column.key, dir: current.dir === 1 ? -1 : 1 };
  return { key: column.key, dir: column.kind === "identity" ? 1 : -1 };
}

const PAGE_SIZES = [25, 50, 100];

export function AssessmentTable({
  groupBy,
  columns,
  rows,
  rollup,
  rollupLabel,
  loading,
  onRetry,
  expandedId,
  onToggleExpand,
  emptyState,
  sort,
  onSort,
  page,
  pageSize,
  totalPages,
  totalRows,
  onPage,
  onPageSize,
  rowAction,
}: {
  /** Action link of a row besides Student-wise's SPI report, e.g. Campus-wise "View sections". */
  rowAction?: (row: SummaryRow) => { href: string; label: string } | null;
  groupBy: SummaryGroupBy;
  columns: TableColumn[];
  /** The rows of the current page, already sorted by the server. */
  rows: SummaryRow[];
  rollup: SummaryMetrics | null;
  rollupLabel: string;
  loading: boolean;
  onRetry?: () => void;
  /** Campus-wise: the campus whose semester split is open. */
  expandedId?: string;
  onToggleExpand?: (row: SummaryRow) => void;
  /** Shown instead of the table when there are no rows. */
  emptyState?: ReactNode;
  sort: Sort;
  onSort: (next: Sort) => void;
  page: number;
  pageSize: number;
  totalPages: number;
  /** Rows across all pages. */
  totalRows: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
}) {
  const current = page;
  const shown = rows;
  const expandable = groupBy === "campus" && Boolean(onToggleExpand);
  const withLink = groupBy === "student" || Boolean(rowAction);
  const span = columns.length + 1 + (withLink ? 1 : 0);

  if (onRetry) return <SectionError what="the table" onRetry={onRetry} />;
  if (loading && !rows.length) return <div className="p-5"><Skeleton className="h-64 w-full" /></div>;
  if (!rows.length) return <>{emptyState ?? <p className="p-5 text-sm text-slate-600">No assessments match these filters.</p>}</>;

  const cellAlign = (c: TableColumn) => (c.align === "right" ? "text-right" : "text-left");
  // The rank column and the name column stay in view when the table scrolls sideways.
  const rankWidth = "w-12 min-w-[3rem] max-w-[3rem]";
  const stickyRank = cn("sticky left-0 z-10", rankWidth);
  const sticky = "sticky left-12 z-10";
  const firstRank = (page - 1) * pageSize;

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[56rem] text-sm">
          <thead>
            <tr className="border-b border-[#E6ECF5] bg-white text-left text-xs font-semibold text-[#0B1F4D]">
              <th scope="col" className={cn("bg-white px-3 py-3 text-center font-semibold text-[#6B7280]", stickyRank)}>#</th>
              {columns.map((c, i) => (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={sort.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : undefined}
                  className={cn("whitespace-nowrap bg-white px-4 py-3 font-semibold", cellAlign(c), i === 0 && cn(sticky, "border-r border-[#E6ECF5]"))}
                >
                  <button
                    type="button"
                    className={cn("inline-flex items-center gap-1 hover:text-slate-900", FOCUS_RING)}
                    onClick={() => onSort(nextSort(sort, c))}
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
              {withLink && <th scope="col" className="bg-white px-4 py-3 text-center font-semibold">Action</th>}
            </tr>
          </thead>
          <tbody>
            {rollup && (
              <tr className="border-b border-[#E6ECF5] bg-[#EAF1FF] font-semibold text-[#0B1F4D]">
                <td className={cn("bg-[#EAF1FF] px-3 py-3 text-center text-[#6B7280]", stickyRank)}>–</td>
                {columns.map((c, i) => (
                  <td key={c.key} className={cn("px-4 py-3", cellAlign(c), i === 0 && cn(sticky, "border-r border-[#DCE6FB] bg-[#EAF1FF]"))}>
                    {i === 0 ? rollupLabel : c.kind === "metric" ? c.render(rollupRow(rollup, rollupLabel)) : ""}
                  </td>
                ))}
                {withLink && <td className="px-4 py-3" />}
              </tr>
            )}
            {shown.map((row, index) => {
              const open = expandable && expandedId === row.id;
              return (
                <Fragment key={row.id}>
                  <tr className={cn("group border-b border-[#E6ECF5]", open ? "bg-[#EAF1FF]" : "hover:bg-[#F8FAFD]")}>
                    <td className={cn("px-3 py-3 text-center text-xs tabular-nums text-[#6B7280]", stickyRank, open ? "bg-[#EAF1FF]" : "bg-white group-hover:bg-[#F8FAFD]")}>
                      {firstRank + index + 1}
                    </td>
                    {columns.map((c, i) => (
                      <td
                        key={c.key}
                        className={cn(
                          "px-4 py-3 align-middle text-[#0B1F4D]",
                          cellAlign(c),
                          i === 0 && cn(sticky, "border-r border-[#E6ECF5]", open ? "bg-[#EAF1FF]" : "bg-white group-hover:bg-[#F8FAFD]"),
                        )}
                      >
                        {i === 0 && expandable ? (
                          <button
                            type="button"
                            aria-expanded={open}
                            onClick={() => onToggleExpand!(row)}
                            className={cn("inline-flex min-h-8 items-center gap-2.5 text-left font-semibold text-[#0B1F4D] hover:text-[#2563EB]", FOCUS_RING)}
                          >
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#EAF1FF] text-[#2563EB]">
                              <Building2 className="h-4 w-4" aria-hidden="true" />
                            </span>
                            {row.name}
                            {open ? <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" /> : <ChevronRight className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />}
                            <span className="sr-only">{open ? ": hide semesters" : ": show semesters"}</span>
                          </button>
                        ) : (
                          c.render(row)
                        )}
                      </td>
                    ))}
                    {withLink && (
                      <td className="whitespace-nowrap px-4 py-3 text-center">
                        {(() => {
                          const action = row.spiPath ? { href: row.spiPath, label: "View SPI report" } : (rowAction?.(row) ?? null);
                          return action ? (
                            <Link
                              href={action.href}
                              aria-label={`${action.label}: ${row.name}`}
                              title={action.label}
                              className={cn("inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#DCE6FB] text-[#2563EB] hover:bg-[#EAF1FF]", FOCUS_RING)}
                            >
                              <ChevronRight className="h-4 w-4" aria-hidden="true" />
                            </Link>
                          ) : null;
                        })()}
                      </td>
                    )}
                  </tr>
                  {open && (
                    <tr className="border-b border-slate-200 bg-brand-50/40">
                      <td colSpan={span} className="p-0">
                        <SemesterSplit semesters={row.semesters} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <nav aria-label="Table pages" className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-sm text-slate-600">
        <label className="flex items-center gap-2">
          Rows per page
          <select
            className={cn("h-8 rounded-md border border-slate-200 bg-white px-2 tabular-nums", FOCUS_RING)}
            value={pageSize}
            onChange={(e) => onPageSize(Number(e.target.value))}
          >
            {PAGE_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <span className="tabular-nums">· {fmtInt(totalRows)} rows</span>
        </label>
        <div className="flex items-center gap-1">
          <span className="mr-2 tabular-nums">Page {current} of {totalPages}</span>
          {([
            ["First page", ChevronsLeft, 1, current <= 1],
            ["Previous page", ChevronLeft, current - 1, current <= 1],
            ["Next page", ChevronRight, current + 1, current >= totalPages],
            ["Last page", ChevronsRight, totalPages, current >= totalPages],
          ] as const).map(([label, Icon, target, disabled]) => (
            <Button key={label} type="button" variant="outline" size="sm" className="h-8 w-8 p-0" aria-label={label} disabled={disabled} onClick={() => onPage(target)}>
              <Icon className="h-4 w-4" aria-hidden="true" />
            </Button>
          ))}
        </div>
      </nav>
    </div>
  );
}
