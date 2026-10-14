import { useEffect, useMemo, useState, type ReactNode } from "react";
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
import { TableShell, TablePagination } from "@/components/DataTable";
import { SearchableSelect } from "@/components/SearchableSelect";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ChevronRight, Download } from "lucide-react";
import { ColumnOrderList, moveListItem } from "@/components/ColumnOrderList";
import { CheckMenu } from "@/components/SpiRecordFilterBar";
import { cn } from "@/lib/utils";
import { NO_SESSIONS_LABEL, TIER_AT_RISK, TIER_ELIGIBLE, TIER_RECOVERY, tierTextColor } from "@/lib/attendanceTiers";
import { useQueryParams } from "@/hooks/useQueryParams";
import { readSubjects, subjectOptionList } from "@/lib/subjects";
import { exportCsv } from "@/lib/csv";
import { useAuth } from "@/contexts/AuthContext";
import { omitExcludedInstitutes } from "@/lib/excludedInstitutes";
import {
  campusWisePath,
  subjectAttendanceStudentsPath,
  type DateRange,
} from "@/lib/dateRange";
import {
  type AttendanceHeader,
  type AttendanceViewGrain,
  type AttendanceViewRow,
} from "@/lib/attendanceStatsAggregate";
import { keepPreviousData, useQuery } from "@tanstack/react-query";

const PAGE_SIZES = [25, 50, 100];

type Grain = AttendanceViewGrain;

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
  university: "Campus Attendance %",
  university_subject: "Subject Attendance %",
  university_section: "Section Attendance %",
  university_unit: "Unit Attendance %",
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
  eligible: `Eligible (≥ ${TIER_ELIGIBLE}%)`,
  recoveryEligible: `Recovery (${TIER_RECOVERY}–${TIER_ELIGIBLE - 1}%)`,
  atRisk: `At risk (${TIER_AT_RISK}–${TIER_RECOVERY - 1}%)`,
  ineligible: `Ineligible (< ${TIER_AT_RISK}%)`,
};

const TIER_COLUMNS = new Set<ColumnId>(["eligible", "recoveryEligible", "atRisk", "ineligible"]);
const ALL_COLUMNS: ColumnId[] = COLUMN_GROUPS.flatMap((group) => group.ids);

interface StatsRow {
  university: string;
  subject: string | null;
  section: string | null;
  unit: string | null;
  studentId: string | null;
  studentName: string | null;
  overallPct: number;
  grainPct: number;
  present: number;
  scheduled: number;
  campusScheduled: number;
  sessions: number;
  students: number;
  absences: number;
  eligible: number;
  recoveryEligible: number;
  atRisk: number;
  ineligible: number;
  spiPath: string | null;
}

/** One page from /attendance-stats/rows, with the header totals and filter choices for the whole view. */
interface RowsPayload {
  rows: (AttendanceViewRow & { spiPath: string | null })[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  summary: AttendanceHeader;
  options: {
    campuses: string[];
    semesters: string[];
    sections: { campus: string; section: string }[];
    subjects: string[];
  };
}

const EMPTY_SUMMARY: AttendanceHeader = {
  students: 0,
  overallPct: null,
  eligible: 0,
  recoveryEligible: 0,
  atRisk: 0,
  ineligible: 0,
};

function splitList(value: string | null): string[] {
  return value ? value.split("||").map((item) => item.trim()).filter(Boolean) : [];
}

function columnLabel(id: ColumnId, grain: Grain): string {
  if (id === "grainPct") return GRAIN_PCT_LABEL[grain];
  return COLUMN_LABEL[id];
}

function cellValue(row: StatsRow, id: ColumnId): string | number {
  if (id === "overallPct" || id === "grainPct") {
    const scheduled = id === "grainPct" ? row.scheduled : row.campusScheduled;
    return scheduled > 0 ? `${row[id]}%` : NO_SESSIONS_LABEL;
  }
  if (TIER_COLUMNS.has(id)) {
    if (!row.students) return "—";
    return `${Math.round((Number(row[id]) / row.students) * 100)}%`;
  }
  return Number(row[id]).toLocaleString();
}

export default function StudentAttendanceStats() {
  const { user } = useAuth();
  const isBoa = user?.role === "boa";
  const isSuperAdmin = user?.role === "superadmin";
  const [, setLocation] = useLocation();
  const query = useQueryParams();

  const grain = (query.get("group") as Grain) || "university";
  const legacyCampus = query.get("campus");
  const campuses = splitList(query.get("campuses")).length
    ? splitList(query.get("campuses"))
    : legacyCampus && legacyCampus !== "all"
      ? [legacyCampus]
      : isBoa && user?.campuses?.length === 1
        ? [user.campuses[0]!]
        : [];
  const legacySemester = query.get("semester");
  const semesters = splitList(query.get("semesters")).length
    ? splitList(query.get("semesters"))
    : legacySemester
      ? [legacySemester]
      : [];
  const sections = splitList(query.get("sections")).map((value) => {
    const [sectionCampus, section] = value.split("\t");
    return { campus: sectionCampus ?? "", section: section ?? "" };
  }).filter((item) => item.campus && item.section);
  const subjects = readSubjects(query);
  const students = splitList(query.get("students")).map((value) => {
    const [studentId, studentCampus, studentName] = value.split("\t");
    return { studentId: studentId ?? "", campus: studentCampus ?? "", studentName: studentName ?? "" };
  }).filter((item) => item.studentId);
  const scopeKind = query.get("scope") || "semester";
  const day = query.get("date") || "";
  const dateFrom = query.get("dateFrom") || "";
  const dateTo = query.get("dateTo") || "";

  const [studentQuery, setStudentQuery] = useState("");
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
    if ("campuses" in patch || "semesters" in patch) {
      params.delete("campus");
      params.delete("semester");
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

  const detailParams = new URLSearchParams();
  if (scopeKind === "day" && /^\d{4}-\d{2}-\d{2}$/.test(day)) detailParams.set("date", day);
  if (scopeKind === "range" && /^\d{4}-\d{2}-\d{2}$/.test(dateFrom) && /^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
    detailParams.set("dateFrom", dateFrom);
    detailParams.set("dateTo", dateTo);
  }

  /** Grouping and filters as the server reads them; the page number is added per request. */
  const viewParams = (overrides: { campuses?: string[]; sections?: string[]; students?: string[] } = {}) => {
    const params = new URLSearchParams(detailParams);
    if (grain !== "university") params.set("group", grain);
    const list = (key: string, values: string[]) => {
      if (values.length) params.set(key, values.join("||"));
    };
    list("campuses", overrides.campuses ?? campuses);
    list("semesters", semesters);
    list("sections", overrides.sections ?? sections.map((item) => `${item.campus}\t${item.section}`));
    list("students", overrides.students ?? students.map((item) => `${item.campus}\t${item.studentId}`));
    list("subjects", subjects);
    return params;
  };
  const viewKey = viewParams().toString();

  const fetchRows = async (params: URLSearchParams): Promise<RowsPayload> => {
    const res = await fetch(`/api/dashboard/attendance-stats/rows?${params.toString()}`, {
      credentials: "include",
    });
    if (!res.ok) throw new Error("Failed to load attendance stats");
    return res.json() as Promise<RowsPayload>;
  };

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["attendance-stats-rows", viewKey, page, pageSize],
    enabled: scopeReady,
    queryFn: () => {
      const params = new URLSearchParams(viewKey);
      params.set("page", String(page));
      params.set("pageSize", String(pageSize));
      return fetchRows(params);
    },
    placeholderData: keepPreviousData,
    staleTime: 15 * 60_000,
  });

  const campusOptions = useMemo(() => {
    if (isBoa && user?.campuses?.length === 1) return omitExcludedInstitutes(user.campuses);
    return omitExcludedInstitutes(data?.options.campuses ?? []);
  }, [data, isBoa, user?.campuses]);
  const semesterOptions = data?.options.semesters ?? [];
  const sectionChoices = data?.options.sections ?? [];
  const subjectOptions = useMemo(() => subjectOptionList(data?.options.subjects ?? []), [data]);

  const searchText = studentQuery.trim();
  const { data: studentSearch } = useQuery({
    queryKey: ["attendance-stats-student-search", detailParams.toString(), campuses.join("||"), semesters.join("||"), query.get("sections") ?? "", searchText],
    enabled: scopeReady && searchText.length >= 2,
    queryFn: async () => {
      const params = viewParams({ students: [] });
      params.delete("group");
      params.delete("subjects");
      params.set("q", searchText);
      const res = await fetch(`/api/dashboard/attendance-stats/student-search?${params.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to search students");
      return res.json() as Promise<{ students: { studentId: string; studentName: string; campus: string }[] }>;
    },
    placeholderData: keepPreviousData,
    staleTime: 15 * 60_000,
  });
  const studentHits = searchText.length >= 2 ? studentSearch?.students ?? [] : [];

  const summary: AttendanceHeader = data?.summary ?? EMPTY_SUMMARY;
  const tableLoading = grain === "university_unit"
    ? campuses.length > 0 && isLoading
    : isLoading;
  const paged = data?.rows ?? [];
  const totalRows = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;
  const currentPage = data?.page ?? page;

  const visibleColumns = columns.filter((id) => ALL_COLUMNS.includes(id));
  const identity = identityHeaders(grain);
  const headers = ["Campus", ...identity, ...visibleColumns.map((id) => columnLabel(id, grain))];

  const scopeLabel = [
    campusScopeLabel(campuses, campusOptions),
    semesters.length ? semesters.join(", ") : "Current semesters",
    subjects.length === 1 ? subjects[0] : subjects.length > 1 ? `${subjects.length} subjects` : "",
    scopeKind === "day" && day
      ? formatDay(day)
      : scopeKind === "range" && dateFrom && dateTo
        ? dateFrom === dateTo
          ? formatDay(dateFrom)
          : `${formatDay(dateFrom)} – ${formatDay(dateTo)}`
        : "",
  ].filter(Boolean).join(" · ");

  const drillSemester = semesters.length === 1 ? semesters[0] : undefined;

  const drillRange = (): DateRange =>
    scopeKind === "day" && day
      ? { dateFrom: day, dateTo: day }
      : scopeKind === "range"
        ? { dateFrom, dateTo }
        : {};

  const openUniversity = (name: string) => {
    const range = drillRange();
    setLocation(campusWisePath(range, name, scopeKind === "semester" ? drillSemester : undefined));
  };

  const openSubject = (row: StatsRow) => {
    if (!row.subject) return;
    const range = drillRange();
    setLocation(subjectAttendanceStudentsPath(range, {
      subject: row.subject,
      campus: row.university,
      semester: scopeKind === "semester" ? drillSemester : undefined,
    }));
  };

  const exportRows = (data: StatsRow[], filename: string) => {
    exportCsv(
      filename,
      headers,
      data.map((row) => [
        row.university,
        ...identityValues(row, grain),
        ...visibleColumns.map((id) => cellValue(row, id)),
      ]),
    );
  };

  /** CSV needs every row, not the page on screen, so exports ask the server for the whole view. */
  const exportView = async () => {
    const params = viewParams();
    params.set("export", "1");
    exportRows((await fetchRows(params)).rows, "attendance-stats-view.csv");
  };

  const exportAll = async () => {
    const params = viewParams({ campuses: [], sections: [], students: [] });
    params.set("export", "1");
    exportRows((await fetchRows(params)).rows, "attendance-stats-all-campuses.csv");
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

  const columnOrder = [
    ...draftColumns,
    ...ALL_COLUMNS.filter((id) => !draftColumns.includes(id)),
  ];
  const textColumnCount = 1 + identity.length;

  const rated = summary.eligible + summary.recoveryEligible + summary.atRisk + summary.ineligible;
  const share = (count: number) => (rated > 0 ? `${Math.round((count / rated) * 100)}%` : "—");
  const multiCampus = campuses.length !== 1;

  const toolbar = (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Popover open={columnsOpen} onOpenChange={(open) => { setColumnsOpen(open); if (open) setDraftColumns(columns); }}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" size="sm">Columns</Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72">
          <p className="mb-2 text-xs text-gray-500">Drag to set the column order.</p>
          <ColumnOrderList
            ids={columnOrder}
            label={(id) => columnLabel(id, grain)}
            checked={(id) => draftColumns.includes(id)}
            locked={(id) => id === "overallPct"}
            onToggle={toggleDraft}
            onReorder={(from, to) => {
              const next = moveListItem(columnOrder, from, to);
              setDraftColumns(next.filter((id) => draftColumns.includes(id)));
            }}
          />
          <div className="mt-3 flex flex-col gap-2">
            <Button type="button" size="sm" onClick={() => void applyColumns(false)}>Apply</Button>
            {isSuperAdmin && (
              <Button type="button" variant="outline" size="sm" onClick={() => void applyColumns(true)}>
                Set as default for all users
              </Button>
            )}
          </div>
        </PopoverContent>
      </Popover>
      <Button type="button" variant="outline" size="sm" disabled={totalRows === 0 || tableLoading} onClick={() => void exportView()}>
        <Download className="mr-1 h-4 w-4" /> Export this view
      </Button>
      <Button type="button" variant="outline" size="sm" disabled={isLoading || !scopeReady || grain === "university_unit"} onClick={() => void exportAll()}>
        <Download className="mr-1 h-4 w-4" /> Export all campuses
      </Button>
    </div>
  );

  return (
    <div className="flex min-w-0 flex-col">
      <PageHeader title="Student Attendance Stats" right={toolbar} />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <StatTile label="Students" value={isLoading ? null : summary.students.toLocaleString("en-IN")} hint={scopeLabel} />
        <StatTile label="Overall attendance" value={isLoading ? null : summary.overallPct == null ? "—" : `${summary.overallPct.toFixed(1)}%`} hint="" />
        <StatTile label="Eligible" value={isLoading ? null : summary.eligible.toLocaleString("en-IN")} hint={isLoading ? "" : `${share(summary.eligible)} at ${TIER_ELIGIBLE}% or above`} />
        <StatTile label="Recovery" value={isLoading ? null : summary.recoveryEligible.toLocaleString("en-IN")} hint={isLoading ? "" : `${share(summary.recoveryEligible)} at ${TIER_RECOVERY}–${TIER_ELIGIBLE - 1}%`} />
        <StatTile label="At risk" value={isLoading ? null : summary.atRisk.toLocaleString("en-IN")} hint={isLoading ? "" : `${share(summary.atRisk)} at ${TIER_AT_RISK}–${TIER_RECOVERY - 1}%`} />
        <StatTile label="Ineligible" value={isLoading ? null : summary.ineligible.toLocaleString("en-IN")} hint={isLoading ? "" : `${share(summary.ineligible)} below ${TIER_AT_RISK}%`} tone="rose" />
      </div>
      <div className="mb-4 flex flex-col gap-3">
        <div className="flex flex-nowrap items-end gap-3 overflow-x-auto pb-1">
          <FilterField label="Group by">
            <SearchableSelect
              value={grain}
              onValueChange={(value) => writeQuery({ group: value === "university" ? undefined : value })}
              options={[
                { value: "university", label: "Campus-wise" },
                { value: "university_subject", label: "Subject-wise" },
                { value: "university_section", label: "Section-wise" },
                { value: "university_unit", label: "Unit-wise" },
                { value: "university_student", label: "Student-wise" },
              ]}
              placeholder="Group by"
              searchPlaceholder="Search…"
              className="w-[180px]"
            />
          </FilterField>
          {!(isBoa && user?.campuses?.length === 1) && (
            <FilterField label="Campus">
              <CheckMenu
                label={campuses.length ? `${campuses.length} selected` : "All campuses"}
                options={campusOptions.map((name) => ({ id: name, label: name }))}
                selected={campuses}
                onChange={(next) => {
                  const keptSections = next.length ? sections.filter((item) => next.includes(item.campus)) : [];
                  const keptStudents = next.length ? students.filter((item) => next.includes(item.campus)) : [];
                  writeQuery({
                    campuses: next.join("||") || undefined,
                    sections: keptSections.map((item) => `${item.campus}\t${item.section}`).join("||") || undefined,
                    students: keptStudents.map((item) => `${item.studentId}\t${item.campus}\t${item.studentName}`).join("||") || undefined,
                  });
                }}
              />
            </FilterField>
          )}
          <FilterField label="Semester">
            <CheckMenu
              label={semesters.length ? `${semesters.length} selected` : "Current semesters"}
              options={semesterOptions.map((name) => ({ id: name, label: name }))}
              selected={semesters}
              onChange={(next) => writeQuery({ semesters: next.join("||") || undefined })}
            />
          </FilterField>
          <FilterField label="Section">
            <CheckMenu
              label={sections.length ? `${sections.length} selected` : campuses.length ? "All sections" : "Select a campus"}
              options={sectionChoices.map((item) => ({
                id: `${item.campus}\t${item.section}`,
                label: multiCampus ? `${item.campus} — ${item.section}` : item.section,
              }))}
              selected={sections.map((item) => `${item.campus}\t${item.section}`)}
              onChange={(ids) => {
                const next = ids.map((id) => {
                  const [sectionCampus, section] = id.split("\t");
                  return { campus: sectionCampus ?? "", section: section ?? "" };
                });
                const keptStudents = next.length
                  ? students.filter((item) => next.some((section) => section.campus === item.campus))
                  : [];
                writeQuery({
                  sections: next.map((item) => `${item.campus}\t${item.section}`).join("||") || undefined,
                  students: keptStudents.map((item) => `${item.studentId}\t${item.campus}\t${item.studentName}`).join("||") || undefined,
                });
              }}
            />
          </FilterField>
          <FilterField label="Subject">
            <CheckMenu
              label={subjects.length ? `${subjects.length} selected` : "All subjects"}
              options={subjectOptions.map((name) => ({ id: name, label: name }))}
              selected={subjects}
              onChange={(next) => writeQuery({ subjects: next.join("||") || undefined })}
            />
          </FilterField>
          <FilterField label="Student">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-[180px] justify-between">{students.length ? `${students.length} selected` : "All students"}</Button>
              </PopoverTrigger>
              <PopoverContent className="w-72" align="start">
                <Input value={studentQuery} placeholder="Search name or ID" onChange={(event) => setStudentQuery(event.target.value)} />
                <div className="mt-2 max-h-56 space-y-1 overflow-y-auto">
                  {studentHits.map((hit) => {
                    const on = students.some((item) => item.studentId === hit.studentId && item.campus === hit.campus);
                    return (
                      <label key={`${hit.campus}-${hit.studentId}`} className="flex items-start gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => {
                            const next = on
                              ? students.filter((item) => !(item.studentId === hit.studentId && item.campus === hit.campus))
                              : [...students, hit];
                            writeQuery({
                              students: next.map((item) => `${item.studentId}\t${item.campus}\t${item.studentName}`).join("||") || undefined,
                            });
                          }}
                        />
                        <span>
                          {hit.studentName}
                          <span className="block text-xs text-gray-500">{hit.campus}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </PopoverContent>
            </Popover>
          </FilterField>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <FilterField label="Date scope">
            <SearchableSelect
              value={scopeKind === "day" ? "day" : scopeKind === "range" ? "range" : "semester"}
              onValueChange={(value) => {
                if (value === "day") writeQuery({ scope: "day", dateFrom: undefined, dateTo: undefined });
                else if (value === "range") writeQuery({ scope: "range", date: undefined });
                else writeQuery({ scope: undefined, date: undefined, dateFrom: undefined, dateTo: undefined });
              }}
              options={[
                { value: "semester", label: "Semester dates" },
                { value: "day", label: "Single day" },
                { value: "range", label: "Date range" },
              ]}
              placeholder="Date scope"
              className="w-[180px]"
            />
          </FilterField>
          {scopeKind === "day" && (
            <FilterField label="Day">
              <Input type="date" value={day} aria-label="Day" className="h-9 w-[160px]" onChange={(e) => writeQuery({ scope: "day", date: e.target.value })} />
            </FilterField>
          )}
          {scopeKind === "range" && (
            <>
              <FilterField label="From">
                <Input type="date" value={dateFrom} aria-label="From" className="h-9 w-[160px]" onChange={(e) => writeQuery({ scope: "range", dateFrom: e.target.value })} />
              </FilterField>
              <FilterField label="To">
                <Input type="date" value={dateTo} aria-label="To" className="h-9 w-[160px]" onChange={(e) => writeQuery({ scope: "range", dateTo: e.target.value })} />
              </FilterField>
            </>
          )}
          <Button type="button" variant="outline" className="h-9" onClick={() => writeQuery({
            campuses: undefined,
            semesters: undefined,
            sections: undefined,
            students: undefined,
            subjects: undefined,
            campus: undefined,
            semester: undefined,
          })}>
            Clear
          </Button>
        </div>
      </div>

      {isError && (
        <div className="mb-4">
          <ErrorState message="Failed to load attendance stats." onRetry={() => void refetch()} />
        </div>
      )}

      <TableShell>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-gray-200 bg-gray-50 hover:bg-gray-50">
                {headers.map((header, index) => (
                  <TableHead
                    key={header}
                    className={`h-11 px-3 text-[11px] font-semibold uppercase tracking-wider text-gray-600 ${index < textColumnCount ? "text-left" : "text-right"}`}
                  >
                    {header}
                  </TableHead>
                ))}
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {tableLoading ? (
                Array.from({ length: 8 }).map((_, index) => (
                  <TableRow key={index}>
                    <TableCell colSpan={headers.length + 1}><Skeleton className="h-8 w-full" /></TableCell>
                  </TableRow>
                ))
              ) : paged.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={headers.length + 1} className="h-32 text-center text-gray-500">
                    {grain === "university_unit" && !campuses.length
                      ? "Select a campus to see unit-wise attendance."
                      : `No rows for ${scopeLabel}.`}
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
                    {identity.map((header, index) => (
                      <TableCell key={header} className="py-3">
                        {header === "Subject" && row.subject ? (
                          <button type="button" className="text-left font-medium text-brand-700 hover:underline" onClick={() => openSubject(row)}>
                            {row.subject}
                          </button>
                        ) : header === "Student" ? (
                          row.spiPath ? (
                            <a className="font-medium text-brand-700 hover:underline" href={row.spiPath}>{row.studentName || row.studentId}</a>
                          ) : (
                            row.studentName || row.studentId
                          )
                        ) : (
                          identityValues(row, grain)[index]
                        )}
                      </TableCell>
                    ))}
                    {visibleColumns.map((id) => (
                      <TableCell
                        key={id}
                        className="text-right tabular-nums"
                        style={
                          id === "overallPct" && row.campusScheduled > 0
                            ? { color: tierTextColor(row.overallPct) }
                            : id === "grainPct" && row.scheduled > 0
                              ? { color: tierTextColor(row.grainPct) }
                              : undefined
                        }
                      >
                        {cellValue(row, id)}
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
        {!tableLoading && totalRows > 0 && (
          <TablePagination
            page={currentPage}
            totalPages={totalPages}
            totalItems={totalRows}
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
  if (grain === "university_unit") return ["Subject", "Unit"];
  if (grain === "university_student") return ["Student"];
  return [];
}

function identityValues(row: StatsRow, grain: Grain): string[] {
  if (grain === "university_subject") return [row.subject ?? ""];
  if (grain === "university_section") return [row.section ?? ""];
  if (grain === "university_unit") return [row.subject ?? "", row.unit ?? ""];
  if (grain === "university_student") return [row.studentName || row.studentId || ""];
  return [];
}

function rowKey(row: StatsRow, grain: Grain): string {
  return [row.university, row.subject ?? "", row.section ?? "", row.unit ?? "", row.studentId ?? "", grain].join("|");
}

function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex shrink-0 flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
      {label}
      {children}
    </label>
  );
}

function StatTile({ label, value, hint, tone }: { label: string; value: string | null; hint: string; tone?: "rose" }) {
  return (
    <div className={cn("rounded-lg border p-4", tone === "rose" ? "border-rose-200 bg-rose-50" : "border-gray-200 bg-white")}>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{label}</div>
      {value == null ? <Skeleton className="mt-2 h-8 w-24" /> : <div className="mt-1 text-2xl font-semibold text-gray-900">{value}</div>}
      {hint ? <div className="mt-1 text-xs text-gray-500">{hint}</div> : null}
    </div>
  );
}

function campusScopeLabel(selected: string[], options: string[]): string {
  if (!selected.length) return "All campuses";
  const everyCampus = options.length > 0 && options.every((name) => selected.includes(name));
  if (everyCampus) return `${options.length.toLocaleString("en-IN")} campuses`;
  return selected.join(", ");
}

function formatDay(iso: string): string {
  const [year, month, day] = iso.split("-");
  if (!year || !month || !day) return iso;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
