import { useMemo, useState } from "react";
import {
  useGetDashboardSummary,
  getGetDashboardSummaryQueryKey,
  useGetDashboardFilters,
  getGetDashboardFiltersQueryKey,
  useGetDashboardStudents,
  getGetDashboardStudentsQueryKey,
} from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/PageHeader";
import { PageLoader } from "@/components/PageLoader";
import { TableShell, TablePagination } from "@/components/DataTable";
import { Search, Download, SlidersHorizontal, Loader2, ChevronRight, ArrowLeft } from "lucide-react";
import { pctColor, pctTextColor, cn } from "@/lib/utils";
import { useDebounceValue } from "@/hooks/useDebounceValue";
import { exportCsv } from "@/lib/csv";

type Drill = "campus" | "section" | "students";

const PAGE_SIZES = [25, 50, 100, 200];
const ATT_BANDS = [
  { key: "all", label: "All attendance" },
  { key: "below50", label: "Below 50%" },
  { key: "below80", label: "Below 80%" },
  { key: "above80", label: "80% and above" },
];

function matchesBand(pct: number, band: string): boolean {
  switch (band) {
    case "below50":
      return pct < 50;
    case "below80":
      return pct < 80;
    case "above80":
      return pct >= 80;
    default:
      return true;
  }
}

export default function Campuses() {
  const [drill, setDrill] = useState<Drill>("campus");
  const [selectedCampus, setSelectedCampus] = useState<string | null>(null);
  const [selectedSection, setSelectedSection] = useState<string | null>(null);
  const [showAllStudents, setShowAllStudents] = useState(false);

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounceValue(search, 300);

  const [campusFilter, setCampusFilter] = useState("all");
  const [band, setBand] = useState("all");

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [draftCampus, setDraftCampus] = useState("all");
  const [draftBand, setDraftBand] = useState("all");

  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(1);

  const { data: summary, isLoading } = useGetDashboardSummary({
    query: { queryKey: getGetDashboardSummaryQueryKey() },
  });

  const { data: filterOptions, isLoading: filtersLoading } =
    useGetDashboardFilters(undefined, {
      query: {
        queryKey: getGetDashboardFiltersQueryKey(),
        enabled: filtersOpen,
        staleTime: 60_000,
      },
    });

  const campuses = useMemo(() => summary?.campusBreakdown ?? [], [summary]);
  const sections = useMemo(() => summary?.sectionBreakdown ?? [], [summary]);
  const campusOptions = filterOptions?.campuses ?? [];

  const studentQuery = {
    limit: 5000,
    campus: drill === "students" ? selectedCampus ?? undefined : undefined,
    section:
      drill === "students" && selectedSection && !showAllStudents
        ? selectedSection
        : undefined,
    search: debouncedSearch || undefined,
  };

  const { data: students, isLoading: studentsLoading } = useGetDashboardStudents(
    studentQuery,
    {
      query: {
        queryKey: getGetDashboardStudentsQueryKey(studentQuery),
        enabled: drill === "students" && !!selectedCampus,
        staleTime: 30_000,
      },
    },
  );

  const q = debouncedSearch.trim().toLowerCase();

  const filteredCampuses = useMemo(
    () =>
      campuses.filter((c) => {
        if (campusFilter !== "all" && c.instituteName !== campusFilter)
          return false;
        if (!matchesBand(c.pct, band)) return false;
        if (q && !c.instituteName.toLowerCase().includes(q)) return false;
        return true;
      }),
    [campuses, campusFilter, band, q],
  );

  const campusSections = useMemo(
    () =>
      sections.filter((s) => {
        if (selectedCampus && s.instituteName !== selectedCampus) return false;
        if (!matchesBand(s.pct, band)) return false;
        if (
          q &&
          !(s.sectionName ?? "").toLowerCase().includes(q) &&
          !(s.instituteName ?? "").toLowerCase().includes(q)
        )
          return false;
        return true;
      }),
    [sections, selectedCampus, band, q],
  );

  const studentRows = useMemo(() => students ?? [], [students]);

  const resetPage = () => setPage(1);

  const activeFilterCount =
    (campusFilter !== "all" ? 1 : 0) + (band !== "all" ? 1 : 0);

  const openCampus = (name: string) => {
    setSelectedCampus(name);
    setSelectedSection(null);
    setShowAllStudents(false);
    setDrill("section");
    setSearch("");
    resetPage();
  };

  const openSection = (sectionName: string) => {
    setSelectedSection(sectionName);
    setShowAllStudents(false);
    setDrill("students");
    resetPage();
  };

  const backToCampuses = () => {
    setDrill("campus");
    setSelectedCampus(null);
    setSelectedSection(null);
    setShowAllStudents(false);
    resetPage();
  };

  const backToSections = () => {
    setDrill("section");
    setSelectedSection(null);
    resetPage();
  };

  const activeList =
    drill === "campus"
      ? filteredCampuses
      : drill === "section" && !showAllStudents
        ? campusSections
        : studentRows;

  const totalPages = Math.max(1, Math.ceil(activeList.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * pageSize;

  const handleExport = () => {
    if (drill === "campus") {
      exportCsv(
        "campuses.csv",
        ["Campus", "Sections", "Subjects", "Students", "Attendance %"],
        filteredCampuses.map((c) => [
          c.instituteName,
          c.sectionCount,
          c.subjectCount,
          c.studentCount,
          c.pct,
        ]),
      );
    } else if (drill === "section") {
      exportCsv(
        "sections.csv",
        ["Campus", "Section", "Students", "Attendance %"],
        campusSections.map((s) => [
          s.instituteName,
          s.sectionName,
          s.studentCount,
          s.pct,
        ]),
      );
    } else {
      exportCsv(
        "students.csv",
        ["Name", "Student ID", "Section", "Attendance %"],
        studentRows.map((s) => [
          s.studentName,
          s.studentId,
          s.sectionName ?? "",
          s.attendancePct,
        ]),
      );
    }
  };

  if (isLoading) return <PageLoader label="Loading campuses…" />;

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Campus Analytics"
        subtitle="Drill from campus → section → students."
        right={
          <div className="flex flex-wrap items-center gap-2">
            {drill !== "campus" && (
              <Button
                variant="outline"
                className="h-9 gap-2 border-gray-200"
                onClick={drill === "students" ? backToSections : backToCampuses}
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </Button>
            )}
            <div className="relative min-w-[200px] flex-1 sm:w-56 sm:flex-none">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                placeholder={
                  drill === "campus"
                    ? "Search campuses…"
                    : drill === "section"
                      ? "Search sections…"
                      : "Search students…"
                }
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  resetPage();
                }}
                className="h-9 w-full border-gray-200 pl-9"
              />
            </div>

            <Button
              variant="outline"
              className="h-9 gap-2 border-gray-200"
              onClick={() => {
                setDraftCampus(campusFilter);
                setDraftBand(band);
                setFiltersOpen(true);
              }}
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
                onClick={() => {
                  setCampusFilter("all");
                  setBand("all");
                  resetPage();
                }}
                className="h-9 px-2 text-sm font-semibold text-red-600 hover:text-red-700 hover:underline"
              >
                Clear
              </button>
            )}
          </div>
        }
      />

      {drill !== "campus" && selectedCampus && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-gray-600">
          <button
            type="button"
            onClick={backToCampuses}
            className="font-medium text-brand-600 hover:underline"
          >
            All campuses
          </button>
          <ChevronRight className="h-4 w-4 text-gray-300" />
          <span className="font-medium text-gray-900">{selectedCampus}</span>
          {selectedSection && (
            <>
              <ChevronRight className="h-4 w-4 text-gray-300" />
              <span className="font-medium text-gray-900">{selectedSection}</span>
            </>
          )}
        </div>
      )}

      {selectedCampus && drill !== "campus" && (
        <label className="mb-3 flex cursor-pointer items-center gap-2 text-sm text-gray-700">
          <Checkbox
            checked={showAllStudents}
            onCheckedChange={(v) => {
              const on = v === true;
              setShowAllStudents(on);
              if (on) {
                setDrill("students");
                setSelectedSection(null);
              } else {
                setDrill("section");
                setSelectedSection(null);
              }
              resetPage();
            }}
          />
          Show all students in this campus
        </label>
      )}

      <TableShell>
        <div className="border-b border-gray-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-gray-900">
            {drill === "campus"
              ? "Campus breakdown"
              : drill === "section"
                ? `Sections · ${selectedCampus}`
                : showAllStudents
                  ? `All students · ${selectedCampus}`
                  : `Students · ${selectedSection}`}
          </h2>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-gray-200 bg-gray-50 hover:bg-gray-50">
                {drill === "campus" && (
                  <>
                    <Th>Campus</Th>
                    <Th className="text-right">Sections</Th>
                    <Th className="text-right">Subjects</Th>
                    <Th className="text-right">Students</Th>
                    <Th className="w-[220px] text-right">Attendance</Th>
                  </>
                )}
                {drill === "section" && (
                  <>
                    <Th>Section</Th>
                    <Th className="text-right">Students</Th>
                    <Th className="w-[220px] text-right">Attendance</Th>
                  </>
                )}
                {drill === "students" && (
                  <>
                    <Th>Name</Th>
                    <Th>Student ID</Th>
                    <Th>Section</Th>
                    <Th className="text-right">Attendance</Th>
                  </>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {drill === "students" && studentsLoading ? (
                <TableRow>
                  <TableCell colSpan={4} className="h-24 text-center text-gray-500">
                    Loading students…
                  </TableCell>
                </TableRow>
              ) : activeList.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={drill === "campus" ? 5 : drill === "section" ? 3 : 4}
                    className="h-24 text-center text-gray-500"
                  >
                    No data matches your filters.
                  </TableCell>
                </TableRow>
              ) : drill === "campus" ? (
                filteredCampuses.slice(start, start + pageSize).map((c) => (
                  <TableRow
                    key={c.instituteName}
                    className="cursor-pointer border-b border-gray-200 hover:bg-gray-50"
                    onClick={() => openCampus(c.instituteName)}
                  >
                    <TableCell className="py-3 font-medium text-gray-900">
                      {c.instituteName}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-gray-600">
                      {c.sectionCount.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-gray-600">
                      {c.subjectCount.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-gray-600">
                      {c.studentCount.toLocaleString()}
                    </TableCell>
                    <AttendanceCell pct={c.pct} />
                  </TableRow>
                ))
              ) : drill === "section" ? (
                campusSections.slice(start, start + pageSize).map((s) => (
                  <TableRow
                    key={`${s.instituteName}-${s.sectionName}`}
                    className="cursor-pointer border-b border-gray-200 hover:bg-gray-50"
                    onClick={() => openSection(s.sectionName)}
                  >
                    <TableCell className="py-3 font-medium text-gray-900">
                      {s.sectionName}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-gray-600">
                      {s.studentCount.toLocaleString()}
                    </TableCell>
                    <AttendanceCell pct={s.pct} />
                  </TableRow>
                ))
              ) : (
                studentRows.slice(start, start + pageSize).map((s) => (
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
                    <TableCell className="text-gray-600">
                      {s.sectionName ?? "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <span
                        className="font-bold tabular-nums"
                        style={{ color: pctTextColor(s.attendancePct) }}
                      >
                        {s.attendancePct}%
                      </span>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {activeList.length > 0 && (
          <TablePagination
            page={currentPage}
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
                ? "campuses"
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
              Campus options are loaded live from BigQuery for your role scope.
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 space-y-5 overflow-y-auto py-6">
            <div className="space-y-1.5">
              <Label>Campus</Label>
              <Select
                value={draftCampus}
                onValueChange={setDraftCampus}
                disabled={filtersLoading}
              >
                <SelectTrigger className="w-full border-gray-200">
                  <SelectValue placeholder="Campus" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All campuses</SelectItem>
                  {campusOptions.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Attendance</Label>
              <Select value={draftBand} onValueChange={setDraftBand}>
                <SelectTrigger className="w-full border-gray-200">
                  <SelectValue placeholder="Attendance" />
                </SelectTrigger>
                <SelectContent>
                  {ATT_BANDS.map((b) => (
                    <SelectItem key={b.key} value={b.key}>
                      {b.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {filtersLoading && (
              <p className="flex items-center gap-2 text-xs text-gray-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading campuses…
              </p>
            )}
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-gray-200 pt-4">
            <Button variant="ghost" onClick={() => setFiltersOpen(false)}>
              Cancel
            </Button>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setDraftCampus("all");
                  setDraftBand("all");
                }}
              >
                Clear filters
              </Button>
              <Button
                onClick={() => {
                  setCampusFilter(draftCampus);
                  setBand(draftBand);
                  setFiltersOpen(false);
                  resetPage();
                }}
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

function AttendanceCell({ pct }: { pct: number }) {
  return (
    <TableCell className="text-right">
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
    </TableCell>
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
