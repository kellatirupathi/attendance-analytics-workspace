import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
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
import { Label } from "@/components/ui/label";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import { useAttendanceSemesters } from "@/hooks/useAttendanceSemesters";
import { exportCsv } from "@/lib/csv";
import { cn, pctColor, pctTextColor } from "@/lib/utils";
import {
  attendanceStanding,
  computeSpiScore,
  standingLabel,
  type AttendanceStanding,
} from "@/lib/spiScore";
import { Download, Loader2, SlidersHorizontal, Search } from "lucide-react";

type ReportsTab = "spi-record" | "skill-debt" | "insights";
type Drill = "campus" | "section" | "students";

const FETCH_LIMIT = 5000;
const PAGE_SIZES = [25, 50, 100, 200];

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
  avgSpiPct: number;
  avgSpiPoints: number;
};

type SectionRow = {
  name: string;
  studentCount: number;
  avgSpiPct: number;
  avgSpiPoints: number;
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

function mean(values: number[]): number {
  if (values.length === 0) return 0;
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

function SpiBar({ pct }: { pct: number }) {
  const safe = Math.min(100, Math.max(0, pct));
  return (
    <div className="flex items-center justify-end gap-2">
      <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-100 sm:w-32">
        <div
          className="h-full rounded-full"
          style={{ width: `${safe}%`, backgroundColor: pctColor(safe) }}
        />
      </div>
      <span
        className="w-10 text-right text-xs font-semibold tabular-nums"
        style={{ color: pctTextColor(safe) }}
      >
        {safe.toFixed(0)}%
      </span>
    </div>
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
        "text-xs font-semibold uppercase tracking-wide text-slate-500",
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

  const [drill, setDrill] = useState<Drill>("campus");
  const [selectedCampus, setSelectedCampus] = useState<string | null>(null);
  const [selectedSection, setSelectedSection] = useState<string | null>(null);

  const [campusFilter, setCampusFilter] = useState("all");
  const [semesterFilter, setSemesterFilter] = useState("all");
  const [sectionFilter, setSectionFilter] = useState("all");
  const [studentSearch, setStudentSearch] = useState("");

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [draftCampus, setDraftCampus] = useState("all");
  const [draftSemester, setDraftSemester] = useState("all");
  const [draftSection, setDraftSection] = useState("all");
  const [draftStudent, setDraftStudent] = useState("");

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const resetPage = () => setPage(1);

  const filterCampusParam =
    draftCampus !== "all"
      ? draftCampus
      : campusFilter !== "all"
        ? campusFilter
        : undefined;

  const { data: filterOptions, isLoading: filtersLoading } =
    useGetDashboardFilters(
      { campus: filterCampusParam },
      {
        query: {
          queryKey: getGetDashboardFiltersQueryKey({
            campus: filterCampusParam,
          }),
          enabled: filtersOpen || campusFilter !== "all",
          staleTime: 60_000,
        },
      },
    );

  const campusOptions = filterOptions?.campuses ?? [];
  const sectionOptions = filterOptions?.sections ?? [];
  const semesters = useAttendanceSemesters(
    draftCampus !== "all"
      ? draftCampus
      : campusFilter !== "all"
        ? campusFilter
        : undefined,
  );

  const studentQuery = {
    limit: FETCH_LIMIT,
    campus:
      drill !== "campus"
        ? selectedCampus ?? undefined
        : campusFilter !== "all"
          ? campusFilter
          : undefined,
    section:
      drill === "students"
        ? selectedSection ?? undefined
        : sectionFilter !== "all"
          ? sectionFilter
          : undefined,
    semester: semesterFilter !== "all" ? semesterFilter : undefined,
    search: studentSearch.trim() || undefined,
  };

  const { data: students, isLoading, isFetching } = useGetDashboardStudents(
    studentQuery,
    {
      query: {
        queryKey: getGetDashboardStudentsQueryKey(studentQuery),
        staleTime: 30_000,
        placeholderData: (previousData) => previousData,
      },
    },
  );

  const rows = useMemo(
    () => (students ?? []).map(enrichStudent),
    [students],
  );

  const campuses = useMemo<CampusRow[]>(() => {
    const byCampus = new Map<string, StudentRow[]>();
    for (const s of rows) {
      const key = s.instituteName || "Unknown campus";
      if (campusFilter !== "all" && key !== campusFilter) continue;
      const list = byCampus.get(key);
      if (list) list.push(s);
      else byCampus.set(key, [s]);
    }
    return Array.from(byCampus.entries())
      .map(([name, list]) => {
        const sections = new Set(
          list.map((x) => x.sectionName?.trim() || "Unassigned"),
        );
        const avgSpiPct = mean(list.map((x) => x.spiPct));
        return {
          name,
          studentCount: list.length,
          sectionCount: sections.size,
          avgSpiPct,
          avgSpiPoints: avgSpiPct / 10,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [rows, campusFilter]);

  const campusStudents = useMemo(() => {
    if (!selectedCampus) return [];
    return rows.filter(
      (s) => (s.instituteName || "Unknown campus") === selectedCampus,
    );
  }, [rows, selectedCampus]);

  const sections = useMemo<SectionRow[]>(() => {
    const bySection = new Map<string, StudentRow[]>();
    for (const s of campusStudents) {
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
          avgSpiPoints: avgSpiPct / 10,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [campusStudents, sectionFilter]);

  const sectionStudents = useMemo(() => {
    if (!selectedSection) return [];
    const q = studentSearch.trim().toLowerCase();
    return campusStudents
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
  }, [campusStudents, selectedSection, studentSearch]);

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

  const activeFilterCount =
    (campusFilter !== "all" ? 1 : 0) +
    (semesterFilter !== "all" ? 1 : 0) +
    (sectionFilter !== "all" ? 1 : 0) +
    (studentSearch.trim() ? 1 : 0);

  const openFilters = () => {
    setDraftCampus(campusFilter);
    setDraftSemester(semesterFilter);
    setDraftSection(sectionFilter);
    setDraftStudent(studentSearch);
    setFiltersOpen(true);
  };

  const applyFilters = () => {
    setCampusFilter(draftCampus);
    setSemesterFilter(draftSemester);
    setSectionFilter(draftSection);
    setStudentSearch(draftStudent.trim());
    setFiltersOpen(false);
    resetPage();

    // Jump drill when filters already pick a concrete section/campus.
    if (draftCampus !== "all" && draftSection !== "all") {
      setSelectedCampus(draftCampus);
      setSelectedSection(draftSection);
      setDrill("students");
    } else if (draftCampus !== "all") {
      setSelectedCampus(draftCampus);
      setSelectedSection(null);
      setDrill("section");
    } else {
      setSelectedCampus(null);
      setSelectedSection(null);
      setDrill("campus");
    }
  };

  const clearDraft = () => {
    setDraftCampus(isBoa && user?.campuses?.length === 1 ? user.campuses[0]! : "all");
    setDraftSemester("all");
    setDraftSection("all");
    setDraftStudent("");
  };

  const clearAll = () => {
    setCampusFilter("all");
    setSemesterFilter("all");
    setSectionFilter("all");
    setStudentSearch("");
    setSelectedCampus(null);
    setSelectedSection(null);
    setDrill("campus");
    resetPage();
  };

  const openCampus = (name: string) => {
    setSelectedCampus(name);
    setSelectedSection(null);
    setDrill("section");
    resetPage();
  };

  const openSection = (name: string) => {
    setSelectedSection(name);
    setDrill("students");
    resetPage();
  };

  const handleExport = () => {
    if (drill === "students" && sectionStudents.length > 0) {
      exportCsv(
        `spi-record-${selectedCampus}-${selectedSection}.csv`,
        ["Name", "Student ID", "SPI Score", "SPI %", "Status", "Attendance %"],
        sectionStudents.map((s) => [
          s.studentName,
          s.studentId,
          s.spiPoints.toFixed(1),
          s.spiPct.toFixed(1),
          standingLabel(s.standing),
          s.attendancePct,
        ]),
      );
      return;
    }
    if (drill === "section" && sections.length > 0) {
      exportCsv(
        `spi-record-${selectedCampus}-sections.csv`,
        ["Section", "Students", "Avg SPI Score", "Avg SPI %"],
        sections.map((s) => [
          s.name,
          s.studentCount,
          s.avgSpiPoints.toFixed(1),
          s.avgSpiPct.toFixed(1),
        ]),
      );
      return;
    }
    if (drill === "campus" && campuses.length > 0) {
      exportCsv(
        "spi-record-campuses.csv",
        ["Institute", "Sections", "Students", "Avg SPI Score", "Avg SPI %"],
        campuses.map((c) => [
          c.name,
          c.sectionCount,
          c.studentCount,
          c.avgSpiPoints.toFixed(1),
          c.avgSpiPct.toFixed(1),
        ]),
      );
    }
  };

  const tableTitle =
    drill === "campus"
      ? "Institutes"
      : drill === "section"
        ? `Sections · ${selectedCampus}`
        : `Students · ${selectedSection}`;

  return (
    <div className="space-y-3">
      <PageBreadcrumb
        items={[
          {
            label: "Institutes",
            onClick: () => {
              setDrill("campus");
              setSelectedCampus(null);
              setSelectedSection(null);
              resetPage();
            },
            current: drill === "campus",
          },
          ...(selectedCampus
            ? [
                {
                  label: selectedCampus,
                  onClick: () => {
                    setDrill("section");
                    setSelectedSection(null);
                    resetPage();
                  },
                  current: drill === "section",
                },
              ]
            : []),
          ...(selectedSection
            ? [{ label: selectedSection, current: true as const }]
            : []),
        ]}
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-500">
          SPI from classroom (10%) + module (15%); skill &amp; final not in
          feed yet (count as 0).
          {semesterFilter !== "all" && (
            <span className="ml-1 font-medium text-slate-700">
              · {semesterFilter}
            </span>
          )}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {isFetching && (
            <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
          )}
          <Button
            variant="outline"
            className="h-9 gap-2 border-slate-200"
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
            className="h-9 gap-2 border-slate-200"
            onClick={handleExport}
            disabled={activeList.length === 0}
          >
            <Download className="h-4 w-4" /> Export to Sheet
          </Button>
          {activeFilterCount > 0 && (
            <button
              type="button"
              onClick={clearAll}
              className="h-9 px-2 text-sm font-semibold text-red-600 hover:underline"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      <TableShell>
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">
            {tableTitle}
            <span className="ml-2 font-normal text-slate-500">
              · {activeList.length.toLocaleString()}
              {drill === "campus"
                ? " institutes"
                : drill === "section"
                  ? " sections"
                  : " students"}
            </span>
          </h2>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-slate-200 bg-slate-50 hover:bg-slate-50">
                {drill === "campus" && (
                  <>
                    <Th>Institute name</Th>
                    <Th className="text-right">Avg SPI</Th>
                    <Th className="w-[200px] text-right">Score</Th>
                    <Th className="text-right">Sections</Th>
                    <Th className="text-right">Students</Th>
                  </>
                )}
                {drill === "section" && (
                  <>
                    <Th>Section name</Th>
                    <Th className="text-right">Avg SPI</Th>
                    <Th className="w-[200px] text-right">Score</Th>
                    <Th className="text-right">Students</Th>
                  </>
                )}
                {drill === "students" && (
                  <>
                    <Th>Name</Th>
                    <Th>Student ID</Th>
                    <Th className="text-right">SPI Score</Th>
                    <Th>Status</Th>
                  </>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="h-24 text-center text-slate-500"
                  >
                    Loading…
                  </TableCell>
                </TableRow>
              ) : pageRows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="h-24 text-center text-slate-500"
                  >
                    No data matches your filters.
                  </TableCell>
                </TableRow>
              ) : drill === "campus" ? (
                (pageRows as CampusRow[]).map((c) => (
                  <TableRow
                    key={c.name}
                    className="cursor-pointer border-b border-slate-100 hover:bg-slate-50"
                    onClick={() => openCampus(c.name)}
                  >
                    <TableCell className="py-3 font-medium text-slate-900">
                      {c.name}
                    </TableCell>
                    <TableCell
                      className="text-right font-semibold tabular-nums"
                      style={{ color: pctTextColor(c.avgSpiPct) }}
                    >
                      {c.avgSpiPoints.toFixed(1)} / 10
                    </TableCell>
                    <TableCell>
                      <SpiBar pct={c.avgSpiPct} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-slate-600">
                      {c.sectionCount.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-slate-600">
                      {c.studentCount.toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))
              ) : drill === "section" ? (
                (pageRows as SectionRow[]).map((sec) => (
                  <TableRow
                    key={sec.name}
                    className="cursor-pointer border-b border-slate-100 hover:bg-slate-50"
                    onClick={() => openSection(sec.name)}
                  >
                    <TableCell className="py-3 font-medium text-slate-900">
                      {sec.name}
                    </TableCell>
                    <TableCell
                      className="text-right font-semibold tabular-nums"
                      style={{ color: pctTextColor(sec.avgSpiPct) }}
                    >
                      {sec.avgSpiPoints.toFixed(1)} / 10
                    </TableCell>
                    <TableCell>
                      <SpiBar pct={sec.avgSpiPct} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-slate-600">
                      {sec.studentCount.toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                (pageRows as StudentRow[]).map((s) => (
                  <TableRow
                    key={s.studentId}
                    className="border-b border-slate-100"
                  >
                    <TableCell className="py-3 font-medium text-slate-900">
                      {s.studentName}
                    </TableCell>
                    <TableCell className="tabular-nums text-slate-500">
                      {s.studentId}
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
            itemLabel={
              drill === "campus"
                ? "institutes"
                : drill === "section"
                  ? "sections"
                  : "students"
            }
          />
        )}
      </TableShell>

      <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
        <SheetContent side="right" className="flex w-full flex-col sm:max-w-sm">
          <SheetHeader>
            <SheetTitle>Filters</SheetTitle>
            <SheetDescription>
              Filter by college, semester, section, or student — same pattern as
              Data Explorer / Student Directory.
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 space-y-5 overflow-y-auto py-6">
            {!isBoa && (
              <div className="space-y-1.5">
                <Label>College</Label>
                <SearchableSelect
                  value={draftCampus}
                  onValueChange={(v) => {
                    setDraftCampus(v);
                    setDraftSection("all");
                  }}
                  options={campusSelectOptions(campusOptions)}
                  placeholder="All colleges"
                  searchPlaceholder="Search colleges…"
                  disabled={filtersLoading}
                  className="w-full"
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Semester</Label>
              <Select
                value={draftSemester}
                onValueChange={setDraftSemester}
              >
                <SelectTrigger className="w-full border-gray-200">
                  <SelectValue placeholder="All semesters" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Current / all</SelectItem>
                  {semesters.map((sem) => (
                    <SelectItem key={sem} value={sem}>
                      {sem}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Section</Label>
              <SearchableSelect
                value={draftSection}
                onValueChange={setDraftSection}
                options={sectionSelectOptions(sectionOptions)}
                placeholder="All sections"
                searchPlaceholder="Search sections…"
                disabled={filtersLoading}
                className="w-full"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Student</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <Input
                  placeholder="Name or student ID…"
                  value={draftStudent}
                  onChange={(e) => setDraftStudent(e.target.value)}
                  className="h-9 border-gray-200 pl-9"
                />
              </div>
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
