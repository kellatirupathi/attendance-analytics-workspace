import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  useGetDashboardStudents,
  getGetDashboardStudentsQueryKey,
} from "@workspace/api-client-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/PageHeader";
import { PageBreadcrumb } from "@/components/PageBreadcrumb";
import { TableShell, TablePagination } from "@/components/DataTable";
import {
  ExternalLink,
  Search,
  Loader2,
} from "lucide-react";
import { pctTextColor } from "@/lib/utils";
import { useDebounceValue } from "@/hooks/useDebounceValue";

const PAGE_SIZES = [25, 50, 100];

function readQuery(): { subject: string; campus: string; pct: string } {
  const params = new URLSearchParams(window.location.search);
  return {
    subject: params.get("subject") ?? "",
    campus: params.get("campus") ?? "all",
    pct: params.get("pct") ?? "",
  };
}

export default function SubjectAttendanceStudents() {
  const [, setLocation] = useLocation();
  const { subject, campus, pct } = useMemo(() => readQuery(), []);

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounceValue(search, 350);
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(1);

  const studentQuery = {
    limit: 5000,
    subject: subject || undefined,
    campus: campus !== "all" ? campus : undefined,
    search: debouncedSearch || undefined,
  };

  const { data: students, isLoading, isFetching } = useGetDashboardStudents(
    studentQuery,
    {
      query: {
        queryKey: getGetDashboardStudentsQueryKey(studentQuery),
        enabled: !!subject,
        staleTime: 30_000,
      },
    },
  );

  const rows = useMemo(() => students ?? [], [students]);
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paged = rows.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  if (!subject) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <p className="text-gray-500">No subject selected.</p>
        <Button
          variant="link"
          className="mt-2"
          onClick={() => setLocation("/dashboard/attendance-stats")}
        >
          Back to Student Attendance Stats
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <PageBreadcrumb
        items={[
          {
            label: "Student Attendance Stats",
            onClick: () => setLocation("/dashboard/attendance-stats"),
          },
          ...(campus !== "all" ? [{ label: campus }] : []),
          { label: subject, current: true },
        ]}
      />

      <PageHeader
        title={subject}
        subtitle={
          campus !== "all"
            ? `Students enrolled in this subject at ${campus}.`
            : "Students enrolled in this subject across your scope."
        }
        right={
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[200px] sm:w-64">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                placeholder="Search students…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                className="h-9 border-gray-200 pl-9"
              />
            </div>
            {isFetching && !isLoading && (
              <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
            )}
          </div>
        }
      />

      {pct && (
        <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          Subject attendance average:{" "}
          <span className="font-semibold text-slate-900">{pct}%</span>
          {" · "}
          <span className="tabular-nums">{rows.length.toLocaleString()} students</span>
        </div>
      )}

      <TableShell>
        <div className="border-b border-gray-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-gray-900">Student breakdown</h2>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-gray-200 bg-gray-50 hover:bg-gray-50">
                <Th>Name</Th>
                <Th>Student ID</Th>
                <Th>Campus</Th>
                <Th>Section</Th>
                <Th className="text-right">Attendance</Th>
                <Th className="w-16 text-right">Report</Th>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
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
                    No students found for this subject.
                  </TableCell>
                </TableRow>
              ) : (
                paged.map((s) => (
                  <TableRow
                    key={s.studentId}
                    className="border-b border-gray-200 hover:bg-gray-50"
                  >
                    <TableCell className="py-3 font-medium text-gray-900">
                      {s.studentName}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-gray-500">
                      {s.studentId}
                    </TableCell>
                    <TableCell className="max-w-[180px] truncate text-gray-600">
                      {s.instituteName}
                    </TableCell>
                    <TableCell className="max-w-[160px] truncate text-gray-600">
                      {s.sectionName ?? "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <span
                        className="font-bold tabular-nums"
                        style={{ color: pctTextColor(s.attendancePct) }}
                      >
                        {s.attendancePct}%
                      </span>
                      {s.totalCount > 0 && (
                        <span className="ml-1.5 text-xs tabular-nums text-gray-400">
                          ({s.presentCount}/{s.totalCount})
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <a
                        href={s.spiPath}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:text-brand-700 hover:underline"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {!isLoading && rows.length > 0 && (
          <TablePagination
            page={currentPage}
            totalPages={totalPages}
            totalItems={rows.length}
            pageSize={pageSize}
            pageSizeOptions={PAGE_SIZES}
            onPageChange={setPage}
            onPageSizeChange={(s) => {
              setPageSize(s);
              setPage(1);
            }}
            itemLabel="students"
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
