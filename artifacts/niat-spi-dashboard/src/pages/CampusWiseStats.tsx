import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
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
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/PageHeader";
import { ErrorState } from "@/components/PageStates";
import { PageBreadcrumb } from "@/components/PageBreadcrumb";
import { TableShell, TablePagination } from "@/components/DataTable";
import { SubNav, ATTENDANCE_STATS_NAV } from "@/components/SubNav";
import { useQueryParams } from "@/hooks/useQueryParams";
import {
  Search,
  Loader2,
  ChevronRight,
  Download,
  CalendarDays,
} from "lucide-react";
import { pctColor, pctTextColor } from "@/lib/utils";
import { useDebounceValue } from "@/hooks/useDebounceValue";
import { exportCsv } from "@/lib/csv";

const PAGE_SIZES = [25, 50, 100];

interface CampusStat {
  instituteName: string;
  studentCount: number;
  sectionCount: number;
  subjectCount: number;
  presentCount: number;
  totalCount: number;
  pct: number;
}

const safeFileName = (value: string) =>
  value.replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-");

export default function CampusWiseStats() {
  const [, setLocation] = useLocation();
  const query = useQueryParams();

  // A campus in the query string switches this page from the campus list to
  // the subject breakdown for that campus.
  const campus = query.get("campus") ?? "";

  return (
    <div className="flex flex-col">
      <SubNav items={ATTENDANCE_STATS_NAV} />
      {campus ? (
        <CampusSubjects campus={campus} setLocation={setLocation} />
      ) : (
        <CampusList setLocation={setLocation} />
      )}
    </div>
  );
}

function CampusList({
  setLocation,
}: {
  setLocation: (to: string) => void;
}) {
  const [rows, setRows] = useState<CampusStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounceValue(search, 300);
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(1);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setFetchError(false);
    fetch("/api/dashboard/campuses", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: CampusStat[]) => {
        if (alive) setRows(data ?? []);
      })
      .catch(() => {
        if (alive) {
          setRows([]);
          setFetchError(true);
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((c) => c.instituteName.toLowerCase().includes(q));
  }, [rows, debouncedSearch]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paged = filtered.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );

  const handleExport = () => {
    if (filtered.length === 0) return;
    exportCsv(
      "campus-wise-stats.csv",
      ["Campus", "Students", "Sections", "Subjects", "Present", "Total sessions", "Attendance %"],
      filtered.map((c) => [
        c.instituteName,
        c.studentCount,
        c.sectionCount,
        c.subjectCount,
        c.presentCount,
        c.totalCount,
        c.pct,
      ]),
    );
  };

  return (
    <>
      <PageHeader
        title="Campus-wise Stats"
        subtitle="Attendance rolled up by campus — click a row to view its subjects."
        right={
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[200px] sm:w-64">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                placeholder="Search campuses…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                className="h-9 border-gray-200 pl-9"
              />
            </div>
            {loading && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
            <Button
              variant="outline"
              className="h-9 gap-2 border-gray-200"
              onClick={handleExport}
              disabled={filtered.length === 0 || loading}
            >
              <Download className="h-4 w-4" /> Export
            </Button>
          </div>
        }
      />

      {fetchError && (
        <div className="mb-4">
          <ErrorState message="Failed to load campus stats." />
        </div>
      )}

      <TableShell>
        <div className="border-b border-gray-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-gray-900">
            Attendance by campus
          </h2>
          <p className="mt-0.5 text-xs text-gray-500">
            {filtered.length.toLocaleString()} campus
            {filtered.length === 1 ? "" : "es"}
          </p>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-gray-200 bg-gray-50 hover:bg-gray-50">
                <Th>Campus</Th>
                <Th className="text-right">Students</Th>
                <Th className="text-right">Sections</Th>
                <Th className="text-right">Subjects</Th>
                <Th className="text-right">Present</Th>
                <Th className="text-right">Total sessions</Th>
                <Th className="w-[220px] text-right">Attendance</Th>
                <Th className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={8}>
                      <Skeleton className="h-8 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : paged.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-32 text-center text-gray-500">
                    No campuses found for this scope.
                  </TableCell>
                </TableRow>
              ) : (
                paged.map((c) => (
                  <TableRow
                    key={c.instituteName}
                    className="cursor-pointer border-b border-gray-200 hover:bg-brand-50/40"
                    onClick={() =>
                      setLocation(
                        `/dashboard/attendance-stats/campuses?campus=${encodeURIComponent(c.instituteName)}`,
                      )
                    }
                  >
                    <TableCell className="py-3 font-medium text-gray-900">
                      {c.instituteName}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-gray-600">
                      {c.studentCount.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-gray-600">
                      {c.sectionCount.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-gray-600">
                      {c.subjectCount.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-gray-600">
                      {c.presentCount.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-gray-600">
                      {c.totalCount.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <PctBar pct={c.pct} />
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
            itemLabel="campuses"
          />
        )}
      </TableShell>
    </>
  );
}

function CampusSubjects({
  campus,
  setLocation,
}: {
  campus: string;
  setLocation: (to: string) => void;
}) {
  const [subjects, setSubjects] = useState<SubjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounceValue(search, 300);
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
    setSearch("");
  }, [campus]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setFetchError(false);
    const params = new URLSearchParams({ campus });
    fetch(`/api/dashboard/subjects?${params.toString()}`, {
      credentials: "include",
    })
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: SubjectSummary[]) => {
        if (alive) setSubjects(data ?? []);
      })
      .catch(() => {
        if (alive) {
          setSubjects([]);
          setFetchError(true);
        }
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

  const handleExport = () => {
    if (filtered.length === 0) return;
    exportCsv(
      `${safeFileName(campus) || "campus"}-subjects.csv`,
      ["Subject", "Students", "Present", "Total sessions", "Attendance %"],
      filtered.map((s) => [
        s.subjectTitle,
        s.studentCount,
        s.presentCount,
        s.totalCount,
        s.pct,
      ]),
    );
  };

  // Reuses the existing subject drill-down, scoped to this campus. `from`
  // lets that page send the user back here rather than to Attendance Stats.
  const openSubject = (s: SubjectSummary) => {
    const params = new URLSearchParams({
      subject: s.subjectTitle,
      pct: String(s.pct),
      campus,
      from: "campuses",
    });
    setLocation(`/dashboard/attendance-stats/students?${params.toString()}`);
  };

  const openSessions = (s: SubjectSummary) => {
    const params = new URLSearchParams({
      subject: s.subjectTitle,
      campus,
      from: "campuses",
    });
    setLocation(`/dashboard/attendance-stats/sessions?${params.toString()}`);
  };

  return (
    <>
      <PageBreadcrumb
        items={[
          {
            label: "Campus-wise Stats",
            onClick: () => setLocation("/dashboard/attendance-stats/campuses"),
          },
          { label: campus, current: true },
        ]}
      />

      <PageHeader
        title={campus}
        subtitle="Subject-wise attendance at this campus — click a row to view its students."
        right={
          <div className="flex flex-wrap items-center gap-2">
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
            <Button
              variant="outline"
              className="h-9 gap-2 border-gray-200"
              onClick={handleExport}
              disabled={filtered.length === 0 || loading}
            >
              <Download className="h-4 w-4" /> Export
            </Button>
          </div>
        }
      />

      {fetchError && (
        <div className="mb-4">
          <ErrorState message="Failed to load subject attendance for this campus." />
        </div>
      )}

      <TableShell>
        <div className="border-b border-gray-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-gray-900">
            Attendance by subject · {campus}
          </h2>
          <p className="mt-0.5 text-xs text-gray-500">
            {filtered.length.toLocaleString()} subject
            {filtered.length === 1 ? "" : "s"}
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
                <Th className="w-24 text-right">Sessions</Th>
                <Th className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={7}>
                      <Skeleton className="h-8 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : paged.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-32 text-center text-gray-500">
                    No subjects found for this campus.
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
                      <PctBar pct={s.pct} />
                    </TableCell>
                    <TableCell className="text-right">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openSessions(s);
                        }}
                        className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:text-brand-700 hover:underline"
                      >
                        <CalendarDays className="h-3.5 w-3.5" /> Units
                      </button>
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
    </>
  );
}

function PctBar({ pct }: { pct: number }) {
  return (
    <div className="flex items-center justify-end gap-3">
      <div className="hidden h-2 w-28 overflow-hidden rounded-full bg-gray-200 sm:block">
        <div
          className="h-full rounded-full"
          style={{
            width: `${Math.min(100, pct)}%`,
            backgroundColor: pctColor(pct),
          }}
        />
      </div>
      <span
        className="w-14 font-bold tabular-nums"
        style={{ color: pctTextColor(pct) }}
      >
        {pct}%
      </span>
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
