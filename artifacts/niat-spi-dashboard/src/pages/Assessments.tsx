import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  useGetDashboardFilters,
  getGetDashboardFiltersQueryKey,
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
import { ErrorState } from "@/components/PageStates";
import { PageBreadcrumb } from "@/components/PageBreadcrumb";
import { TableShell, TablePagination } from "@/components/DataTable";
import {
  SearchableSelect,
  campusSelectOptions,
} from "@/components/SearchableSelect";
import {
  SubNav,
  assessmentStudentsPath,
  assessmentsNav,
} from "@/components/SubNav";
import {
  Search,
  Loader2,
  ChevronRight,
  Download,
  ExternalLink,
  Lock,
} from "lucide-react";
import { pctColor, pctTextColor } from "@/lib/utils";
import { useDebounceValue } from "@/hooks/useDebounceValue";
import { useQueryParams } from "@/hooks/useQueryParams";
import { exportCsv } from "@/lib/csv";
import { useAuth } from "@/contexts/AuthContext";

const PAGE_SIZES = [25, 50, 100];
const FETCH_LIMIT = 5000;

interface AssessmentCounts {
  classroomCompleted: number;
  classroomTotal: number;
  moduleCompleted: number;
  moduleTotal: number;
  totalCompleted: number;
  totalAssigned: number;
  completionPct: number;
}

interface AssessmentCampus extends AssessmentCounts {
  instituteName: string;
  studentCount: number;
}

interface AssessmentStudent extends AssessmentCounts {
  studentId: string;
  studentName: string;
  instituteName: string;
  sectionName: string | null;
  spiPath: string;
}

export default function Assessments() {
  const [location] = useLocation();
  const path = location.split("?")[0] ?? location;
  const isStudents = path.startsWith("/dashboard/assessments/students");

  return (
    <div className="flex flex-col">
      {isStudents ? <StudentList /> : <CampusList />}
    </div>
  );
}

function CampusList() {
  const { user } = useAuth();
  const isBoa = user?.role === "boa";
  const [, setLocation] = useLocation();
  const [rows, setRows] = useState<AssessmentCampus[]>([]);
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
    fetch("/api/dashboard/assessment-campuses", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: AssessmentCampus[]) => {
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

  const totals = useMemo(() => sumCounts(filtered), [filtered]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paged = filtered.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );

  const handleExport = () => {
    if (filtered.length === 0) return;
    exportCsv(
      "assessment-campus-stats.csv",
      [
        "Campus",
        "Students",
        "Classroom completed",
        "Classroom total",
        "Module completed",
        "Module total",
        "Total completed (CQ + MQ)",
        "Total assigned (CQ + MQ)",
        "Completion %",
      ],
      filtered.map((c) => [
        c.instituteName,
        c.studentCount,
        c.classroomCompleted,
        c.classroomTotal,
        c.moduleCompleted,
        c.moduleTotal,
        c.totalCompleted,
        c.totalAssigned,
        c.completionPct,
      ]),
    );
  };

  return (
    <>
      <SubNav items={assessmentsNav(assessmentStudentsPath())} />
      <PageHeader
        title="Assessments"
        subtitle="Classroom and module quiz counts by campus. Skill Assessments and Final Skills Assessment are not in the warehouse yet. Total is CQ + MQ only."
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {!(isBoa && user?.campuses?.length === 1) && (
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
        )}
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

      {fetchError && (
        <div className="mb-4">
          <ErrorState message="Failed to load campus assessment counts." />
        </div>
      )}

      {!loading && filtered.length > 0 && <SummaryStrip totals={totals} />}

      <TableShell>
        <div className="border-b border-gray-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-gray-900">
            Assessment counts by campus
          </h2>
          <p className="mt-0.5 text-xs text-gray-500">
            {filtered.length.toLocaleString()} campus
            {filtered.length === 1 ? "" : "es"} · click a row for students
          </p>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-gray-200 bg-gray-50 hover:bg-gray-50">
                <Th>Campus</Th>
                <Th className="text-right">Students</Th>
                <Th className="text-right">Classroom quizzes</Th>
                <Th className="text-right">Module quizzes</Th>
                <Th className="text-right">Skills</Th>
                <Th className="text-right">Final</Th>
                <Th className="text-right">Total (CQ + MQ)</Th>
                <Th className="w-[200px] text-right">Completion</Th>
                <Th className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={9}>
                      <Skeleton className="h-8 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : paged.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="h-32 text-center text-gray-500">
                    No campus quiz data found.
                  </TableCell>
                </TableRow>
              ) : (
                paged.map((c) => (
                  <TableRow
                    key={c.instituteName}
                    className="cursor-pointer border-b border-gray-200 hover:bg-brand-50/40"
                    onClick={() =>
                      setLocation(assessmentStudentsPath(c.instituteName))
                    }
                  >
                    <TableCell className="py-3 font-medium text-gray-900">
                      {c.instituteName}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-gray-600">
                      {c.studentCount.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <CountCell
                        completed={c.classroomCompleted}
                        total={c.classroomTotal}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <CountCell
                        completed={c.moduleCompleted}
                        total={c.moduleTotal}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <SoonCell />
                    </TableCell>
                    <TableCell className="text-right">
                      <SoonCell />
                    </TableCell>
                    <TableCell className="text-right">
                      <CountCell
                        completed={c.totalCompleted}
                        total={c.totalAssigned}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <PctBar pct={c.completionPct} />
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

function StudentList() {
  const { user } = useAuth();
  const isBoa = user?.role === "boa";
  const [, setLocation] = useLocation();
  const query = useQueryParams();
  const urlCampus = query.get("campus");

  const campus = useMemo(() => {
    if (urlCampus) return urlCampus;
    if (isBoa && user?.campuses?.length === 1) return user.campuses[0]!;
    return "all";
  }, [urlCampus, isBoa, user?.campuses]);

  const { data: filterOptions } = useGetDashboardFilters(undefined, {
    query: {
      queryKey: getGetDashboardFiltersQueryKey(),
      staleTime: 60_000,
    },
  });

  const campusOptions = useMemo(() => {
    if (isBoa && user?.campuses?.length === 1) return user.campuses;
    return filterOptions?.campuses ?? [];
  }, [filterOptions, isBoa, user?.campuses]);

  const [rows, setRows] = useState<AssessmentStudent[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounceValue(search, 300);
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(1);

  const setCampusFilter = (value: string) => {
    setPage(1);
    setLocation(assessmentStudentsPath(value === "all" ? undefined : value));
  };

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setFetchError(false);
    const params = new URLSearchParams();
    if (campus !== "all") params.set("campus", campus);
    params.set("limit", String(FETCH_LIMIT));
    fetch(`/api/dashboard/assessment-students?${params.toString()}`, {
      credentials: "include",
    })
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: AssessmentStudent[]) => {
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
  }, [campus]);

  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (s) =>
        s.studentName.toLowerCase().includes(q) ||
        s.studentId.toLowerCase().includes(q) ||
        s.instituteName.toLowerCase().includes(q) ||
        (s.sectionName ?? "").toLowerCase().includes(q),
    );
  }, [rows, debouncedSearch]);

  const totals = useMemo(() => sumCounts(filtered), [filtered]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paged = filtered.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );

  const handleExport = () => {
    if (filtered.length === 0) return;
    const safeCampus =
      campus !== "all"
        ? campus.replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-")
        : "all-campuses";
    exportCsv(
      `assessment-students-${safeCampus}.csv`,
      [
        "Student",
        "Student ID",
        "Campus",
        "Section",
        "Classroom completed",
        "Classroom total",
        "Module completed",
        "Module total",
        "Total completed (CQ + MQ)",
        "Total assigned (CQ + MQ)",
        "Completion %",
      ],
      filtered.map((s) => [
        s.studentName,
        s.studentId,
        s.instituteName,
        s.sectionName ?? "",
        s.classroomCompleted,
        s.classroomTotal,
        s.moduleCompleted,
        s.moduleTotal,
        s.totalCompleted,
        s.totalAssigned,
        s.completionPct,
      ]),
    );
  };

  return (
    <>
      <SubNav items={assessmentsNav(assessmentStudentsPath(campus))} />
      {campus !== "all" && !(isBoa && user?.campuses?.length === 1) && (
        <PageBreadcrumb
          items={[
            {
              label: "Assessments",
              onClick: () => setLocation("/dashboard/assessments"),
            },
            { label: campus, current: true },
          ]}
        />
      )}
      <PageHeader
        title="Assessment students"
        subtitle="Per-student classroom and module quiz counts. Skill Assessments and Final Skills Assessment are coming soon. Total is CQ + MQ only."
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {!isBoa && campusOptions.length > 0 && (
          <SearchableSelect
            value={campus}
            onValueChange={setCampusFilter}
            options={campusSelectOptions(campusOptions)}
            placeholder="All campuses"
            searchPlaceholder="Search campuses…"
            className="w-[220px]"
          />
        )}
        <div className="relative min-w-[200px] sm:w-72">
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

      {fetchError && (
        <div className="mb-4">
          <ErrorState message="Failed to load student assessment counts." />
        </div>
      )}

      {!loading && filtered.length > 0 && <SummaryStrip totals={totals} />}

      <TableShell>
        <div className="border-b border-gray-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-gray-900">
            Assessment counts by student
            {campus !== "all" ? ` · ${campus}` : ""}
          </h2>
          <p className="mt-0.5 text-xs text-gray-500">
            {filtered.length.toLocaleString()} student
            {filtered.length === 1 ? "" : "s"} · incomplete first
          </p>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-gray-200 bg-gray-50 hover:bg-gray-50">
                <Th>Student</Th>
                <Th>Campus</Th>
                <Th>Section</Th>
                <Th className="text-right">Classroom quizzes</Th>
                <Th className="text-right">Module quizzes</Th>
                <Th className="text-right">Skills</Th>
                <Th className="text-right">Final</Th>
                <Th className="text-right">Total (CQ + MQ)</Th>
                <Th className="w-[180px] text-right">Completion</Th>
                <Th className="w-20 text-right">SPI</Th>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={10}>
                      <Skeleton className="h-8 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : paged.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={10}
                    className="h-32 text-center text-gray-500"
                  >
                    No students found for this campus.
                  </TableCell>
                </TableRow>
              ) : (
                paged.map((s) => (
                  <TableRow
                    key={s.studentId}
                    className="border-b border-gray-200 hover:bg-gray-50"
                  >
                    <TableCell className="py-3">
                      <div
                        className="max-w-[220px] truncate font-medium text-gray-900"
                        title={s.studentName}
                      >
                        {s.studentName}
                      </div>
                      <div
                        className="max-w-[220px] truncate font-mono text-[11px] text-gray-400"
                        title={s.studentId}
                      >
                        {s.studentId}
                      </div>
                    </TableCell>
                    <TableCell className="text-gray-600">
                      <div
                        className="max-w-[180px] truncate"
                        title={s.instituteName}
                      >
                        {s.instituteName}
                      </div>
                    </TableCell>
                    <TableCell className="text-gray-600">
                      {s.sectionName || "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <CountCell
                        completed={s.classroomCompleted}
                        total={s.classroomTotal}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <CountCell
                        completed={s.moduleCompleted}
                        total={s.moduleTotal}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <SoonCell />
                    </TableCell>
                    <TableCell className="text-right">
                      <SoonCell />
                    </TableCell>
                    <TableCell className="text-right">
                      <CountCell
                        completed={s.totalCompleted}
                        total={s.totalAssigned}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <PctBar pct={s.completionPct} />
                    </TableCell>
                    <TableCell className="text-right">
                      <a
                        href={s.spiPath}
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
            itemLabel="students"
          />
        )}
      </TableShell>
    </>
  );
}

function sumCounts(rows: AssessmentCounts[]): AssessmentCounts {
  const empty: AssessmentCounts = {
    classroomCompleted: 0,
    classroomTotal: 0,
    moduleCompleted: 0,
    moduleTotal: 0,
    totalCompleted: 0,
    totalAssigned: 0,
    completionPct: 0,
  };
  const summed = rows.reduce((acc, row) => {
    acc.classroomCompleted += row.classroomCompleted;
    acc.classroomTotal += row.classroomTotal;
    acc.moduleCompleted += row.moduleCompleted;
    acc.moduleTotal += row.moduleTotal;
    acc.totalCompleted += row.totalCompleted;
    acc.totalAssigned += row.totalAssigned;
    return acc;
  }, empty);
  summed.completionPct =
    summed.totalAssigned > 0
      ? Math.round((summed.totalCompleted / summed.totalAssigned) * 1000) / 10
      : 0;
  return summed;
}

function SummaryStrip({ totals }: { totals: AssessmentCounts }) {
  return (
    <div className="mb-4 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 sm:grid-cols-3 lg:grid-cols-5">
      <Kpi
        label="Classroom quizzes"
        completed={totals.classroomCompleted}
        total={totals.classroomTotal}
      />
      <Kpi
        label="Module quizzes"
        completed={totals.moduleCompleted}
        total={totals.moduleTotal}
      />
      <div className="bg-white px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
          Skills assessments
        </p>
        <p className="mt-1 flex items-center gap-1.5 text-sm text-gray-400">
          <Lock className="h-3.5 w-3.5" /> Coming soon
        </p>
      </div>
      <div className="bg-white px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
          Final skills assessment
        </p>
        <p className="mt-1 flex items-center gap-1.5 text-sm text-gray-400">
          <Lock className="h-3.5 w-3.5" /> Coming soon
        </p>
      </div>
      <Kpi
        label="Total (CQ + MQ)"
        completed={totals.totalCompleted}
        total={totals.totalAssigned}
      />
    </div>
  );
}

function Kpi({
  label,
  completed,
  total,
}: {
  label: string;
  completed: number;
  total: number;
}) {
  const pctVal = total > 0 ? Math.round((completed / total) * 1000) / 10 : 0;
  return (
    <div className="bg-white px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-gray-900">
        {completed.toLocaleString()}
        <span className="text-sm font-normal text-gray-400">
          {" "}
          / {total.toLocaleString()}
        </span>
      </p>
      <p
        className="mt-0.5 text-xs font-medium tabular-nums"
        style={{ color: total > 0 ? pctTextColor(pctVal) : undefined }}
      >
        {total > 0 ? `${pctVal}% completed` : "No quizzes assigned"}
      </p>
    </div>
  );
}

function CountCell({
  completed,
  total,
}: {
  completed: number;
  total: number;
}) {
  if (total <= 0) {
    return <span className="text-gray-400">—</span>;
  }
  const pctVal = Math.round((completed / total) * 1000) / 10;
  return (
    <span className="tabular-nums">
      <span className="font-semibold" style={{ color: pctTextColor(pctVal) }}>
        {completed.toLocaleString()}
      </span>
      <span className="text-gray-400"> / {total.toLocaleString()}</span>
    </span>
  );
}

function SoonCell() {
  return (
    <span
      className="text-xs font-medium text-gray-300"
      title="Not in BigQuery yet"
    >
      —
    </span>
  );
}

function PctBar({ pct }: { pct: number }) {
  return (
    <div className="flex items-center justify-end gap-3">
      <div className="hidden h-2 w-24 overflow-hidden rounded-full bg-gray-200 sm:block">
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
