import { useEffect, useMemo, useState } from "react";
import {
  useGetDashboardStudents,
  getGetDashboardStudentsQueryKey,
  useGetDashboardFilters,
  getGetDashboardFiltersQueryKey,
  type DashboardStudent,
} from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/PageHeader";
import { TableShell, TablePagination } from "@/components/DataTable";
import {
  Search,
  Download,
  ExternalLink,
  SlidersHorizontal,
  Loader2,
} from "lucide-react";
import { pctTextColor } from "@/lib/utils";
import { useDebounceValue } from "@/hooks/useDebounceValue";
import { exportCsv } from "@/lib/csv";

const FETCH_LIMIT = 5000;
const PAGE_SIZES = [25, 50, 100, 200];
const ATT_BUCKETS = [
  { key: "all", label: "All attendance" },
  { key: "below50", label: "Below 50%" },
  { key: "below80", label: "Below 80% (Recovery)" },
  { key: "above80", label: "80% and above" },
];

type SortKey = "default" | "attendance-desc" | "attendance-asc";

export default function Students() {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounceValue(search, 350);

  const [campusFilter, setCampusFilter] = useState("all");
  const [sectionFilter, setSectionFilter] = useState("all");
  const [attFilter, setAttFilter] = useState("all");

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [draftCampus, setDraftCampus] = useState("all");
  const [draftSection, setDraftSection] = useState("all");
  const [draftAtt, setDraftAtt] = useState("all");

  const [sort, setSort] = useState<SortKey>("default");
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(1);

  const filterCampusParam =
    draftCampus !== "all" ? draftCampus : undefined;

  const { data: filterOptions, isLoading: filtersLoading } =
    useGetDashboardFilters(
      { campus: filterCampusParam },
      {
        query: {
          queryKey: getGetDashboardFiltersQueryKey({
            campus: filterCampusParam,
          }),
          enabled: filtersOpen,
          staleTime: 60_000,
          refetchOnWindowFocus: true,
        },
      },
    );

  const campusOptions = filterOptions?.campuses ?? [];
  const sectionOptions = filterOptions?.sections ?? [];

  useEffect(() => {
    if (
      draftSection !== "all" &&
      sectionOptions.length > 0 &&
      !sectionOptions.includes(draftSection)
    ) {
      setDraftSection("all");
    }
  }, [draftSection, sectionOptions]);

  const studentQuery = {
    search: debouncedSearch || undefined,
    limit: FETCH_LIMIT,
    campus: campusFilter !== "all" ? campusFilter : undefined,
    section: sectionFilter !== "all" ? sectionFilter : undefined,
    attendanceBand: attFilter !== "all" ? attFilter : undefined,
  };

  const { data: students, isLoading, isFetching } = useGetDashboardStudents(
    studentQuery,
    {
      query: {
        queryKey: getGetDashboardStudentsQueryKey(studentQuery),
        staleTime: 30_000,
      },
    },
  );

  const rows = useMemo<DashboardStudent[]>(() => students ?? [], [students]);

  const sorted = useMemo(() => {
    if (sort === "default") return rows;
    return [...rows].sort((a, b) =>
      sort === "attendance-asc"
        ? a.attendancePct - b.attendancePct
        : b.attendancePct - a.attendancePct,
    );
  }, [rows, sort]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paged = sorted.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );

  const resetPage = () => setPage(1);

  const activeFilterCount =
    (campusFilter !== "all" ? 1 : 0) +
    (sectionFilter !== "all" ? 1 : 0) +
    (attFilter !== "all" ? 1 : 0);

  const openFilters = () => {
    setDraftCampus(campusFilter);
    setDraftSection(sectionFilter);
    setDraftAtt(attFilter);
    setFiltersOpen(true);
  };

  const applyFilters = () => {
    setCampusFilter(draftCampus);
    setSectionFilter(draftSection);
    setAttFilter(draftAtt);
    setFiltersOpen(false);
    resetPage();
  };

  const clearDraft = () => {
    setDraftCampus("all");
    setDraftSection("all");
    setDraftAtt("all");
  };

  const clearAll = () => {
    setCampusFilter("all");
    setSectionFilter("all");
    setAttFilter("all");
    resetPage();
  };

  const handleExport = () => {
    exportCsv(
      "students.csv",
      [
        "Student ID",
        "Name",
        "Campus",
        "Section",
        "Present",
        "Total",
        "Attendance %",
        "Classroom Quiz %",
        "Module Quiz %",
      ],
      sorted.map((s) => [
        s.studentId,
        s.studentName,
        s.instituteName,
        s.sectionName ?? "",
        s.presentCount,
        s.totalCount,
        s.attendancePct,
        s.classroomAvg ?? "",
        s.moduleAvg ?? "",
      ]),
    );
  };

  return (
    <div>
      <PageHeader
        title="Students"
        subtitle="Search and review student attendance standing across campuses."
        right={
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[200px] flex-1 sm:w-64 sm:flex-none">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                placeholder="Search students by name…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  resetPage();
                }}
                className="h-9 w-full border-gray-200 pl-9"
              />
            </div>

            <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
              <SelectTrigger className="h-9 w-[150px] border-gray-200">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">Default</SelectItem>
                <SelectItem value="attendance-desc">Attendance ↓</SelectItem>
                <SelectItem value="attendance-asc">Attendance ↑</SelectItem>
              </SelectContent>
            </Select>

            <Button
              variant="outline"
              className="h-9 gap-2 border-gray-200"
              onClick={openFilters}
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
              disabled={sorted.length === 0}
            >
              <Download className="h-4 w-4" /> Export
            </Button>

            {activeFilterCount > 0 && (
              <button
                onClick={clearAll}
                className="h-9 px-2 text-sm font-semibold text-red-600 hover:text-red-700 hover:underline"
              >
                Clear
              </button>
            )}

            {isFetching && !isLoading && (
              <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
            )}
          </div>
        }
      />

      <TableShell>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-gray-200 bg-gray-50 hover:bg-gray-50">
                <Th className="min-w-[200px]">Name</Th>
                <Th className="min-w-[220px]">Student ID</Th>
                <Th className="min-w-[220px]">Campus</Th>
                <Th className="min-w-[200px]">Section</Th>
                <Th className="min-w-[120px] text-right">Attendance</Th>
                <Th className="min-w-[120px] text-right">Classroom Quiz</Th>
                <Th className="min-w-[120px] text-right">Module Quiz</Th>
                <Th className="min-w-[90px] text-right">Report</Th>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i} className="border-b border-gray-100">
                    <TableCell className="py-3">
                      <Skeleton className="h-5 w-40" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-40" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-32" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-24" />
                    </TableCell>
                    <TableCell className="text-right">
                      <Skeleton className="ml-auto h-5 w-16" />
                    </TableCell>
                    <TableCell className="text-right">
                      <Skeleton className="ml-auto h-5 w-12" />
                    </TableCell>
                    <TableCell className="text-right">
                      <Skeleton className="ml-auto h-5 w-12" />
                    </TableCell>
                    <TableCell className="text-right">
                      <Skeleton className="ml-auto h-5 w-14" />
                    </TableCell>
                  </TableRow>
                ))
              ) : paged.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="h-24 text-center text-gray-500"
                  >
                    No students found matching your criteria.
                  </TableCell>
                </TableRow>
              ) : (
                paged.map((student) => (
                  <TableRow
                    key={student.studentId}
                    className="border-b border-gray-200 hover:bg-gray-50"
                  >
                    <TableCell className="py-3">
                      <div
                        className="max-w-[240px] truncate font-medium text-gray-900"
                        title={student.studentName}
                      >
                        {student.studentName}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div
                        className="max-w-[240px] truncate font-mono text-xs text-gray-500"
                        title={student.studentId}
                      >
                        {student.studentId}
                      </div>
                    </TableCell>
                    <TableCell className="text-gray-600">
                      <div
                        className="max-w-[240px] truncate"
                        title={student.instituteName}
                      >
                        {student.instituteName}
                      </div>
                    </TableCell>
                    <TableCell className="text-gray-600">
                      <div
                        className="max-w-[220px] truncate"
                        title={student.sectionName || "—"}
                      >
                        {student.sectionName || "—"}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <span
                        className="font-bold tabular-nums"
                        style={{ color: pctTextColor(student.attendancePct) }}
                      >
                        {student.attendancePct}%
                      </span>
                      {student.totalCount > 0 && (
                        <span className="ml-1.5 text-xs tabular-nums text-gray-400">
                          ({student.presentCount}/{student.totalCount})
                        </span>
                      )}
                    </TableCell>
                    <QuizPctCell value={student.classroomAvg} />
                    <QuizPctCell value={student.moduleAvg} />
                    <TableCell className="text-right">
                      <a
                        href={student.spiPath}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:text-brand-700 hover:underline"
                      >
                        Open <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {!isLoading && sorted.length > 0 && (
          <TablePagination
            page={currentPage}
            totalPages={totalPages}
            totalItems={sorted.length}
            pageSize={pageSize}
            pageSizeOptions={PAGE_SIZES}
            onPageChange={setPage}
            onPageSizeChange={(s) => {
              setPageSize(s);
              resetPage();
            }}
            itemLabel="students"
          />
        )}
      </TableShell>

      <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
        <SheetContent side="right" className="flex w-full flex-col sm:max-w-sm">
          <SheetHeader>
            <SheetTitle>Filters</SheetTitle>
            <SheetDescription>
              Campus and section options are loaded live from BigQuery for your
              role scope.
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 space-y-5 overflow-y-auto py-6">
            <div className="space-y-1.5">
              <Label>Campus</Label>
              <Select
                value={draftCampus}
                onValueChange={(v) => {
                  setDraftCampus(v);
                  setDraftSection("all");
                }}
                disabled={filtersLoading}
              >
                <SelectTrigger className="w-full border-gray-200">
                  <SelectValue placeholder="Campus" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All campuses</SelectItem>
                  {campusOptions.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Section</Label>
              <Select
                value={draftSection}
                onValueChange={setDraftSection}
                disabled={filtersLoading}
              >
                <SelectTrigger className="w-full border-gray-200">
                  <SelectValue placeholder="Section" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All sections</SelectItem>
                  {sectionOptions.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Attendance</Label>
              <Select value={draftAtt} onValueChange={setDraftAtt}>
                <SelectTrigger className="w-full border-gray-200">
                  <SelectValue placeholder="Attendance" />
                </SelectTrigger>
                <SelectContent>
                  {ATT_BUCKETS.map((b) => (
                    <SelectItem key={b.key} value={b.key}>
                      {b.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {filtersLoading && (
              <p className="flex items-center gap-2 text-xs text-gray-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading filter options…
              </p>
            )}
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-gray-200 pt-4">
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

function QuizPctCell({ value }: { value?: number | null }) {
  return (
    <TableCell className="text-right">
      {value === null || value === undefined ? (
        <span className="text-gray-300">—</span>
      ) : (
        <span
          className="font-semibold tabular-nums"
          style={{ color: pctTextColor(value) }}
        >
          {value}%
        </span>
      )}
    </TableCell>
  );
}

function Th({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <TableHead
      className={
        "h-11 px-3 text-[11px] font-semibold uppercase tracking-wider text-gray-600 " +
        (className ?? "")
      }
    >
      {children}
    </TableHead>
  );
}
