import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
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
import { SubNav, attendanceStatsNav } from "@/components/SubNav";
import { SearchableSelect } from "@/components/SearchableSelect";
import { useQueryParams } from "@/hooks/useQueryParams";
import { subjectColor } from "@/lib/subjectColors";
import { Search, Loader2, ChevronRight, Download } from "lucide-react";
import { pctColor, pctTextColor } from "@/lib/utils";
import { useDebounceValue } from "@/hooks/useDebounceValue";
import { exportCsv } from "@/lib/csv";
import { DateRangeFilter } from "@/components/DateRangeFilter";
import {
  applyDateRange,
  applySemester,
  attendanceStatsPath,
  campusWisePath,
  dateRangeLabel,
  readDateRange,
  readSemester,
  semesterLabel,
  type DateRange,
} from "@/lib/dateRange";
import { useAttendanceSemesters } from "@/hooks/useAttendanceSemesters";

const PAGE_SIZES = [25, 50, 100];
const CURRENT_SEMESTER = "current";

interface CampusStat {
  instituteName: string;
  studentCount: number;
  sectionCount: number;
  subjectCount: number;
  presentCount: number;
  totalCount: number;
  pct: number;
  presentRecordCount: number;
  totalRecordCount: number;
  recordPct: number;
}

interface CampusSessionRow {
  subjectTitle: string;
  sessionTitle: string;
  date: string | null;
  studentCount: number;
  presentCount: number;
  absentCount: number;
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
  const range = useMemo(() => readDateRange(query), [query]);
  const semester = useMemo(() => readSemester(query), [query]);

  const setRange = (next: DateRange) => {
    setLocation(campusWisePath(next, campus || undefined, semester));
  };

  const setSemester = (next: string) => {
    setLocation(campusWisePath(range, campus || undefined, next));
  };

  return (
    <div className="flex flex-col">
      <SubNav
        items={attendanceStatsNav(
          attendanceStatsPath(range, undefined, semester),
          campusWisePath(range, undefined, semester),
        )}
      />
      {campus ? (
        <CampusSubjects
          campus={campus}
          range={range}
          semester={semester}
          onRangeChange={setRange}
          onSemesterChange={setSemester}
          setLocation={setLocation}
        />
      ) : (
        <CampusList
          range={range}
          semester={semester}
          onRangeChange={setRange}
          onSemesterChange={setSemester}
          setLocation={setLocation}
        />
      )}
    </div>
  );
}

function CampusList({
  range,
  semester,
  onRangeChange,
  onSemesterChange,
  setLocation,
}: {
  range: DateRange;
  semester: string;
  onRangeChange: (next: DateRange) => void;
  onSemesterChange: (next: string) => void;
  setLocation: (to: string) => void;
}) {
  const [rows, setRows] = useState<CampusStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounceValue(search, 300);
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(1);
  const semesters = useAttendanceSemesters();

  useEffect(() => {
    setPage(1);
  }, [range.dateFrom, range.dateTo, semester]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setFetchError(false);
    const params = new URLSearchParams();
    applySemester(params, semester);
    applyDateRange(params, range);
    const qs = params.toString();
    fetch(`/api/dashboard/campuses${qs ? `?${qs}` : ""}`, { credentials: "include" })
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
  }, [range.dateFrom, range.dateTo, semester]);

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
      [
        "Campus",
        "Students",
        "Sections",
        "Subjects",
        "Present students",
        "Total sessions",
        "Student attendance %",
        "Present records",
        "Total records",
        "Record attendance %",
      ],
      filtered.map((c) => [
        c.instituteName,
        c.studentCount,
        c.sectionCount,
        c.subjectCount,
        c.presentCount,
        c.totalCount,
        c.pct,
        c.presentRecordCount,
        c.totalRecordCount,
        c.recordPct,
      ]),
    );
  };

  return (
    <>
      <PageHeader
        title="Campus-wise Stats"
        subtitle="Present = unique students who showed up at least once. Total sessions = classes held, not attendance rows."
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <DateRangeFilter
          value={range}
          onChange={onRangeChange}
          allDatesLabel="All dates"
        />
        <SearchableSelect
          value={semester || CURRENT_SEMESTER}
          onValueChange={(value) =>
            onSemesterChange(value === CURRENT_SEMESTER ? "" : value)
          }
          options={semesterOptions(semesters, semester)}
          placeholder="Current semester"
          searchPlaceholder="Search semesters…"
          className="w-[220px]"
          disabled={semesters.length === 0 && !semester}
        />
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
            {" · "}
            {semesterLabel(semester)}
            {range.dateFrom || range.dateTo ? ` · ${dateRangeLabel(range)}` : ""}
            {" · "}
            Student attendance = present students ÷ students. Record attendance =
            present rows ÷ all rows.
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
                <Th className="w-[240px] text-right">Student attendance</Th>
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
                    No campuses found for this date range.
                  </TableCell>
                </TableRow>
              ) : (
                paged.map((c) => (
                  <TableRow
                    key={c.instituteName}
                    className="cursor-pointer border-b border-gray-200 hover:bg-brand-50/40"
                    onClick={() =>
                      setLocation(
                        campusWisePath(range, c.instituteName, semester),
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
                      <PctBar pct={c.pct} recordPct={c.recordPct} />
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
  range,
  semester,
  onRangeChange,
  onSemesterChange,
  setLocation,
}: {
  campus: string;
  range: DateRange;
  semester: string;
  onRangeChange: (next: DateRange) => void;
  onSemesterChange: (next: string) => void;
  setLocation: (to: string) => void;
}) {
  const [rows, setRows] = useState<CampusSessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounceValue(search, 300);
  const [subjectFilter, setSubjectFilter] = useState("all");
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(1);
  const semesters = useAttendanceSemesters(campus);

  useEffect(() => {
    setPage(1);
    setSearch("");
    setSubjectFilter("all");
  }, [campus, range.dateFrom, range.dateTo, semester]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setFetchError(false);
    const params = new URLSearchParams({ campus });
    applySemester(params, semester);
    applyDateRange(params, range);
    fetch(`/api/dashboard/campus-sessions?${params.toString()}`, {
      credentials: "include",
    })
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: CampusSessionRow[]) => {
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
  }, [campus, range.dateFrom, range.dateTo, semester]);

  const subjectOptions = useMemo(() => {
    const seen = new Set(rows.map((r) => r.subjectTitle));
    return Array.from(seen).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    return rows.filter((r) => {
      if (subjectFilter !== "all" && r.subjectTitle !== subjectFilter)
        return false;
      if (!q) return true;
      return (
        r.subjectTitle.toLowerCase().includes(q) ||
        r.sessionTitle.toLowerCase().includes(q) ||
        (r.date ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, debouncedSearch, subjectFilter]);

  const totals = useMemo(
    () => ({
      sessions: filtered.length,
      subjects: new Set(filtered.map((r) => r.subjectTitle)).size,
      absent: filtered.reduce((sum, r) => sum + r.absentCount, 0),
    }),
    [filtered],
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paged = filtered.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );

  const handleExport = () => {
    if (filtered.length === 0) return;
    exportCsv(
      `${safeFileName(campus) || "campus"}-sessions.csv`,
      [
        "Subject",
        "Session",
        "Date",
        "Students",
        "Not attended",
        "Present",
        "Total",
        "Attendance %",
      ],
      filtered.map((r) => [
        r.subjectTitle,
        r.sessionTitle,
        r.date ?? "",
        r.studentCount,
        r.absentCount,
        r.presentCount,
        r.totalCount,
        r.pct,
      ]),
    );
  };

  // Opens the per-student list for this exact session.
  const openSession = (r: CampusSessionRow) => {
    const p = new URLSearchParams({
      subject: r.subjectTitle,
      session: r.sessionTitle,
      campus,
      from: "campuses",
    });
    if (r.date) p.set("date", r.date);
    applySemester(p, semester);
    applyDateRange(p, range);
    setLocation(`/dashboard/attendance-stats/sessions?${p.toString()}`);
  };

  return (
    <>
      <PageBreadcrumb
        items={[
          {
            label: "Campus-wise Stats",
            onClick: () => setLocation(campusWisePath(range, undefined, semester)),
          },
          { label: campus, current: true },
        ]}
      />

      <PageHeader
        title={campus}
        subtitle={`${semesterLabel(semester)} · session-wise attendance by subject — click a row to see which students missed it.`}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <DateRangeFilter
          value={range}
          onChange={onRangeChange}
          allDatesLabel="All dates"
        />
        <SearchableSelect
          value={semester || CURRENT_SEMESTER}
          onValueChange={(value) =>
            onSemesterChange(value === CURRENT_SEMESTER ? "" : value)
          }
          options={semesterOptions(semesters, semester)}
          placeholder="Current semester"
          searchPlaceholder="Search semesters…"
          className="w-[220px]"
          disabled={semesters.length === 0 && !semester}
        />
        {subjectOptions.length > 0 && (
          <SearchableSelect
            value={subjectFilter}
            onValueChange={(v) => {
              setSubjectFilter(v);
              setPage(1);
            }}
            options={[
              { value: "all", label: "All subjects" },
              ...subjectOptions.map((s) => ({ value: s, label: s })),
            ]}
            placeholder="All subjects"
            searchPlaceholder="Search subjects…"
            className="w-[220px]"
          />
        )}
        <div className="relative min-w-[200px] sm:w-64">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            placeholder="Search sessions…"
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
          <ErrorState message="Failed to load sessions for this campus." />
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-x-6 gap-y-1 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          <span>
            <span className="font-semibold text-slate-900">
              {totals.subjects.toLocaleString()}
            </span>{" "}
            subject{totals.subjects === 1 ? "" : "s"}
          </span>
          <span>
            <span className="font-semibold text-slate-900">
              {totals.sessions.toLocaleString()}
            </span>{" "}
            session{totals.sessions === 1 ? "" : "s"}
          </span>
          <span>
            <span className="font-semibold text-red-600">
              {totals.absent.toLocaleString()}
            </span>{" "}
            absences
          </span>
        </div>
      )}

      <TableShell>
        <div className="border-b border-gray-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-gray-900">
            Sessions by subject · {campus}
          </h2>
          <p className="mt-0.5 text-xs text-gray-500">
            {filtered.length.toLocaleString()} session
            {filtered.length === 1 ? "" : "s"} · lowest attendance first within
            each subject · {semesterLabel(semester)}
            {range.dateFrom || range.dateTo ? ` · ${dateRangeLabel(range)}` : ""}
          </p>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-gray-200 bg-gray-50 hover:bg-gray-50">
                <Th className="w-[240px]">Subject</Th>
                <Th>Session / Unit</Th>
                <Th className="w-[110px]">Date</Th>
                <Th className="text-right">Students</Th>
                <Th className="text-right">Not attended</Th>
                <Th className="w-[200px] text-right">Attendance</Th>
                <Th className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 10 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={7}>
                      <Skeleton className="h-8 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : paged.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-32 text-center text-gray-500">
                    No sessions found for this campus in the selected dates.
                  </TableCell>
                </TableRow>
              ) : (
                paged.map((r, i) => {
                  const color = subjectColor(r.subjectTitle);
                  // Only label the subject on the first row of each run, so
                  // long groups read as blocks instead of repeating the name.
                  const isGroupStart =
                    i === 0 || paged[i - 1]!.subjectTitle !== r.subjectTitle;
                  return (
                    <TableRow
                      key={`${r.subjectTitle}-${r.sessionTitle}-${r.date ?? ""}`}
                      className="cursor-pointer border-b border-gray-200 hover:bg-brand-50/40"
                      onClick={() => openSession(r)}
                    >
                      <TableCell
                        className="relative py-3 font-medium"
                        style={{
                          backgroundColor: color.tint,
                          color: color.text,
                          boxShadow: `inset 3px 0 0 0 ${color.bar}`,
                        }}
                      >
                        {isGroupStart ? (
                          r.subjectTitle
                        ) : (
                          <span className="sr-only">{r.subjectTitle}</span>
                        )}
                      </TableCell>
                      <TableCell className="py-3 text-gray-900">
                        {r.sessionTitle}
                      </TableCell>
                      <TableCell className="tabular-nums text-gray-500">
                        {r.date ?? "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-gray-600">
                        {r.studentCount.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <span
                          className={
                            "font-semibold tabular-nums " +
                            (r.absentCount > 0 ? "text-red-600" : "text-gray-400")
                          }
                        >
                          {r.absentCount.toLocaleString()}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <PctBar pct={r.pct} />
                      </TableCell>
                      <TableCell className="text-right text-gray-300">
                        <ChevronRight className="ml-auto h-4 w-4" />
                      </TableCell>
                    </TableRow>
                  );
                })
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
            itemLabel="sessions"
          />
        )}
      </TableShell>
    </>
  );
}
function semesterOptions(semesters: string[], selected: string) {
  return [
    { value: CURRENT_SEMESTER, label: "Current semester" },
    ...semesters.map((s) => ({ value: s, label: s })),
    ...(selected && !semesters.includes(selected)
      ? [{ value: selected, label: selected }]
      : []),
  ];
}

function PctBar({ pct, recordPct }: { pct: number; recordPct?: number }) {
  return (
    <div className="flex flex-col items-end gap-0.5">
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
      {recordPct != null && (
        <span className="text-[10px] tabular-nums text-gray-400">
          Record {recordPct}%
        </span>
      )}
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
