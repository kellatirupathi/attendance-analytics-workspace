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
import { TableShell, TablePagination } from "@/components/DataTable";
import {
  SearchableSelect,
  campusSelectOptions,
} from "@/components/SearchableSelect";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Search, Loader2, ChevronRight, Download } from "lucide-react";
import { pctColor, pctTextColor } from "@/lib/utils";
import { useDebounceValue } from "@/hooks/useDebounceValue";
import { useQueryParams } from "@/hooks/useQueryParams";
import { exportCsv } from "@/lib/csv";
import { useAuth } from "@/contexts/AuthContext";
import { omitExcludedInstitutes } from "@/lib/excludedInstitutes";
import {
  applyDateRange,
  applySemester,
  campusWisePath,
  subjectAttendanceStudentsPath,
  type DateRange,
} from "@/lib/dateRange";
import { useAttendanceSemesters } from "@/hooks/useAttendanceSemesters";

const PAGE_SIZES = [25, 50, 100];

type Grain =
  | "university"
  | "university_subject"
  | "university_section"
  | "university_student";

type ColumnId =
  | "overallPct"
  | "grainPct"
  | "present"
  | "scheduled"
  | "sessions"
  | "students"
  | "absences"
  | "eligible"
  | "recoveryEligible"
  | "atRisk"
  | "ineligible";

const COLUMN_GROUPS: { title: string; ids: ColumnId[] }[] = [
  {
    title: "Attendance",
    ids: [
      "overallPct",
      "grainPct",
      "present",
      "scheduled",
      "sessions",
      "students",
      "absences",
    ],
  },
  {
    title: "Eligibility tier",
    ids: ["eligible", "recoveryEligible", "atRisk", "ineligible"],
  },
];

const DEFAULT_COLUMNS: ColumnId[] = [
  "overallPct",
  "grainPct",
  "eligible",
  "recoveryEligible",
  "atRisk",
  "ineligible",
];

const GRAIN_PCT_LABEL: Record<Grain, string> = {
  university: "University Attendance %",
  university_subject: "Subject Attendance %",
  university_section: "Section Attendance %",
  university_student: "Student Attendance %",
};

const COLUMN_LABEL: Record<ColumnId, string> = {
  overallPct: "Overall Attendance %",
  grainPct: "Attendance %",
  present: "Present",
  scheduled: "Scheduled",
  sessions: "Sessions",
  students: "Students",
  absences: "Absences",
  eligible: "Eligible",
  recoveryEligible: "Recovery Eligible",
  atRisk: "At Risk",
  ineligible: "Ineligible",
};

interface StatsRow {
  university: string;
  subject: string | null;
  section: string | null;
  studentId: string | null;
  studentName: string | null;
  overallPct: number;
  grainPct: number;
  present: number;
  scheduled: number;
  sessions: number;
  students: number;
  absences: number;
  eligible: number;
  recoveryEligible: number;
  atRisk: number;
  ineligible: number;
  spiPath: string | null;
}

function columnLabel(id: ColumnId, grain: Grain): string {
  if (id === "grainPct") return GRAIN_PCT_LABEL[grain];
  return COLUMN_LABEL[id];
}

function cellValue(row: StatsRow, id: ColumnId): string | number {
  return row[id];
}

export default function StudentAttendanceStats() {
  const { user } = useAuth();
  const isBoa = user?.role === "boa";
  const isSuperAdmin = user?.role === "superadmin";
  const [, setLocation] = useLocation();
  const query = useQueryParams();

  const grain = (query.get("group") as Grain) || "university";
  const campus = query.get("campus") || (isBoa && user?.campuses?.length === 1 ? user.campuses[0]! : "all");
  const scopeKind = query.get("scope") || "semester";
  const semester = query.get("semester") || "";
  const day = query.get("date") || "";
  const dateFrom = query.get("dateFrom") || "";
  const dateTo = query.get("dateTo") || "";

  const { data: filterOptions } = useGetDashboardFilters(undefined, {
    query: { queryKey: getGetDashboardFiltersQueryKey(), staleTime: 5 * 60_000 },
  });
  const campusOptions = useMemo(() => {
    if (isBoa && user?.campuses?.length === 1) return omitExcludedInstitutes(user.campuses);
    return omitExcludedInstitutes(filterOptions?.campuses ?? []);
  }, [filterOptions, isBoa, user?.campuses]);
  const semesters = useAttendanceSemesters(campus === "all" ? undefined : campus);

  const [rows, setRows] = useState<StatsRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounceValue(search, 300);
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(1);
  const [columns, setColumns] = useState<ColumnId[]>(DEFAULT_COLUMNS);
  const [draftColumns, setDraftColumns] = useState<ColumnId[]>(DEFAULT_COLUMNS);
  const [columnsOpen, setColumnsOpen] = useState(false);

  const writeQuery = (patch: Record<string, string | undefined>) => {
    const params = new URLSearchParams(query);
    for (const [key, value] of Object.entries(patch)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    const qs = params.toString();
    setPage(1);
    setLocation(qs ? `/dashboard/attendance-stats?${qs}` : "/dashboard/attendance-stats");
  };

  useEffect(() => {
    let alive = true;
    fetch("/api/dashboard/attendance-stats/columns", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((body: { columns: ColumnId[] }) => {
        if (!alive || !Array.isArray(body.columns)) return;
        setColumns(body.columns);
        setDraftColumns(body.columns);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const scopeReady =
    scopeKind !== "day" || /^\d{4}-\d{2}-\d{2}$/.test(day)
      ? scopeKind !== "range" ||
        (/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) && /^\d{4}-\d{2}-\d{2}$/.test(dateTo))
      : false;

  useEffect(() => {
    if (!scopeReady) return;
    let alive = true;
    setLoading(true);
    setFetchError(false);
    const params = new URLSearchParams({ group: grain });
    if (campus !== "all") params.set("campus", campus);
    if (scopeKind === "day" && day) params.set("date", day);
    else if (scopeKind === "range") {
      params.set("dateFrom", dateFrom);
      params.set("dateTo", dateTo);
    } else if (semester) params.set("semester", semester);
    fetch(`/api/dashboard/attendance-group?${params.toString()}`, {
      credentials: "include",
    })
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: StatsRow[]) => {
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
  }, [grain, campus, scopeKind, semester, day, dateFrom, dateTo, scopeReady]);

  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) =>
      [row.university, row.subject, row.section, row.studentName, row.studentId]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [rows, debouncedSearch]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paged = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const visibleColumns = columns.filter((id) => id !== "overallPct");
  const headers = ["University", ...identityHeaders(grain), "Overall Attendance %", ...visibleColumns.map((id) => columnLabel(id, grain))];

  const scopeLabel =
    scopeKind === "day" && day
      ? `${formatDay(day)} only`
      : scopeKind === "range" && dateFrom && dateTo
        ? dateFrom === dateTo
          ? `${formatDay(dateFrom)} only`
          : `${formatDay(dateFrom)} – ${formatDay(dateTo)}`
        : semester || "Current semester";

  const drillRange = (): DateRange =>
    scopeKind === "day" && day
      ? { dateFrom: day, dateTo: day }
      : scopeKind === "range"
        ? { dateFrom, dateTo }
        : {};

  const openUniversity = (name: string) => {
    const range = drillRange();
    setLocation(
      campusWisePath(range, name, scopeKind === "semester" ? semester : undefined),
    );
  };

  const openSubject = (row: StatsRow) => {
    if (!row.subject) return;
    const range = drillRange();
    const params = new URLSearchParams({ subject: row.subject, campus: row.university });
    if (scopeKind === "semester") applySemester(params, semester);
    applyDateRange(params, range);
    setLocation(subjectAttendanceStudentsPath(range, {
      subject: row.subject,
      campus: row.university,
      semester: scopeKind === "semester" ? semester : undefined,
    }));
  };

  const exportRows = (data: StatsRow[], filename: string) => {
    exportCsv(
      filename,
      headers,
      data.map((row) => [
        row.university,
        ...identityValues(row, grain),
        row.overallPct,
        ...visibleColumns.map((id) => cellValue(row, id)),
      ]),
    );
  };

  const exportAll = async () => {
    const params = new URLSearchParams({ group: grain });
    if (scopeKind === "day" && day) params.set("date", day);
    else if (scopeKind === "range") {
      params.set("dateFrom", dateFrom);
      params.set("dateTo", dateTo);
    } else if (semester) params.set("semester", semester);
    const res = await fetch(`/api/dashboard/attendance-group?${params.toString()}`, {
      credentials: "include",
    });
    if (!res.ok) return;
    const data = (await res.json()) as StatsRow[];
    exportRows(data, "attendance-stats-all-universities.csv");
  };

  const applyColumns = async (asDefault: boolean) => {
    if (asDefault) {
      const ok = window.confirm(
        "This changes what all other users see by default on this page. Continue?",
      );
      if (!ok) return;
    }
    const path = asDefault
      ? "/api/dashboard/attendance-stats/columns/default"
      : "/api/dashboard/attendance-stats/columns";
    const res = await fetch(path, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ columns: draftColumns }),
    });
    if (!res.ok) return;
    setColumns(draftColumns);
    setColumnsOpen(false);
  };

  const toggleDraft = (id: ColumnId) => {
    if (id === "overallPct") return;
    setDraftColumns((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  };

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Student Attendance Stats"
        subtitle={`${scopeLabel} · Attendance = sessions attended ÷ sessions scheduled.`}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchableSelect
          value={grain}
          onValueChange={(value) => writeQuery({ group: value === "university" ? undefined : value })}
          options={[
            { value: "university", label: "University" },
            { value: "university_subject", label: "University × Subject" },
            { value: "university_section", label: "University × Section" },
            { value: "university_student", label: "University × Student" },
          ]}
          placeholder="Group by"
          searchPlaceholder="Search…"
          className="w-[220px]"
        />
        <SearchableSelect
          value={scopeKind === "semester" ? semester || "current" : scopeKind}
          onValueChange={(value) => {
            if (value === "day") writeQuery({ scope: "day", semester: undefined, dateFrom: undefined, dateTo: undefined });
            else if (value === "range") writeQuery({ scope: "range", semester: undefined, date: undefined });
            else if (value === "current") writeQuery({ scope: undefined, semester: undefined, date: undefined, dateFrom: undefined, dateTo: undefined });
            else writeQuery({ scope: "semester", semester: value, date: undefined, dateFrom: undefined, dateTo: undefined });
          }}
          options={[
            { value: "current", label: "Current semester" },
            ...semesters.map((item) => ({ value: item, label: item })),
            { value: "day", label: "Single day" },
            { value: "range", label: "Date range" },
          ]}
          placeholder="Date scope"
          searchPlaceholder="Search semesters…"
          className="w-[220px]"
        />
        {scopeKind === "day" && (
          <Input type="date" value={day} aria-label="Day" className="h-9 w-[160px]" onChange={(e) => writeQuery({ scope: "day", date: e.target.value, semester: undefined })} />
        )}
        {scopeKind === "range" && (
          <>
            <Input type="date" value={dateFrom} aria-label="From" className="h-9 w-[160px]" onChange={(e) => writeQuery({ scope: "range", dateFrom: e.target.value })} />
            <Input type="date" value={dateTo} aria-label="To" className="h-9 w-[160px]" onChange={(e) => writeQuery({ scope: "range", dateTo: e.target.value })} />
          </>
        )}
        {!(isBoa && user?.campuses?.length === 1) && campusOptions.length > 0 && (
          <SearchableSelect
            value={campus}
            onValueChange={(value) => writeQuery({ campus: value === "all" ? undefined : value })}
            options={campusSelectOptions(campusOptions)}
            placeholder="All campuses"
            searchPlaceholder="Search campuses…"
            className="w-[220px]"
          />
        )}
        <div className="relative min-w-[180px] sm:w-56">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            placeholder="Search…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="h-9 border-gray-200 pl-9"
          />
        </div>
        <Popover open={columnsOpen} onOpenChange={(open) => { setColumnsOpen(open); if (open) setDraftColumns(columns); }}>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" className="h-9 border-gray-200">Columns</Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72">
            <div className="max-h-80 space-y-3 overflow-y-auto">
              {COLUMN_GROUPS.map((group) => (
                <div key={group.title}>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">{group.title}</p>
                  {group.ids.map((id) => (
                    <label key={id} className="flex items-center gap-2 py-1 text-sm">
                      <input
                        type="checkbox"
                        checked={draftColumns.includes(id)}
                        disabled={id === "overallPct"}
                        onChange={() => toggleDraft(id)}
                      />
                      {columnLabel(id, grain)}
                    </label>
                  ))}
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-col gap-2">
              <Button type="button" className="h-9" onClick={() => void applyColumns(false)}>Apply</Button>
              {isSuperAdmin && (
                <Button type="button" variant="outline" className="h-9" onClick={() => void applyColumns(true)}>
                  Set as default for all users
                </Button>
              )}
            </div>
          </PopoverContent>
        </Popover>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
        <Button type="button" variant="outline" className="h-9 gap-2" disabled={filtered.length === 0 || loading} onClick={() => exportRows(filtered, "attendance-stats-view.csv")}>
          <Download className="h-4 w-4" /> Export this view
        </Button>
        <Button type="button" variant="outline" className="h-9 gap-2" disabled={loading || !scopeReady} onClick={() => void exportAll()}>
          <Download className="h-4 w-4" /> Export all universities
        </Button>
      </div>

      {fetchError && (
        <div className="mb-4">
          <ErrorState message="Failed to load attendance stats." />
        </div>
      )}

      <TableShell>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-gray-200 bg-gray-50 hover:bg-gray-50">
                {headers.map((header) => (
                  <TableHead key={header} className="h-11 px-3 text-[11px] font-semibold uppercase tracking-wider text-gray-600">
                    {header}
                  </TableHead>
                ))}
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 8 }).map((_, index) => (
                  <TableRow key={index}>
                    <TableCell colSpan={headers.length + 1}><Skeleton className="h-8 w-full" /></TableCell>
                  </TableRow>
                ))
              ) : paged.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={headers.length + 1} className="h-32 text-center text-gray-500">
                    No rows for {scopeLabel}.
                  </TableCell>
                </TableRow>
              ) : (
                paged.map((row) => (
                  <TableRow key={rowKey(row, grain)} className="border-b border-gray-200">
                    <TableCell className="py-3 font-medium text-gray-900">
                      <button type="button" className="text-left hover:underline" onClick={() => openUniversity(row.university)}>
                        {row.university}
                      </button>
                    </TableCell>
                    {grain !== "university" && (
                      <TableCell className="py-3">
                        {grain === "university_subject" && row.subject ? (
                          <button type="button" className="text-left font-medium text-brand-700 hover:underline" onClick={() => openSubject(row)}>
                            {row.subject}
                          </button>
                        ) : grain === "university_student" ? (
                          row.spiPath ? (
                            <a className="font-medium text-brand-700 hover:underline" href={row.spiPath}>{row.studentName || row.studentId}</a>
                          ) : (
                            row.studentName || row.studentId
                          )
                        ) : (
                          row.section
                        )}
                      </TableCell>
                    )}
                    <TableCell className="text-right font-semibold tabular-nums" style={{ color: pctTextColor(row.overallPct) }}>
                      {row.overallPct}%
                    </TableCell>
                    {visibleColumns.map((id) => (
                      <TableCell key={id} className="text-right tabular-nums" style={id === "grainPct" ? { color: pctColor(row.grainPct) } : undefined}>
                        {id === "grainPct" ? `${row.grainPct}%` : Number(cellValue(row, id)).toLocaleString()}
                      </TableCell>
                    ))}
                    <TableCell className="text-right text-gray-300">
                      {grain === "university" && (
                        <button type="button" aria-label="Open sessions" onClick={() => openUniversity(row.university)}>
                          <ChevronRight className="ml-auto h-4 w-4" />
                        </button>
                      )}
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
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
            itemLabel="rows"
          />
        )}
      </TableShell>
    </div>
  );
}

function identityHeaders(grain: Grain): string[] {
  if (grain === "university_subject") return ["Subject"];
  if (grain === "university_section") return ["Section"];
  if (grain === "university_student") return ["Student"];
  return [];
}

function identityValues(row: StatsRow, grain: Grain): string[] {
  if (grain === "university_subject") return [row.subject ?? ""];
  if (grain === "university_section") return [row.section ?? ""];
  if (grain === "university_student") return [row.studentName || row.studentId || ""];
  return [];
}

function rowKey(row: StatsRow, grain: Grain): string {
  return [row.university, grain === "university_subject" ? row.subject : "", grain === "university_section" ? row.section : "", row.studentId ?? ""].join("|");
}

function formatDay(iso: string): string {
  const [year, month, day] = iso.split("-");
  if (!year || !month || !day) return iso;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
