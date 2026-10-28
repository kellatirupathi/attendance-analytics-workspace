import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtInt } from "@/lib/assessmentMetrics";
import type { CampusRow, Page, StudentRow } from "@/lib/quizCoverage";
import { Pill } from "./quizParts";

export interface Sort {
  key: string;
  dir: "asc" | "desc";
}

interface Column<T> {
  key: string;
  label: string;
  align?: "right";
  render: (row: T) => React.ReactNode;
}

function Head({ columns, sort, onSort, extra }: { columns: { key: string; label: string; align?: "right" }[]; sort: Sort; onSort: (key: string) => void; extra?: boolean }) {
  return (
    <thead className="bg-slate-50 text-xs font-semibold text-slate-600">
      <tr>
        {columns.map((c) => {
          const active = sort.key === c.key;
          return (
            <th key={c.key} scope="col" aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} className={cn("whitespace-nowrap px-4 py-3", c.align === "right" ? "text-right" : "text-left")}>
              <button type="button" onClick={() => onSort(c.key)} className="inline-flex items-center gap-1 rounded hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600">
                {c.label}
                <span aria-hidden="true" className={cn("text-[10px]", active ? "text-brand-600" : "text-transparent")}>
                  {sort.dir === "asc" ? "↑" : "↓"}
                </span>
              </button>
            </th>
          );
        })}
        {extra && <th scope="col" className="w-12 px-2 py-3"><span className="sr-only">Open</span></th>}
      </tr>
    </thead>
  );
}

const cell = "whitespace-nowrap px-4 py-3 text-sm text-slate-700";
const num = `${cell} text-right tabular-nums`;

function Body({ loading, empty, colSpan, rowsCount, children }: { loading: boolean; empty: string; colSpan: number; rowsCount: number; children: React.ReactNode }) {
  if (loading && rowsCount === 0) {
    return (
      <tbody>
        {Array.from({ length: 6 }).map((_, i) => (
          <tr key={i} className="border-t border-slate-100">
            <td colSpan={colSpan} className="px-4 py-3"><Skeleton className="h-5 w-full" /></td>
          </tr>
        ))}
      </tbody>
    );
  }
  if (rowsCount === 0) {
    return (
      <tbody>
        <tr><td colSpan={colSpan} className="px-4 py-12 text-center text-sm text-slate-500">{empty}</td></tr>
      </tbody>
    );
  }
  return <tbody className="divide-y divide-slate-100">{children}</tbody>;
}

export function CampusTable({ page, loading, sort, onSort }: { page: Page<CampusRow> | undefined; loading: boolean; sort: Sort; onSort: (key: string) => void }) {
  const columns: Column<CampusRow>[] = [
    { key: "college", label: "College", render: (r) => r.college },
    { key: "sections", label: "Sections", align: "right", render: (r) => fmtInt(r.sections) },
    { key: "students", label: "Students", align: "right", render: (r) => fmtInt(r.students) },
    { key: "scheduled", label: "Scheduled", align: "right", render: (r) => fmtInt(r.scheduled) },
    { key: "completion", label: "Completion %", align: "right", render: (r) => <Pill metric="completion" value={r.completionPct} /> },
    { key: "avg", label: "Avg score", align: "right", render: (r) => <Pill metric="avg" value={r.avgScore} /> },
    { key: "participation", label: "Participation", align: "right", render: (r) => <Pill metric="participation" value={r.participationPct} /> },
  ];
  const rows = page?.rows ?? [];
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[40rem] text-left">
        <Head columns={columns} sort={sort} onSort={onSort} />
        <Body loading={loading} empty="No colleges match these filters" colSpan={columns.length} rowsCount={rows.length}>
          {rows.map((r) => (
            <tr key={r.college} className="hover:bg-slate-50">
              {columns.map((c) => (
                <td key={c.key} className={c.align === "right" ? num : `${cell} font-medium text-slate-900`}>{c.render(r)}</td>
              ))}
            </tr>
          ))}
        </Body>
      </table>
    </div>
  );
}

export function StudentTable({ page, loading, sort, onSort, onOpen }: { page: Page<StudentRow> | undefined; loading: boolean; sort: Sort; onSort: (key: string) => void; onOpen: (uid: string) => void }) {
  const columns = [
    { key: "student", label: "Student" },
    { key: "uid", label: "UID" },
    { key: "section", label: "Section" },
    { key: "scheduled", label: "Scheduled", align: "right" as const },
    { key: "completed", label: "Completed", align: "right" as const },
    { key: "completion", label: "Completion %", align: "right" as const },
    { key: "avg", label: "Avg score", align: "right" as const },
  ];
  const rows = page?.rows ?? [];
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[46rem] text-left">
        <Head columns={columns} sort={sort} onSort={onSort} extra />
        <Body loading={loading} empty="No students match these filters" colSpan={columns.length + 1} rowsCount={rows.length}>
          {rows.map((r) => (
            <tr key={r.uid} className="hover:bg-slate-50">
              <td className={cell}>
                <button type="button" onClick={() => onOpen(r.uid)} className="font-medium text-brand-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600">
                  {r.name || "Unknown student"}
                </button>
              </td>
              <td className={`${cell} font-mono text-xs text-slate-500`} title={r.uid}>{r.uid.slice(0, 8)}</td>
              <td className={cell}>{r.section}</td>
              <td className={num}>{fmtInt(r.scheduled)}</td>
              <td className={num}>{fmtInt(r.completed)}</td>
              <td className={num}><Pill metric="completion" value={r.completionPct} /></td>
              <td className={num}><Pill metric="avg" value={r.avgScore} /></td>
              <td className="px-2 py-3 text-right">
                <button type="button" onClick={() => onOpen(r.uid)} aria-label={`Open ${r.name || "student"}`} className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600">
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </button>
              </td>
            </tr>
          ))}
        </Body>
      </table>
    </div>
  );
}

/** "1–25 of 42 colleges", page buttons, and the rows-per-page selector. */
export function Pager({ page, unit, pageSize, onPage, onPageSize }: { page: Page<unknown> | undefined; unit: string; pageSize: number; onPage: (p: number) => void; onPageSize: (n: number) => void }) {
  const total = page?.total ?? 0;
  const current = page?.page ?? 1;
  const pages = page?.totalPages ?? 1;
  const from = total === 0 ? 0 : (current - 1) * pageSize + 1;
  const to = Math.min(total, current * pageSize);
  const window = new Set([1, pages, current - 1, current, current + 1].filter((p) => p >= 1 && p <= pages));
  const list = [...window].sort((a, b) => a - b);
  const btn = "inline-flex h-9 min-w-9 items-center justify-center rounded-lg border px-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 disabled:opacity-40";
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-sm text-slate-500">
      <p className="tabular-nums">
        {from}–{to} of {fmtInt(total)} {unit}
      </p>
      <nav aria-label="Pages" className="flex items-center gap-1.5">
        <button type="button" className={`${btn} border-slate-200 text-slate-600`} onClick={() => onPage(current - 1)} disabled={current <= 1} aria-label="Previous page">
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </button>
        {list.map((p, i) => (
          <span key={p} className="flex items-center gap-1.5">
            {i > 0 && p - list[i - 1]! > 1 && <span aria-hidden="true">…</span>}
            <button type="button" onClick={() => onPage(p)} aria-current={p === current ? "page" : undefined} className={cn(btn, p === current ? "border-brand-600 bg-brand-600 text-white" : "border-slate-200 text-slate-700 hover:bg-slate-50")}>
              {p}
            </button>
          </span>
        ))}
        <button type="button" className={`${btn} border-slate-200 text-slate-600`} onClick={() => onPage(current + 1)} disabled={current >= pages} aria-label="Next page">
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </nav>
      <label className="flex items-center gap-2">
        <span>Rows per page</span>
        <select value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))} className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-700">
          {[25, 50, 100].map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
      </label>
    </div>
  );
}
