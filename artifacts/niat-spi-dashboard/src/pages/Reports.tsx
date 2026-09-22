import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  useGetDashboardStudents,
  getGetDashboardStudentsQueryKey,
  useGetDashboardFilters,
  getGetDashboardFiltersQueryKey,
  type DashboardStudent,
} from "@workspace/api-client-react";
import { PageHeader } from "@/components/PageHeader";
import { PageBreadcrumb } from "@/components/PageBreadcrumb";
import { SubNav, reportsNav } from "@/components/SubNav";
import { TableShell, TablePagination } from "@/components/DataTable";
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
import { Skeleton } from "@/components/ui/skeleton";
import {
  SearchableSelect,
  campusSelectOptions,
  sectionSelectOptions,
} from "@/components/SearchableSelect";
import { useAuth } from "@/contexts/AuthContext";
import { useAttendanceSemesters } from "@/hooks/useAttendanceSemesters";
import { useDebounceValue } from "@/hooks/useDebounceValue";
import { exportCsv } from "@/lib/csv";
import { cn, pctTextColor } from "@/lib/utils";
import { KpiCard } from "@/components/dashboard/blocks";
import {
  computeSpiScore,
  spiStanding,
  standingLabel,
  type SpiStanding,
} from "@/lib/spiScore";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChevronRight,
  Download,
  ExternalLink,
  Loader2,
  Search,
} from "lucide-react";

type ReportsTab = "spi-record" | "skill-debt" | "insights";
type Drill = "campus" | "section" | "students";

const FETCH_LIMIT = 5000;
const PAGE_SIZES = [10, 25, 50, 100];
const CURRENT_SEMESTER = "current";

const PLACEHOLDER = {
  "skill-debt": {
    title: "Skill Debt",
    description: "Students with active Skill Debt will appear here.",
  },
} as const;

function tabFromPath(path: string): ReportsTab {
  if (path === "/dashboard/reports/skill-debt") return "skill-debt";
  if (path === "/dashboard/reports/insights") return "insights";
  return "spi-record";
}

type StudentRow = DashboardStudent & {
  spiPct: number;
  spiPoints: number;
  standing: SpiStanding;
};

type CampusRow = {
  name: string;
  studentCount: number;
  sectionCount: number;
  avgSpiPoints: number | null;
};

type SectionRow = {
  name: string;
  studentCount: number;
  avgSpiPoints: number | null;
};

function enrichStudent(s: DashboardStudent): StudentRow {
  const { spiPct, points } = computeSpiScore(s.classroomAvg, s.moduleAvg);
  return {
    ...s,
    spiPct,
    spiPoints: points,
    standing: spiStanding(points),
  };
}

function StandingBadge({ standing }: { standing: SpiStanding }) {
  const styles =
    standing === "good"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : standing === "recovery"
        ? "bg-amber-50 text-amber-800 border-amber-200"
        : "bg-red-50 text-red-700 border-red-200";
  return (
    <span
      className={cn(
        "inline-flex rounded-full border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide",
        styles,
      )}
    >
      {standingLabel(standing)}
    </span>
  );
}

function formatSpi(points: number): string {
  return `${points.toFixed(1)} / 10`;
}

function nameKey(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function sectionKey(value: string | null | undefined): string {
  return value?.trim() || "Unassigned";
}

function meanPoints(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
}

function Th({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <TableHead
      className={cn(
        "text-xs font-semibold uppercase tracking-wide text-gray-500",
        className,
      )}
    >
      {children}
    </TableHead>
  );
}

function SpiRecordPanel() {
  const { user } = useAuth();
  const isBoa = user?.role === "boa";
  const hideCampus = Boolean(isBoa && user?.campuses?.length === 1);

  const [drill, setDrill] = useState<Drill>(hideCampus ? "section" : "campus");
  const [selectedCampus, setSelectedCampus] = useState<string | null>(
    hideCampus ? (user?.campuses?.[0] ?? null) : null,
  );
  const [selectedSection, setSelectedSection] = useState<string | null>(null);

  const [semester, setSemester] = useState("");
  const [campusFilter, setCampusFilter] = useState(
    hideCampus ? (user?.campuses?.[0] ?? "all") : "all",
  );
  const [sectionFilter, setSectionFilter] = useState("all");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounceValue(search, 300);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const resetPage = () => setPage(1);

  // Lite summary: campus roster counts only (skips subject/section/worst scans).
  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ["dashboard-summary-lite", semester || "current"],
    queryFn: async () => {
      const params = new URLSearchParams({ lite: "1" });
      if (semester) params.set("semester", semester);
      const res = await fetch(`/api/dashboard/summary?${params}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load summary");
      return res.json() as Promise<{
        campusBreakdown: Array<{
          instituteName: string;
          studentCount: number;
          sectionCount: number;
        }>;
        sectionBreakdown: Array<{
          instituteName: string;
          sectionName: string;
          studentCount: number;
        }>;
      }>;
    },
    staleTime: 5 * 60_000,
  });

  const filterCampusForOptions =
    campusFilter !== "all" ? campusFilter : selectedCampus ?? undefined;
  const { data: filterOptions, isLoading: filtersLoading } =
    useGetDashboardFilters(
      { campus: filterCampusForOptions },
      {
        query: {
          queryKey: getGetDashboardFiltersQueryKey({
            campus: filterCampusForOptions,
          }),
          staleTime: 5 * 60_000,
        },
      },
    );

  const campusOptions = hideCampus
    ? (user?.campuses ?? [])
    : (filterOptions?.campuses ??
      summary?.campusBreakdown.map((c) => c.instituteName) ??
      []);
  const sectionOptions = filterOptions?.sections ?? [];
  const semesters = useAttendanceSemesters(
    campusFilter !== "all" ? campusFilter : undefined,
  );

  // SPI averages from BigQuery (no 5k student payload on college/section lists).
  const { data: campusSpi, isLoading: campusSpiLoading, isError: campusSpiError } =
    useQuery({
      queryKey: ["spi-averages", "campus", semester || "current"],
      queryFn: async () => {
        const params = new URLSearchParams({ group: "campus" });
        if (semester) params.set("semester", semester);
        const res = await fetch(`/api/dashboard/spi-averages?${params}`, {
          credentials: "include",
        });
        if (!res.ok) throw new Error("Failed to load SPI averages");
        return res.json() as Promise<{
          rows: Array<{
            instituteName: string;
            avgSpiPoints: number;
            studentCount: number;
            sectionCount: number;
          }>;
        }>;
      },
      enabled: drill === "campus",
      staleTime: 5 * 60_000,
    });

  const sectionCampus =
    selectedCampus ?? (campusFilter !== "all" ? campusFilter : null);

  // One campus of students powers both the section rollup and the student list.
  const studentQuery = {
    limit: FETCH_LIMIT,
    campus: sectionCampus ?? undefined,
    semester: semester || undefined,
  };

  const studentsEnabled = Boolean(sectionCampus) && drill !== "campus";
  const {
    data: students,
    isLoading: studentsLoading,
    isFetching,
    isError: studentsError,
  } = useGetDashboardStudents(studentQuery, {
    query: {
      queryKey: getGetDashboardStudentsQueryKey(studentQuery),
      enabled: studentsEnabled,
      staleTime: 60_000,
      placeholderData: (previousData) => previousData,
    },
  });

  const rows = useMemo(
    () => (students ?? []).map(enrichStudent),
    [students],
  );

  const q = debouncedSearch.trim().toLowerCase();

  const spiByCampus = useMemo(() => {
    const out = new Map<string, number>();
    for (const row of campusSpi?.rows ?? []) {
      out.set(nameKey(row.instituteName), row.avgSpiPoints);
    }
    return out;
  }, [campusSpi]);

  const campuses = useMemo<CampusRow[]>(() => {
    const summaryByKey = new Map(
      (summary?.campusBreakdown ?? []).map((c) => [nameKey(c.instituteName), c]),
    );
    const spiRows = campusSpi?.rows ?? [];
    const source: CampusRow[] =
      spiRows.length > 0
        ? spiRows.map((row) => {
            const extra = summaryByKey.get(nameKey(row.instituteName));
            return {
              name: row.instituteName,
              studentCount: row.studentCount || extra?.studentCount || 0,
              sectionCount: row.sectionCount || extra?.sectionCount || 0,
              avgSpiPoints: Number.isFinite(row.avgSpiPoints)
                ? row.avgSpiPoints
                : 0,
            };
          })
        : (summary?.campusBreakdown ?? []).map((c) => ({
            name: c.instituteName,
            studentCount: c.studentCount,
            sectionCount: c.sectionCount,
            avgSpiPoints: spiByCampus.get(nameKey(c.instituteName)) ?? null,
          }));

    return source
      .filter((c) => {
        if (campusFilter !== "all" && nameKey(c.name) !== nameKey(campusFilter))
          return false;
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [summary, campusSpi, campusFilter, spiByCampus]);

  const sections = useMemo<SectionRow[]>(() => {
    if (!selectedCampus) return [];
    const bySection = new Map<string, number[]>();
    for (const student of rows) {
      const name = sectionKey(student.sectionName);
      const list = bySection.get(name);
      if (list) list.push(student.spiPoints);
      else bySection.set(name, [student.spiPoints]);
    }
    const fromStudents = Array.from(bySection.entries()).map(([name, points]) => ({
      name,
      studentCount: points.length,
      avgSpiPoints: meanPoints(points),
    }));
    const source =
      fromStudents.length > 0
        ? fromStudents
        : sectionOptions.map((name) => ({
            name,
            studentCount: 0,
            avgSpiPoints: null,
          }));
    return source
      .filter((section) => {
        if (
          sectionFilter !== "all" &&
          nameKey(section.name) !== nameKey(sectionFilter)
        ) {
          return false;
        }
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [selectedCampus, rows, sectionOptions, sectionFilter]);

  const sectionStudents = useMemo(() => {
    if (!selectedSection) return [];
    return rows
      .filter((s) => nameKey(sectionKey(s.sectionName)) === nameKey(selectedSection))
      .filter((s) => {
        if (!q) return true;
        return (
          s.studentName.toLowerCase().includes(q) ||
          s.studentId.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => a.studentName.localeCompare(b.studentName));
  }, [rows, selectedSection, q]);

  const activeList =
    drill === "campus"
      ? campuses
      : drill === "section"
        ? sections
        : sectionStudents;

  const totalPages = Math.max(1, Math.ceil(activeList.length / pageSize));
  const start = (page - 1) * pageSize;
  const pageRows = activeList.slice(start, start + pageSize);

  useEffect(() => {
    if (page > totalPages) setPage(1);
  }, [page, totalPages]);

  const setCollege = (value: string) => {
    if (drill === "campus") {
      setCampusFilter(value);
      resetPage();
      return;
    }
    setCampusFilter(value);
    setSectionFilter("all");
    setSelectedSection(null);
    resetPage();
    if (value === "all") {
      setSelectedCampus(null);
      setSearch("");
      setDrill("campus");
    } else {
      setSelectedCampus(value);
      setDrill("section");
    }
  };

  const setSection = (value: string) => {
    if (drill === "section") {
      setSectionFilter(value);
      resetPage();
      return;
    }
    setSectionFilter(value);
    resetPage();
    if (value === "all") {
      setSelectedSection(null);
      setSearch("");
      if (campusFilter !== "all") {
        setSelectedCampus(campusFilter);
        setDrill("section");
      } else {
        setDrill(hideCampus ? "section" : "campus");
      }
      return;
    }
    const campus = campusFilter !== "all" ? campusFilter : selectedCampus;
    if (!campus) return;
    setCampusFilter(campus);
    setSelectedCampus(campus);
    setSelectedSection(value);
    setDrill("students");
  };

  const activeFilterCount =
    (semester ? 1 : 0) +
    (!hideCampus && campusFilter !== "all" ? 1 : 0) +
    (sectionFilter !== "all" ? 1 : 0) +
    (drill === "students" && search.trim() ? 1 : 0);

  const openCampus = (name: string) => {
    setCampusFilter(name);
    setSelectedCampus(name);
    setSectionFilter("all");
    setSelectedSection(null);
    setDrill("section");
    resetPage();
  };

  const openSection = (name: string) => {
    setSectionFilter(name);
    setSelectedSection(name);
    setDrill("students");
    resetPage();
  };

  const goInstitutes = () => {
    if (hideCampus) return;
    setCampusFilter("all");
    setSectionFilter("all");
    setSelectedCampus(null);
    setSelectedSection(null);
    setSearch("");
    setDrill("campus");
    resetPage();
  };

  const goSections = () => {
    if (!selectedCampus) return;
    setCampusFilter(selectedCampus);
    setSectionFilter("all");
    setSelectedSection(null);
    setSearch("");
    setDrill("section");
    resetPage();
  };

  const clearAll = () => {
    setSemester("");
    setSearch("");
    setSectionFilter("all");
    if (hideCampus) {
      const only = user?.campuses?.[0];
      if (!only) return;
      setCampusFilter(only);
      setSelectedCampus(only);
      setSelectedSection(null);
      setDrill("section");
    } else {
      setCampusFilter("all");
      setSelectedCampus(null);
      setSelectedSection(null);
      setDrill("campus");
    }
    resetPage();
  };

  const handleExport = () => {
    // Full filtered result set (not just the current page).
    if (drill === "students") {
      exportCsv(
        "spi-record-students.csv",
        ["Student", "SPI Score", "Status"],
        sectionStudents.map((s) => [
          s.studentName,
          formatSpi(s.spiPoints),
          standingLabel(s.standing),
        ]),
      );
      return;
    }
    if (drill === "section") {
      exportCsv(
        "spi-record-sections.csv",
        ["Section", "Avg SPI Score", "Students Count"],
        sections.map((s) => [
          s.name,
          s.avgSpiPoints !== null ? formatSpi(s.avgSpiPoints) : "",
          s.studentCount,
        ]),
      );
      return;
    }
    exportCsv(
      "spi-record-colleges.csv",
      ["Institute Name", "Avg SPI Score", "Section", "Students Count"],
      campuses.map((c) => [
        c.name,
        c.avgSpiPoints !== null ? formatSpi(c.avgSpiPoints) : "",
        c.sectionCount,
        c.studentCount,
      ]),
    );
  };

  const listLabel =
    drill === "campus"
      ? "institutes"
      : drill === "section"
        ? "sections"
        : "students";

  const isLoading =
    summaryLoading ||
    (drill === "campus" && campusSpiLoading) ||
    (studentsEnabled && studentsLoading);

  const semesterSelect = (
    <SearchableSelect
      value={semester || CURRENT_SEMESTER}
      onValueChange={(value) => {
        setSemester(value === CURRENT_SEMESTER ? "" : value);
        resetPage();
      }}
      options={[
        { value: CURRENT_SEMESTER, label: "Current semester" },
        ...semesters.map((s) => ({ value: s, label: s })),
        ...(semester && !semesters.includes(semester)
          ? [{ value: semester, label: semester }]
          : []),
      ]}
      placeholder="Current semester"
      searchPlaceholder="Search semesters…"
      className="w-[200px]"
      disabled={semesters.length === 0 && !semester}
    />
  );

  const instituteSelect = !hideCampus && (
    <SearchableSelect
      value={campusFilter}
      onValueChange={setCollege}
      options={campusSelectOptions(campusOptions, "All Colleges")}
      placeholder="All Colleges"
      searchPlaceholder="Search colleges…"
      className="w-[220px]"
      disabled={filtersLoading && campusOptions.length === 0}
    />
  );

  const sectionSelect = (drill === "section" || drill === "students") && (
    <SearchableSelect
      value={sectionFilter}
      onValueChange={setSection}
      options={sectionSelectOptions(sectionOptions, "All Sections")}
      placeholder="All Sections"
      searchPlaceholder="Search sections…"
      className="w-[200px]"
      disabled={
        (campusFilter === "all" && !selectedCampus) || filtersLoading
      }
    />
  );

  const actions = (
    <>
      <Button
        variant="outline"
        className="h-9 gap-2 border-gray-200"
        onClick={handleExport}
        disabled={activeList.length === 0}
      >
        <Download className="h-4 w-4" /> Export
      </Button>
      {activeFilterCount > 0 && (
        <button
          type="button"
          onClick={clearAll}
          className="h-9 px-2 text-sm font-semibold text-red-600 hover:text-red-700 hover:underline"
        >
          Clear
        </button>
      )}
      {((studentsEnabled && isFetching && !studentsLoading) ||
        campusSpiLoading) && (
        <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
      )}
    </>
  );

  return (
    <div className="flex flex-col">
      {drill !== "campus" && (
        <PageBreadcrumb
          items={[
            {
              label: "All Colleges",
              onClick: hideCampus ? undefined : goInstitutes,
            },
            ...(selectedCampus
              ? [
                  {
                    label: selectedCampus,
                    onClick: goSections,
                    current: drill === "section",
                  },
                ]
              : []),
            ...(selectedSection && drill === "students"
              ? [{ label: selectedSection, current: true as const }]
              : []),
          ]}
        />
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {instituteSelect}
        {semesterSelect}
        {sectionSelect}
        {drill === "students" && (
          <div className="relative min-w-[200px] flex-1 sm:w-64 sm:flex-none">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              placeholder="Search student name…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                resetPage();
              }}
              className="h-9 w-full border-gray-200 pl-9"
            />
          </div>
        )}
        {actions}
      </div>

      {drill === "campus" && campusSpiError && (
        <p className="mb-3 text-sm text-red-600">
          Could not load institute SPI averages. Counts may still appear.
        </p>
      )}
      {studentsEnabled && studentsError && (
        <p className="mb-3 text-sm text-red-600">
          Could not load student SPI data for this college.
        </p>
      )}

      <TableShell>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-gray-200 bg-gray-50 hover:bg-gray-50">
                {drill === "campus" && (
                  <>
                    <Th className="min-w-[220px]">Institute Name</Th>
                    <Th className="text-right">Avg SPI Score</Th>
                    <Th className="text-right">Section</Th>
                    <Th className="text-right">Students Count</Th>
                    <Th className="w-10" />
                  </>
                )}
                {drill === "section" && (
                  <>
                    <Th className="min-w-[180px]">Section</Th>
                    <Th className="text-right">Avg SPI Score</Th>
                    <Th className="text-right">Students Count</Th>
                    <Th className="w-10" />
                  </>
                )}
                {drill === "students" && (
                  <>
                    <Th className="min-w-[200px]">Student</Th>
                    <Th className="text-right">SPI Score</Th>
                    <Th>Status</Th>
                    <Th className="text-right">Report</Th>
                  </>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i} className="border-b border-gray-100">
                    <TableCell colSpan={5}>
                      <Skeleton className="h-8 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : pageRows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="h-24 text-center text-gray-500"
                  >
                    No data matches your filters.
                  </TableCell>
                </TableRow>
              ) : drill === "campus" ? (
                (pageRows as CampusRow[]).map((c) => (
                  <TableRow
                    key={c.name}
                    className="cursor-pointer border-b border-gray-100 hover:bg-gray-50"
                    onClick={() => openCampus(c.name)}
                  >
                    <TableCell className="py-3 font-medium text-gray-900">
                      {c.name}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {c.avgSpiPoints !== null ? (
                        <span
                          style={{
                            color: pctTextColor(c.avgSpiPoints * 10),
                          }}
                        >
                          {formatSpi(c.avgSpiPoints)}
                        </span>
                      ) : (
                        <span className="font-normal text-gray-300">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-gray-600">
                      {c.sectionCount.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-gray-600">
                      {c.studentCount.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <ChevronRight className="ml-auto h-4 w-4 text-gray-400" />
                    </TableCell>
                  </TableRow>
                ))
              ) : drill === "section" ? (
                (pageRows as SectionRow[]).map((sec) => (
                  <TableRow
                    key={sec.name}
                    className="cursor-pointer border-b border-gray-100 hover:bg-gray-50"
                    onClick={() => openSection(sec.name)}
                  >
                    <TableCell className="py-3 font-medium text-gray-900">
                      {sec.name}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {sec.avgSpiPoints !== null ? (
                        <span
                          style={{
                            color: pctTextColor(sec.avgSpiPoints * 10),
                          }}
                        >
                          {formatSpi(sec.avgSpiPoints)}
                        </span>
                      ) : (
                        <span className="font-normal text-gray-300">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-gray-600">
                      {sec.studentCount.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <ChevronRight className="ml-auto h-4 w-4 text-gray-400" />
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                (pageRows as StudentRow[]).map((s) => (
                  <TableRow
                    key={s.studentId}
                    className="border-b border-gray-100"
                  >
                    <TableCell className="py-3 font-medium text-gray-900">
                      {s.studentName}
                    </TableCell>
                    <TableCell
                      className="text-right font-semibold tabular-nums"
                      style={{ color: pctTextColor(s.spiPoints * 10) }}
                    >
                      {formatSpi(s.spiPoints)}
                    </TableCell>
                    <TableCell>
                      <StandingBadge standing={s.standing} />
                    </TableCell>
                    <TableCell className="text-right">
                      {s.spiPath ? (
                        <a
                          href={s.spiPath}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:text-brand-700 hover:underline"
                        >
                          Open <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        {activeList.length > 0 && (
          <TablePagination
            page={page}
            totalPages={totalPages}
            totalItems={activeList.length}
            pageSize={pageSize}
            pageSizeOptions={PAGE_SIZES}
            onPageChange={setPage}
            onPageSizeChange={(s) => {
              setPageSize(s);
              resetPage();
            }}
            itemLabel={listLabel}
          />
        )}
      </TableShell>
    </div>
  );
}

function InsightsPanel() {
  const { user } = useAuth();
  const isBoa = user?.role === "boa";
  const hideCampus = Boolean(isBoa && user?.campuses?.length === 1);

  const [semester, setSemester] = useState("");
  const [campusFilter, setCampusFilter] = useState(
    hideCampus ? (user?.campuses?.[0] ?? "all") : "all",
  );

  const { data: filterOptions, isLoading: filtersLoading } =
    useGetDashboardFilters(undefined, {
      query: {
        queryKey: getGetDashboardFiltersQueryKey(),
        staleTime: 5 * 60_000,
      },
    });
  const campusOptions = hideCampus
    ? (user?.campuses ?? [])
    : (filterOptions?.campuses ?? []);
  const semesters = useAttendanceSemesters(
    campusFilter !== "all" ? campusFilter : undefined,
  );

  const { data: campusSpi, isLoading: campusSpiLoading, isError: campusSpiError } =
    useQuery({
      queryKey: ["spi-averages", "campus", "insights", semester || "current"],
      queryFn: async () => {
        const params = new URLSearchParams({ group: "campus" });
        if (semester) params.set("semester", semester);
        const res = await fetch(`/api/dashboard/spi-averages?${params}`, {
          credentials: "include",
        });
        if (!res.ok) throw new Error("Failed to load SPI averages");
        return res.json() as Promise<{
          rows: Array<{
            instituteName: string;
            avgSpiPoints: number;
            studentCount: number;
            sectionCount: number;
          }>;
        }>;
      },
      staleTime: 5 * 60_000,
    });

  const { data: subjects, isLoading: subjectsLoading, isError: subjectsError } =
    useQuery({
      queryKey: [
        "insights-subjects",
        campusFilter,
        semester || "current",
      ],
      queryFn: async () => {
        const params = new URLSearchParams();
        if (campusFilter !== "all") params.set("campus", campusFilter);
        if (semester) params.set("semester", semester);
        const res = await fetch(`/api/dashboard/subjects?${params}`, {
          credentials: "include",
        });
        if (!res.ok) throw new Error("Failed to load subjects");
        return res.json() as Promise<Array<{ subjectTitle: string; pct: number }>>;
      },
      staleTime: 5 * 60_000,
    });

  const studentQuery = {
    limit: FETCH_LIMIT,
    campus: campusFilter !== "all" ? campusFilter : undefined,
    semester: semester || undefined,
  };
  const {
    data: students,
    isLoading: studentsLoading,
    isError: studentsError,
  } = useGetDashboardStudents(studentQuery, {
    query: {
      queryKey: getGetDashboardStudentsQueryKey(studentQuery),
      staleTime: 60_000,
    },
  });

  const campusRows = useMemo(() => {
    const rows = campusSpi?.rows ?? [];
    if (campusFilter === "all") return rows;
    return rows.filter(
      (row) => nameKey(row.instituteName) === nameKey(campusFilter),
    );
  }, [campusSpi, campusFilter]);

  const avgSpiPoints = useMemo(() => {
    const values = campusRows
      .map((row) => row.avgSpiPoints)
      .filter((value): value is number => Number.isFinite(value));
    return meanPoints(values);
  }, [campusRows]);

  const studentRows = useMemo(
    () => (students ?? []).map(enrichStudent),
    [students],
  );

  const standingMix = useMemo(() => {
    const total = studentRows.length;
    const good = studentRows.filter((s) => s.standing === "good").length;
    const atRisk = studentRows.filter((s) => s.standing === "at_risk").length;
    return {
      total,
      goodPct: total > 0 ? Math.round((good / total) * 1000) / 10 : null,
      atRiskPct: total > 0 ? Math.round((atRisk / total) * 1000) / 10 : null,
      good,
      atRisk,
    };
  }, [studentRows]);

  const subjectsBelow80 = useMemo(
    () => (subjects ?? []).filter((s) => s.pct < 80).length,
    [subjects],
  );

  const chartData = useMemo(
    () =>
      campusRows
        .slice()
        .sort((a, b) => a.avgSpiPoints - b.avgSpiPoints)
        .map((row) => ({
          fullName: row.instituteName,
          name:
            row.instituteName.length > 18
              ? `${row.instituteName.slice(0, 17)}…`
              : row.instituteName,
          avgSpiPoints: row.avgSpiPoints,
        })),
    [campusRows],
  );

  const needsAttention = useMemo(
    () =>
      studentRows
        .slice()
        .sort((a, b) => a.spiPoints - b.spiPoints)
        .slice(0, 25),
    [studentRows],
  );

  const isLoading = campusSpiLoading || subjectsLoading || studentsLoading;

  const handleExport = () => {
    exportCsv(
      "insights-needs-attention.csv",
      ["Student", "Institute", "SPI Score", "Status"],
      needsAttention.map((s) => [
        s.studentName,
        s.instituteName,
        formatSpi(s.spiPoints),
        standingLabel(s.standing),
      ]),
    );
  };

  return (
    <div className="flex flex-col">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {!hideCampus && (
          <SearchableSelect
            value={campusFilter}
            onValueChange={setCampusFilter}
            options={campusSelectOptions(campusOptions, "All Colleges")}
            placeholder="All Colleges"
            searchPlaceholder="Search colleges…"
            className="w-[220px]"
            disabled={filtersLoading && campusOptions.length === 0}
          />
        )}
        <SearchableSelect
          value={semester || CURRENT_SEMESTER}
          onValueChange={(value) =>
            setSemester(value === CURRENT_SEMESTER ? "" : value)
          }
          options={[
            { value: CURRENT_SEMESTER, label: "Current semester" },
            ...semesters.map((s) => ({ value: s, label: s })),
            ...(semester && !semesters.includes(semester)
              ? [{ value: semester, label: semester }]
              : []),
          ]}
          placeholder="Current semester"
          searchPlaceholder="Search semesters…"
          className="w-[200px]"
          disabled={semesters.length === 0 && !semester}
        />
        <Button
          variant="outline"
          className="h-9 gap-2 border-gray-200"
          onClick={handleExport}
          disabled={needsAttention.length === 0}
        >
          <Download className="h-4 w-4" /> Export
        </Button>
        {isLoading && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
      </div>

      {(campusSpiError || subjectsError || studentsError) && (
        <p className="mb-3 text-sm text-red-600">
          Some Insights metrics failed to load. Try again or narrow the college filter.
        </p>
      )}

      <div className="mb-6 grid grid-cols-1 overflow-hidden rounded-xl border border-slate-200 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Avg SPI"
          value={
            avgSpiPoints !== null ? (
              <span style={{ color: pctTextColor(avgSpiPoints * 10) }}>
                {formatSpi(avgSpiPoints)}
              </span>
            ) : (
              <span className="text-gray-300">—</span>
            )
          }
          footer="Mean of institute averages"
        />
        <KpiCard
          label="% Good"
          value={
            standingMix.goodPct !== null ? `${standingMix.goodPct}%` : (
              <span className="text-gray-300">—</span>
            )
          }
          footer={`${standingMix.good.toLocaleString()} students · SPI ≥ 8`}
        />
        <KpiCard
          label="% At Risk"
          value={
            standingMix.atRiskPct !== null ? (
              <span className="text-red-600">{standingMix.atRiskPct}%</span>
            ) : (
              <span className="text-gray-300">—</span>
            )
          }
          footer={`${standingMix.atRisk.toLocaleString()} students · SPI < 6`}
        />
        <KpiCard
          label="Subjects below 80%"
          value={
            subjects ? (
              <span className={subjectsBelow80 > 0 ? "text-red-600" : undefined}>
                {subjectsBelow80}
              </span>
            ) : (
              <span className="text-gray-300">—</span>
            )
          }
          footer={`${(subjects ?? []).length} subjects in scope`}
        />
      </div>

      <div className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-900">
          Institute-wise avg SPI
        </h2>
        <p className="mb-3 text-xs text-gray-500">
          Lowest scores first · 0–10 scale
        </p>
        {campusSpiLoading ? (
          <Skeleton className="h-[320px] w-full" />
        ) : chartData.length === 0 ? (
          <p className="py-16 text-center text-sm text-gray-500">
            No institute SPI averages for these filters.
          </p>
        ) : (
          <div className="h-[340px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chartData}
                margin={{ top: 8, right: 8, left: -16, bottom: 64 }}
                barCategoryGap="22%"
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                  stroke="#f1f3f5"
                />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 11, fill: "#6b7280" }}
                  tickLine={false}
                  axisLine={{ stroke: "#e5e7eb" }}
                  interval={0}
                  angle={-35}
                  textAnchor="end"
                  height={70}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "#9ca3af" }}
                  tickLine={false}
                  axisLine={false}
                  domain={[0, 10]}
                  ticks={[0, 2, 4, 6, 8, 10]}
                />
                <Tooltip
                  cursor={{ fill: "rgba(0,0,0,0.03)" }}
                  formatter={(value: number) => [formatSpi(value), "Avg SPI"]}
                  labelFormatter={(_, payload) =>
                    payload?.[0]?.payload?.fullName ?? ""
                  }
                />
                <Bar dataKey="avgSpiPoints" radius={[5, 5, 0, 0]} maxBarSize={44}>
                  {chartData.map((row) => (
                    <Cell
                      key={row.fullName}
                      fill={pctTextColor(row.avgSpiPoints * 10)}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <TableShell>
        <div className="border-b border-gray-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-gray-900">Needs attention</h2>
          <p className="text-xs text-gray-500">
            Lowest student SPI scores in scope
            {campusFilter === "all" ? " · capped at 5,000 students" : ""}
          </p>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-gray-200 bg-gray-50 hover:bg-gray-50">
                <Th className="min-w-[200px]">Student</Th>
                <Th className="min-w-[180px]">Institute</Th>
                <Th className="text-right">SPI Score</Th>
                <Th>Status</Th>
                <Th className="text-right">Report</Th>
              </TableRow>
            </TableHeader>
            <TableBody>
              {studentsLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i} className="border-b border-gray-100">
                    <TableCell colSpan={5}>
                      <Skeleton className="h-8 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : needsAttention.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="h-24 text-center text-gray-500"
                  >
                    No student SPI data matches your filters.
                  </TableCell>
                </TableRow>
              ) : (
                needsAttention.map((s) => (
                  <TableRow key={s.studentId} className="border-b border-gray-100">
                    <TableCell className="py-3 font-medium text-gray-900">
                      {s.studentName}
                    </TableCell>
                    <TableCell className="text-gray-600">
                      {s.instituteName || "—"}
                    </TableCell>
                    <TableCell
                      className="text-right font-semibold tabular-nums"
                      style={{ color: pctTextColor(s.spiPoints * 10) }}
                    >
                      {formatSpi(s.spiPoints)}
                    </TableCell>
                    <TableCell>
                      <StandingBadge standing={s.standing} />
                    </TableCell>
                    <TableCell className="text-right">
                      {s.spiPath ? (
                        <a
                          href={s.spiPath}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:text-brand-700 hover:underline"
                        >
                          Open <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </TableShell>
    </div>
  );
}

export default function Reports() {
  const [location] = useLocation();
  const path = location.split("?")[0] ?? location;
  const tab = tabFromPath(path);

  return (
    <div className="space-y-4">
      <PageHeader
        badge="Reports"
        title="Reports"
        subtitle="SPI Record, Skill Debt, and Insights for campuses and sections."
      />
      <SubNav items={reportsNav()} />

      {tab === "spi-record" && <SpiRecordPanel />}
      {tab === "insights" && <InsightsPanel />}
      {tab === "skill-debt" && (
        <div className="rounded-xl border border-slate-200 bg-white px-6 py-16 text-center shadow-sm">
          <p className="text-lg font-semibold text-slate-900">
            {PLACEHOLDER["skill-debt"].title}
          </p>
          <p className="mt-2 text-sm text-slate-500">Coming soon</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate-400">
            {PLACEHOLDER["skill-debt"].description}
          </p>
        </div>
      )}
    </div>
  );
}
