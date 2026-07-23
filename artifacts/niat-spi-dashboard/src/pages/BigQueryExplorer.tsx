import { useEffect, useMemo, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { TablePagination } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { PageBreadcrumb } from "@/components/PageBreadcrumb";
import { exportCsv } from "@/lib/csv";
import { useDebounceValue } from "@/hooks/useDebounceValue";
import { cn } from "@/lib/utils";
import {
  Database,
  GraduationCap,
  BookOpenCheck,
  ChevronRight,
  SlidersHorizontal,
  Search,
  Download,
  Table as TableIcon,
} from "lucide-react";

/* The only two tables this platform reads from. Both live in the same
 * BigQuery dataset. */
const DATASET = "niat_post_onboarding_engagement_ai_analytics_workspace";

const TABLES = [
  {
    key: "attendance",
    label: "Attendance",
    description: "Session-wise attendance details",
    table: "z_niat_student_session_wise_attendance_details",
    icon: GraduationCap,
    tint: "#eff6ff",
    accent: "#2563eb",
  },
  {
    key: "quizzes",
    label: "Classroom & Module Quizzes",
    description: "Quiz performance details",
    table: "z_niat_students_classroom_and_module_quiz_details",
    icon: BookOpenCheck,
    tint: "#fff3ea",
    accent: "#F25C05",
  },
] as const;

type TableDef = (typeof TABLES)[number];

interface PreviewResponse {
  columns: string[];
  rows: Record<string, unknown>[];
  totalRows: number;
}

/* A column qualifies for a dropdown (categorical) filter when it has a small
 * number of distinct non-empty values across the previewed rows. Higher
 * cardinality columns get a free-text "contains" filter instead. */
const CATEGORICAL_MAX_DISTINCT = 25;

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

export default function BigQueryExplorer() {
  const [openTable, setOpenTable] = useState<TableDef | null>(null);

  if (!openTable) {
    return <TableListView onOpen={setOpenTable} />;
  }
  return <TableDataView table={openTable} onBack={() => setOpenTable(null)} />;
}

/* ------------------------------------------------------------------ */
/* List view — single-column list of tables                          */
/* ------------------------------------------------------------------ */
function TableListView({ onOpen }: { onOpen: (t: TableDef) => void }) {
  return (
    <div className="flex flex-col">
      <PageHeader
        badge="Superadmin"
        title="Data Explorer"
        subtitle="Read-only access to the platform's source data tables."
      />

      <div className="overflow-hidden border-y border-slate-200 bg-white">
        <div className="flex items-center gap-2 border-b border-gray-100 px-5 py-3.5">
          <Database className="h-4 w-4 text-gray-500" />
          <h2 className="text-sm font-bold text-gray-900">Tables</h2>
          <span className="ml-auto rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
            {TABLES.length}
          </span>
        </div>
        <ul>
          {TABLES.map((t) => (
            <li key={t.key}>
              <button
                onClick={() => onOpen(t)}
                className="group flex w-full items-center gap-4 border-b border-gray-100 px-5 py-4 text-left transition-colors last:border-0 hover:bg-gray-50/70"
              >
                <span
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
                  style={{ background: t.tint }}
                >
                  <t.icon
                    className="h-[20px] w-[20px]"
                    style={{ color: t.accent }}
                  />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-gray-900 group-hover:text-brand-700">
                    {t.label}
                  </p>
                </div>
                <span className="hidden text-xs text-gray-400 sm:block">
                  {t.description}
                </span>
                <ChevronRight className="h-5 w-5 shrink-0 text-gray-300 transition-colors group-hover:text-brand-500" />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Data view — full-page table + right-side filter panel             */
/* ------------------------------------------------------------------ */
function TableDataView({
  table,
  onBack,
}: {
  table: TableDef;
  onBack: () => void;
}) {
  // Pagination — server-side, so we walk the whole table page by page.
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(1);

  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  // Global text search — server-side across the entire table.
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounceValue(search, 350);

  // Reset to page 1 when search changes.
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

  // Fetch the current page from BigQuery (with total count) whenever the
  // table, page, or page size changes.
  useEffect(() => {
    let alive = true;
    setIsLoading(true);
    const offset = (page - 1) * pageSize;
    const params = new URLSearchParams({
      dataset: DATASET,
      table: table.table,
      limit: String(pageSize),
      offset: String(offset),
    });
    if (debouncedSearch.trim()) {
      params.set("search", debouncedSearch.trim());
    }
    fetch(`/api/bigquery/preview?${params.toString()}`, {
      credentials: "include",
    })
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: PreviewResponse) => {
        if (!alive) return;
        setColumns(data.columns ?? []);
        setRows(data.rows ?? []);
        setTotalRows(data.totalRows ?? data.rows?.length ?? 0);
      })
      .catch(() => {
        if (!alive) return;
        setColumns([]);
        setRows([]);
        setTotalRows(0);
      })
      .finally(() => {
        if (alive) setIsLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [table.table, page, pageSize, debouncedSearch]);

  // Per-column applied filters. Value "all" = no filter.
  // Categorical columns store an exact value; free-text columns store a
  // "contains" substring.
  const [colFilters, setColFilters] = useState<Record<string, string>>({});

  // Draft state edited inside the drawer, committed on Apply.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [draftSearch, setDraftSearch] = useState("");
  const [draftColFilters, setDraftColFilters] = useState<
    Record<string, string>
  >({});

  // Classify each column as categorical (dropdown) or free-text, and collect
  // distinct values for the categorical ones — derived from the loaded rows.
  const columnMeta = useMemo(() => {
    return columns.map((col) => {
      const distinct = new Set<string>();
      let overflow = false;
      for (const r of rows) {
        const v = cellText(r[col]).trim();
        if (v === "") continue;
        distinct.add(v);
        if (distinct.size > CATEGORICAL_MAX_DISTINCT) {
          overflow = true;
          break;
        }
      }
      return {
        col,
        categorical: !overflow && distinct.size > 0,
        values: Array.from(distinct).sort((a, b) => a.localeCompare(b)),
      };
    });
  }, [columns, rows]);

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      for (const col of Object.keys(colFilters)) {
        const val = colFilters[col] ?? "";
        const meta = columnMeta.find((m) => m.col === col);
        if (meta?.categorical) {
          if (!val || val === "all") continue;
          if (cellText(row[col]) !== val) return false;
        } else {
          const needle = val.trim();
          if (!needle) continue;
          if (!cellText(row[col]).toLowerCase().includes(needle.toLowerCase()))
            return false;
        }
      }
      return true;
    });
  }, [rows, colFilters, columnMeta]);

  // Server-side pagination: totalPages spans the whole table. The current
  // page's rows come from the server; client search/filters narrow within it.
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pagedRows = filteredRows;

  const activeFilterCount =
    (search.trim() ? 1 : 0) +
    Object.values(colFilters).filter((v) => v && v !== "all").length;

  const resetPage = () => setPage(1);

  const handleExport = () => {
    if (columns.length === 0 || filteredRows.length === 0) return;
    exportCsv(
      `${table.key}.csv`,
      columns,
      filteredRows.map((row: Record<string, unknown>) =>
        columns.map((col: string) => cellText(row[col])),
      ),
    );
  };

  const openFilters = () => {
    setDraftSearch(search);
    setDraftColFilters({ ...colFilters });
    setFiltersOpen(true);
  };
  const applyFilters = () => {
    setSearch(draftSearch);
    setColFilters({ ...draftColFilters });
    setFiltersOpen(false);
  };
  const clearDraft = () => {
    setDraftSearch("");
    setDraftColFilters({});
  };
  const clearAll = () => {
    setSearch("");
    setColFilters({});
  };
  const setDraftCol = (col: string, val: string) =>
    setDraftColFilters((prev) => ({ ...prev, [col]: val }));

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col md:h-[100dvh]">
      <PageBreadcrumb
        items={[
          { label: "Data Explorer", onClick: onBack },
          { label: table.label, current: true },
        ]}
      />

      <PageHeader
        title={table.label}
        right={
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                placeholder="Search name, student ID, user ID…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-9 border-gray-200 pl-9"
                disabled={columns.length === 0 && !isLoading}
              />
            </div>

            {activeFilterCount > 0 && (
              <button
                onClick={clearAll}
                className="h-9 shrink-0 px-2 text-sm font-semibold text-red-600 hover:text-red-700 hover:underline"
              >
                Clear filters
              </button>
            )}

            <Button
              variant="outline"
              className="h-9 gap-2 border-gray-200"
              onClick={openFilters}
              disabled={columns.length === 0}
            >
              <SlidersHorizontal className="h-4 w-4" /> Filters
              {activeFilterCount > 0 && (
                <span className="ml-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-600 px-1 text-xs font-semibold text-white">
                  {activeFilterCount}
                </span>
              )}
            </Button>

            <Button
              variant="outline"
              className="h-9 gap-2 border-gray-200"
              onClick={handleExport}
              disabled={filteredRows.length === 0}
            >
              <Download className="h-4 w-4" /> Export
            </Button>
          </div>
        }
      />

      {/* ===== Full-height data table ===== */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden border-y border-slate-200 bg-white">
        {isLoading ? (
          <div className="space-y-4 p-4">
            {Array.from({ length: 10 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : columns.length === 0 ? (
          <div className="flex h-full items-center justify-center p-12 text-center text-gray-500">
            No data found in this table.
          </div>
        ) : (
          <>
            <div className="relative min-h-0 flex-1 overflow-auto">
              {filteredRows.length === 0 ? (
                <div className="flex min-h-[280px] items-center justify-center p-12 text-center text-gray-500">
                  No rows match your filters.
                </div>
              ) : (
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-gray-50 shadow-[inset_0_-1px_0_#e5e7eb]">
                  <TableRow>
                    {columns.map((col) => (
                      <TableHead
                        key={col}
                        className="whitespace-nowrap text-[11px] font-semibold uppercase tracking-wider text-gray-500"
                      >
                        {col}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                    {pagedRows.map((row: Record<string, unknown>, i: number) => (
                      <TableRow key={i} className="hover:bg-gray-50/70">
                        {columns.map((col: string) => (
                          <TableCell
                            key={col}
                            className="max-w-[280px] truncate whitespace-nowrap text-sm text-gray-600"
                            title={cellText(row[col])}
                          >
                            {cellText(row[col])}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
              )}
            </div>

            <TablePagination
              page={currentPage}
              totalPages={totalPages}
              totalItems={totalRows}
              pageSize={pageSize}
              pageSizeOptions={[25, 50, 100, 200]}
              onPageChange={setPage}
              onPageSizeChange={(s) => {
                setPageSize(s);
                resetPage();
              }}
              itemLabel="rows"
            />
          </>
        )}
      </div>

      {/* ===== Right-side filter panel ===== */}
      <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
        <SheetContent side="right" className="flex w-full flex-col sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Filters</SheetTitle>
            <SheetDescription>
              Filter the loaded rows of{" "}
              <span className="font-medium">{table.label}</span> by any column.
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 space-y-5 overflow-y-auto py-6">
            {/* Global search */}
            <div className="space-y-1.5">
              <Label>Search all columns</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <Input
                  placeholder="Search across every column…"
                  value={draftSearch}
                  onChange={(e) => setDraftSearch(e.target.value)}
                  className="h-9 border-gray-200 pl-9"
                />
              </div>
            </div>

            <div className="border-t border-gray-100" />

            {/* Per-column filters */}
            {columnMeta.map((meta) => (
              <div key={meta.col} className="space-y-1.5">
                <Label className="flex items-center gap-1.5">
                  <TableIcon className="h-3.5 w-3.5 text-gray-400" />
                  {meta.col}
                </Label>
                {meta.categorical ? (
                  <Select
                    value={draftColFilters[meta.col] ?? "all"}
                    onValueChange={(v) => setDraftCol(meta.col, v)}
                  >
                    <SelectTrigger className="w-full border-gray-200">
                      <SelectValue placeholder="All" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      {meta.values.map((v) => (
                        <SelectItem key={v} value={v}>
                          {v}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    placeholder="Contains…"
                    value={draftColFilters[meta.col] ?? ""}
                    onChange={(e) => setDraftCol(meta.col, e.target.value)}
                    className="h-9 border-gray-200"
                  />
                )}
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-gray-100 pt-4">
            <Button variant="ghost" onClick={() => setFiltersOpen(false)}>
              Cancel
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={clearDraft}>
                Clear filters
              </Button>
              <Button
                onClick={applyFilters}
                className="bg-brand-600 text-white hover:bg-brand-700"
              >
                Apply filters
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
