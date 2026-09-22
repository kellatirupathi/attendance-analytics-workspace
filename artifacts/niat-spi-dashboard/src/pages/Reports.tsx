import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  useGetDashboardStudents,
  getGetDashboardStudentsQueryKey,
  useGetDashboardFilters,
  getGetDashboardFiltersQueryKey,
  useGetDashboardSummary,
  getGetDashboardSummaryQueryKey,
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
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  SearchableSelect,
  campusSelectOptions,
  sectionSelectOptions,
} from "@/components/SearchableSelect";
import { useAuth } from "@/contexts/AuthContext";
import { useAttendanceSemesters } from "@/hooks/useAttendanceSemesters";
import { useDebounceValue } from "@/hooks/useDebounceValue";
import { exportCsv } from "@/lib/csv";
import { semesterLabel } from "@/lib/dateRange";
import { cn, pctTextColor } from "@/lib/utils";
import {
  attendanceStanding,
  computeSpiScore,
  standingLabel,
  type AttendanceStanding,
} from "@/lib/spiScore";
import {
  ChevronRight,
  Download,
  ExternalLink,
  Loader2,
  Search,
  SlidersHorizontal,
} from "lucide-react";

type ReportsTab = "spi-record" | "skill-debt" | "insights";
type Drill = "campus" | "section" | "students";

const FETCH_LIMIT = 5000;
const PAGE_SIZES = [25, 50, 100, 200];
const CURRENT_SEMESTER = "current";

const PLACEHOLDER: Record<
  Exclude<ReportsTab, "spi-record">,
  { title: string; description: string }
> = {
  "skill-debt": {
    title: "Skill Debt",
    description: "Students with active Skill Debt will appear here.",
  },
  insights: {
    title: "Insights",
    description: "Trends and highlights across SPI will appear here.",
  },
};

function tabFromPath(path: string): ReportsTab {
  if (path === "/dashboard/reports/skill-debt") return "skill-debt";
  if (path === "/dashboard/reports/insights") return "insights";
  return "spi-record";
}

type StudentRow = DashboardStudent & {
  spiPct: number;
  spiPoints: number;
  standing: AttendanceStanding;
};

type CampusRow = {
  name: string;
  studentCount: number;
  sectionCount: number;
  avgSpiPct: number | null;
  avgSpiPoints: number | null;
};

type SectionRow = {
  name: string;
  studentCount: number;
  avgSpiPct: number | null;
  avgSpiPoints: number | null;
};

function enrichStudent(s: DashboardStudent): StudentRow {
  const { spiPct, points } = computeSpiScore(s.classroomAvg, s.moduleAvg);
  return {
    ...s,
    spiPct,
    spiPoints: points,
    standing: attendanceStanding(s.attendancePct),
  };
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function StandingBadge({ standing }: { standing: AttendanceStanding }) {
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

function Th({
  children,
  className,
}: {
  children: React.ReactNode;
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
    hideCampus ? user!.campuses[0]! : null,
  );
  const [selectedSection, setSelectedSection] = useState<string | null>(null);

  const [semester, setSemester] = useState("");
  const [campusFilter, setCampusFilter] = useState(
    hideCampus ? user!.campuses[0]! : "all",
  );
  const [sectionFilter, setSectionFilter] = useState("all");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounceValue(search, 300);

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [draftSemester, setDraftSemester] = useState(CURRENT_SEMESTER);
  const [draftCampus, setDraftCampus] = useState("all");
  const [draftSection, setDraftSection] = useState("all");
  const [draftSearch, setDraftSearch] = useState("");

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const resetPage = () => setPage(1);

  // Summary endpoint is current-semester roster counts (accurate section/student
  // totals). Semester filter applies when loading campus students for SPI.
  const { data: summary, isLoading: summaryLoading } = useGetDashboardSummary(
    undefined,
    {
      query: {
        queryKey: getGetDashboardSummaryQueryKey(),
        staleTime: 60_000,
      },
    },
  );

  const filterCampusForOptions =
    campusFilter !== "all" ? campusFilter : undefined;
  const { data: filterOptions, isLoading: filtersLoading } =
    useGetDashboardFilters(
      { campus: filterCampusForOptions },
      {
        query: {
          queryKey: getGetDashboardFiltersQueryKey({
            campus: filterCampusForOptions,
          }),
          staleTime: 60_000,
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

  // Students are loaded only for the selected campus (not all institutes).
  // That fixes wrong counts from the global 5k cap and keeps the page fast.
  const campusForStudents =
    selectedCampus ??
    (campusFilter !== "all" ? campusFilter : null);

  const studentQuery = {
    limit: FETCH_LIMIT,
    campus: campusForStudents ?? undefined,
    section:
      drill === "students" && selectedSection
        ? selectedSection
        : sectionFilter !== "all"
          ? sectionFilter
          : undefined,
    semester: semester || undefined,
  };

  const studentsEnabled = Boolean(campusForStudents);
  const { data: students, isLoading: studentsLoading, isFetching } =
    useGetDashboardStudents(studentQuery, {
      query: {
        queryKey: getGetDashboardStudentsQueryKey(studentQuery),
        enabled: studentsEnabled,
        staleTime: 30_000,
        placeholderData: (previousData) => previousData,
      },
    });

  const rows = useMemo(
    () => (students ?? []).map(enrichStudent),
    [students],
  );

  const q = debouncedSearch.trim().toLowerCase();

  const spiByCampus = useMemo(() => {
    const map = new Map<string, number[]>();
    for (const s of rows) {
      const key = s.instituteName || "Unknown campus";
      const list = map.get(key);
      if (list) list.push(s.spiPct);
      else map.set(key, [s.spiPct]);
    }
    const out = new Map<string, number>();
    for (const [key, vals] of map) {
      const m = mean(vals);
      if (m !== null) out.set(key, m);
    }
    return out;
  }, [rows]);

  const spiBySection = useMemo(() => {
    const map = new Map<string, number[]>();
    for (const s of rows) {
      const key = s.sectionName?.trim() || "Unassigned";
      const list = map.get(key);
      if (list) list.push(s.spiPct);
      else map.set(key, [s.spiPct]);
    }
    const out = new Map<string, number>();
    for (const [key, vals] of map) {
      const m = mean(vals);
      if (m !== null) out.set(key, m);
    }
    return out;
  }, [rows]);

  const campuses = useMemo<CampusRow[]>(() => {
    const fromSummary = summary?.campusBreakdown ?? [];
    return fromSummary
      .filter((c) => {
        if (campusFilter !== "all" && c.instituteName !== campusFilter)
          return false;
        if (q && !c.instituteName.toLowerCase().includes(q)) return false;
        return true;
      })
      .map((c) => {
        const avgSpiPct = spiByCampus.get(c.instituteName) ?? null;
        return {
          name: c.instituteName,
          studentCount: c.studentCount,
          sectionCount: c.sectionCount,
          avgSpiPct,
          avgSpiPoints: avgSpiPct !== null ? avgSpiPct / 10 : null,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [summary, campusFilter, q, spiByCampus]);

  const sections = useMemo<SectionRow[]>(() => {
    if (!selectedCampus) return [];
    const fromSummary = (summary?.sectionBreakdown ?? []).filter(
      (s) => s.instituteName === selectedCampus,
    );

    // Prefer summary rows (accurate student counts). Fall back to student
    // grouping if summary has no section breakdown for this campus.
    if (fromSummary.length > 0) {
      return fromSummary
        .filter((s) => {
          const name = s.sectionName || "Unassigned";
          if (sectionFilter !== "all" && name !== sectionFilter) return false;
          if (q && !name.toLowerCase().includes(q)) return false;
          return true;
        })
        .map((s) => {
          const name = s.sectionName || "Unassigned";
          const avgSpiPct = spiBySection.get(name) ?? null;
          return {
            name,
            studentCount: s.studentCount,
            avgSpiPct,
            avgSpiPoints: avgSpiPct !== null ? avgSpiPct / 10 : null,
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
    }

    const bySection = new Map<string, StudentRow[]>();
    for (const s of rows) {
      const key = s.sectionName?.trim() || "Unassigned";
      if (sectionFilter !== "all" && key !== sectionFilter) continue;
      const list = bySection.get(key);
      if (list) list.push(s);
      else bySection.set(key, [s]);
    }
    return Array.from(bySection.entries())
      .map(([name, list]) => {
        const avgSpiPct = mean(list.map((x) => x.spiPct));
        return {
          name,
          studentCount: list.length,
          avgSpiPct,
          avgSpiPoints: avgSpiPct !== null ? avgSpiPct / 10 : null,
        };
      })
      .filter((s) => !q || s.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [
    summary,
    selectedCampus,
    sectionFilter,
    q,
    spiBySection,
    rows,
  ]);

  const sectionStudents = useMemo(() => {
    if (!selectedSection) return [];
    return rows
      .filter(
        (s) => (s.sectionName?.trim() || "Unassigned") === selectedSection,
      )
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
    setCampusFilter(value);
    setSectionFilter("all");
    setSelectedSection(null);
    resetPage();
    if (value === "all") {
      setSelectedCampus(null);
      setDrill("campus");
    } else {
      setSelectedCampus(value);
      setDrill("section");
    }
  };

  const setSection = (value: string) => {
    setSectionFilter(value);
    resetPage();
    if (value === "all") {
      setSelectedSection(null);
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
    (search.trim() ? 1 : 0);

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
    setDrill("campus");
    resetPage();
  };

  const goSections = () => {
    if (!selectedCampus) return;
    setCampusFilter(selectedCampus);
    setSectionFilter("all");
    setSelectedSection(null);
    setDrill("section");
    resetPage();
  };

  const openFilters = () => {
    setDraftSemester(semester || CURRENT_SEMESTER);
    setDraftCampus(campusFilter);
    setDraftSection(sectionFilter);
    setDraftSearch(search);
    setFiltersOpen(true);
  };

  const applyFilters = () => {
    setSemester(draftSemester === CURRENT_SEMESTER ? "" : draftSemester);
    setSearch(draftSearch);
    setFiltersOpen(false);
    resetPage();
    if (draftCampus !== "all" && draftSection !== "all") {
      setCampusFilter(draftCampus);
      setSelectedCampus(draftCampus);
      setSectionFilter(draftSection);
      setSelectedSection(draftSection);
      setDrill("students");
      return;
    }
    if (draftCampus !== "all") {
      setCollege(draftCampus);
      return;
    }
    setCollege("all");
  };

  const clearDraft = () => {
    setDraftSemester(CURRENT_SEMESTER);
    setDraftCampus(hideCampus ? user!.campuses[0]! : "all");
    setDraftSection("all");
    setDraftSearch("");
  };

  const clearAll = () => {
    setSemester("");
    setSearch("");
    setSectionFilter("all");
    if (hideCampus) {
      setCampusFilter(user!.campuses[0]!);
      setSelectedCampus(user!.campuses[0]!);
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
    if (drill === "students") {
      exportCsv(
        "spi-record-students.csv",
        ["Student", "SPI Score", "Status", "SPI Report"],
        sectionStudents.map((s) => [
          s.studentName,
          s.spiPoints.toFixed(1),
          standingLabel(s.standing),
          s.spiPath,
        ]),
      );
      return;
    }
    if (drill === "section") {
      exportCsv(
        "spi-record-sections.csv",
        ["Section", "Avg SPI", "Students"],
        sections.map((s) => [
          s.name,
          s.avgSpiPoints !== null ? s.avgSpiPoints.toFixed(1) : "",
          s.studentCount,
        ]),
      );
      return;
    }
    exportCsv(
      "spi-record-colleges.csv",
      ["Institute", "Avg SPI", "Sections", "Students"],
      campuses.map((c) => [
        c.name,
        c.avgSpiPoints !== null ? c.avgSpiPoints.toFixed(1) : "",
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
    summaryLoading || (studentsEnabled && studentsLoading && drill !== "campus");

  return (
    <div className="flex flex-col">
      {(drill !== "campus" || selectedCampus) && (
        <PageBreadcrumb
          items={[
            {
              label: "All Colleges",
              onClick: hideCampus ? undefined : goInstitutes,
              current: drill === "campus",
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
          className="w-[220px]"
          disabled={semesters.length === 0 && !semester}
        />

        <div className="relative min-w-[200px] flex-1 sm:w-64 sm:flex-none">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            placeholder="Search college, section, or student…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              resetPage();
            }}
            className="h-9 w-full border-gray-200 pl-9"
          />
        </div>

        {!hideCampus && (
          <SearchableSelect
            value={campusFilter}
            onValueChange={setCollege}
            options={campusSelectOptions(campusOptions, "All Colleges")}
            placeholder="All Colleges"
            searchPlaceholder="Search colleges…"
            className="w-[220px]"
            disabled={filtersLoading && campusOptions.length === 0}
          />
        )}

        <SearchableSelect
          value={sectionFilter}
          onValueChange={setSection}
          options={sectionSelectOptions(sectionOptions, "All Sections")}
          placeholder="All Sections"
          searchPlaceholder="Search sections…"
          className="w-[200px]"
          disabled={campusFilter === "all" || filtersLoading}
        />

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

        {isFetching && !studentsLoading && (
          <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
        )}
      </div>

      <TableShell>
        <div className="border-b border-gray-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-gray-900">
            {drill === "campus"
              ? "Colleges"
              : drill === "section"
                ? `Sections · ${selectedCampus}`
                : `Students · ${selectedSection}`}
          </h2>
          <p className="mt-0.5 text-xs text-gray-500">
            {activeList.length.toLocaleString()} {listLabel}
            {" · "}
            {semesterLabel(semester)}
            {" · "}
            Section/student counts from attendance roster
            {" · "}
            SPI = classroom (10%) + module (15%); skill &amp; final = 0 until
            available
          </p>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-gray-200 bg-gray-50 hover:bg-gray-50">
                {drill === "campus" && (
                  <>
                    <Th className="min-w-[220px]">Institute</Th>
                    <Th className="text-right">Avg SPI</Th>
                    <Th className="text-right">Sections</Th>
                    <Th className="text-right">Students</Th>
                    <Th className="w-10" />
                  </>
                )}
                {drill === "section" && (
                  <>
                    <Th className="min-w-[180px]">Section</Th>
                    <Th className="text-right">Avg SPI</Th>
                    <Th className="text-right">Students</Th>
                    <Th className="w-10" />
                  </>
                )}
                {drill === "students" && (
                  <>
                    <Th className="min-w-[200px]">Student</Th>
                    <Th className="text-right">SPI Score</Th>
                    <Th>Status</Th>
                    <Th className="text-right">SPI Report</Th>
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
                        <span style={{ color: pctTextColor(c.avgSpiPct!) }}>
                          {c.avgSpiPoints.toFixed(1)} / 10
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
                        <span style={{ color: pctTextColor(sec.avgSpiPct!) }}>
                          {sec.avgSpiPoints.toFixed(1)} / 10
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
                      style={{ color: pctTextColor(s.spiPct) }}
                    >
                      {s.spiPoints.toFixed(1)} / 10
                    </TableCell>
                    <TableCell>
                      <StandingBadge standing={s.standing} />
                    </TableCell>
                    <TableCell className="text-right">
                      <a
                        href={s.spiPath}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:text-brand-700 hover:underline"
                        onClick={(e) => e.stopPropagation()}
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

      <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
        <SheetContent side="right" className="flex w-full flex-col sm:max-w-sm">
          <SheetHeader>
            <SheetTitle>Filters</SheetTitle>
            <SheetDescription>
              College, semester, section, and search — same controls as the
              filter bar.
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 space-y-5 overflow-y-auto py-6">
            <div className="space-y-1.5">
              <Label>Semester</Label>
              <SearchableSelect
                value={draftSemester}
                onValueChange={setDraftSemester}
                options={[
                  { value: CURRENT_SEMESTER, label: "Current semester" },
                  ...semesters.map((s) => ({ value: s, label: s })),
                ]}
                placeholder="Current semester"
                searchPlaceholder="Search semesters…"
                className="w-full"
              />
            </div>
            {!hideCampus && (
              <div className="space-y-1.5">
                <Label>College</Label>
                <SearchableSelect
                  value={draftCampus}
                  onValueChange={(v) => {
                    setDraftCampus(v);
                    setDraftSection("all");
                  }}
                  options={campusSelectOptions(campusOptions, "All Colleges")}
                  placeholder="All Colleges"
                  searchPlaceholder="Search colleges…"
                  className="w-full"
                  disabled={filtersLoading}
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Section</Label>
              <SearchableSelect
                value={draftSection}
                onValueChange={setDraftSection}
                options={sectionSelectOptions(sectionOptions, "All Sections")}
                placeholder="All Sections"
                searchPlaceholder="Search sections…"
                className="w-full"
                disabled={draftCampus === "all" || filtersLoading}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Student / search</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <Input
                  placeholder="College, section, or student…"
                  value={draftSearch}
                  onChange={(e) => setDraftSearch(e.target.value)}
                  className="h-9 border-gray-200 pl-9"
                />
              </div>
            </div>
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

      {tab === "spi-record" ? (
        <SpiRecordPanel />
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white px-6 py-16 text-center shadow-sm">
          <p className="text-lg font-semibold text-slate-900">
            {PLACEHOLDER[tab].title}
          </p>
          <p className="mt-2 text-sm text-slate-500">Coming soon</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate-400">
            {PLACEHOLDER[tab].description}
          </p>
        </div>
      )}
    </div>
  );
}
