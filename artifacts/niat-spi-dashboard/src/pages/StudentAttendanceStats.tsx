import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  useGetDashboardSummary,
  getGetDashboardSummaryQueryKey,
  useGetDashboardFilters,
  getGetDashboardFiltersQueryKey,
} from "@workspace/api-client-react";
import type { SubjectSummary } from "@workspace/api-client-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/PageHeader";
import { TableShell, TablePagination } from "@/components/DataTable";
import {
  SearchableSelect,
  campusSelectOptions,
} from "@/components/SearchableSelect";
import { Search, Loader2, ChevronRight } from "lucide-react";
import { pctColor, pctTextColor } from "@/lib/utils";
import { useDebounceValue } from "@/hooks/useDebounceValue";
import { useAuth } from "@/contexts/AuthContext";

const PAGE_SIZES = [25, 50, 100];

export default function StudentAttendanceStats() {
  const { user } = useAuth();
  const isBoa = user?.role === "boa";
  const [, setLocation] = useLocation();

  const { data: summary, isLoading: summaryLoading } = useGetDashboardSummary({
    query: { queryKey: getGetDashboardSummaryQueryKey() },
  });

  const { data: filterOptions } = useGetDashboardFilters(undefined, {
    query: {
      queryKey: getGetDashboardFiltersQueryKey(),
      staleTime: 60_000,
    },
  });

  const campusOptions = useMemo(() => {
    if (isBoa && user?.campuses?.length === 1) return user.campuses;
    return filterOptions?.campuses ?? summary?.campusBreakdown.map((c) => c.instituteName) ?? [];
  }, [filterOptions, summary, isBoa, user?.campuses]);

  const [campus, setCampus] = useState<string>("all");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounceValue(search, 300);
  const [subjects, setSubjects] = useState<SubjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (isBoa && user?.campuses?.length === 1 && campus === "all") {
      setCampus(user.campuses[0]!);
    }
  }, [isBoa, user?.campuses, campus]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const params = new URLSearchParams();
    if (campus !== "all") params.set("campus", campus);
    fetch(`/api/dashboard/subjects?${params.toString()}`, {
      credentials: "include",
    })
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: SubjectSummary[]) => {
        if (alive) setSubjects(data ?? []);
      })
      .catch(() => {
        if (alive) setSubjects([]);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [campus]);

  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return subjects;
    return subjects.filter((s) => s.subjectTitle.toLowerCase().includes(q));
  }, [subjects, debouncedSearch]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paged = filtered.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );

  const openSubject = (s: SubjectSummary) => {
    const params = new URLSearchParams({
      subject: s.subjectTitle,
      pct: String(s.pct),
    });
    if (campus !== "all") params.set("campus", campus);
    setLocation(`/dashboard/attendance-stats/students?${params.toString()}`);
  };

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Student Attendance Stats"
        subtitle="Subject-wise attendance — click a row to view students in that subject."
        right={
          <div className="flex flex-wrap items-center gap-2">
            {!isBoa && campusOptions.length > 0 && (
              <SearchableSelect
                value={campus}
                onValueChange={(v) => {
                  setCampus(v);
                  setPage(1);
                }}
                options={campusSelectOptions(campusOptions)}
                placeholder="All campuses"
                searchPlaceholder="Search campuses…"
                className="w-[220px]"
              />
            )}
            <div className="relative min-w-[200px] sm:w-64">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                placeholder="Search subjects…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                className="h-9 border-gray-200 pl-9"
              />
            </div>
            {loading && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
          </div>
        }
      />

      <TableShell>
        <div className="border-b border-gray-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-gray-900">
            Attendance by subject
            {campus !== "all" ? ` · ${campus}` : ""}
          </h2>
          <p className="mt-0.5 text-xs text-gray-500">
            {filtered.length.toLocaleString()} subject{filtered.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-gray-200 bg-gray-50 hover:bg-gray-50">
                <Th>Subject</Th>
                <Th className="text-right">Students</Th>
                <Th className="text-right">Present</Th>
                <Th className="text-right">Total sessions</Th>
                <Th className="w-[220px] text-right">Attendance</Th>
                <Th className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {summaryLoading || loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={6}>
                      <Skeleton className="h-8 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : paged.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center text-gray-500">
                    No subjects found for this scope.
                  </TableCell>
                </TableRow>
              ) : (
                paged.map((s) => (
                  <TableRow
                    key={s.subjectTitle}
                    className="cursor-pointer border-b border-gray-200 hover:bg-brand-50/40"
                    onClick={() => openSubject(s)}
                  >
                    <TableCell className="py-3 font-medium text-gray-900">
                      {s.subjectTitle}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-gray-600">
                      {s.studentCount.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-gray-600">
                      {s.presentCount.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-gray-600">
                      {s.totalCount.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-3">
                        <div className="hidden h-2 w-28 overflow-hidden rounded-full bg-gray-200 sm:block">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${Math.min(100, s.pct)}%`,
                              backgroundColor: pctColor(s.pct),
                            }}
                          />
                        </div>
                        <span
                          className="w-14 font-bold tabular-nums"
                          style={{ color: pctTextColor(s.pct) }}
                        >
                          {s.pct}%
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right text-gray-300">
                      <ChevronRight className="ml-auto h-4 w-4" />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {!loading && filtered.length > 0 && (
          <TablePagination
            page={currentPage}
            totalPages={totalPages}
            totalItems={filtered.length}
            pageSize={pageSize}
            pageSizeOptions={PAGE_SIZES}
            onPageChange={setPage}
            onPageSizeChange={(s) => {
              setPageSize(s);
              setPage(1);
            }}
            itemLabel="subjects"
          />
        )}
      </TableShell>
    </div>
  );
}

function Th({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
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
