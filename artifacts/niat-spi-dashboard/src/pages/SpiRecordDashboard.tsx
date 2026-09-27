import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  useGetDashboardFilters,
  getGetDashboardFiltersQueryKey,
} from "@workspace/api-client-react";
import { PageHeader } from "@/components/PageHeader";
import { ErrorState } from "@/components/PageStates";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  SpiRecordFilterBar,
  SpiRecordFiltersButton,
  DEFAULT_FILTERS,
  type AttendanceRange,
  type BoundOp,
  type FilterId,
  type Grain,
  type SectionChoice,
  type StudentChoice,
} from "@/components/SpiRecordFilterBar";
import { useAuth } from "@/contexts/AuthContext";
import { useAttendanceSemesters } from "@/hooks/useAttendanceSemesters";
import { useQueryParams } from "@/hooks/useQueryParams";
import { exportCsv } from "@/lib/csv";
import { omitExcludedInstitutes } from "@/lib/excludedInstitutes";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { ColumnOrderList, moveListItem } from "@/components/ColumnOrderList";

type ColumnId =
  | "students"
  | "avgSpi"
  | "skillLevel"
  | "levelAPlus"
  | "levelA"
  | "levelB"
  | "levelC"
  | "levelD"
  | "skillDebt"
  | "classroomPoints"
  | "modulePoints"
  | "sections"
  | "attendancePct";

const COLUMN_GROUPS: { title: string; ids: ColumnId[] }[] = [
  { title: "SPI score", ids: ["students", "avgSpi", "skillLevel", "classroomPoints", "modulePoints"] },
  { title: "Attendance", ids: ["attendancePct"] },
  { title: "Skill level §3.2", ids: ["levelAPlus", "levelA", "levelB", "levelC", "levelD", "skillDebt"] },
  { title: "Other", ids: ["sections"] },
];

const DEFAULT_COLUMNS: ColumnId[] = [
  "students",
  "avgSpi",
  "skillLevel",
  "levelAPlus",
  "levelA",
  "levelB",
  "levelC",
  "levelD",
  "skillDebt",
  "attendancePct",
];

const ALL_SPI_COLUMNS: ColumnId[] = COLUMN_GROUPS.flatMap((group) => group.ids);

const COLUMN_LABEL: Record<ColumnId, string> = {
  students: "Students",
  avgSpi: "SPI points",
  skillLevel: "Skill level",
  levelAPlus: "A+",
  levelA: "A",
  levelB: "B",
  levelC: "C",
  levelD: "D",
  skillDebt: "Skill Debt",
  classroomPoints: "Classroom points",
  modulePoints: "Module points",
  sections: "Sections",
  attendancePct: "Attendance %",
};

interface RecordRow {
  university: string | null;
  semester: string | null;
  section: string | null;
  studentId: string | null;
  studentName: string | null;
  students: number;
  avgSpi: number | null;
  sections: number;
  skillLevel: string | null;
  levelAPlus: number;
  levelA: number;
  levelB: number;
  levelC: number;
  levelD: number;
  skillDebt: number;
  classroomPoints: number | null;
  modulePoints: number | null;
  attendancePct: number | null;
  spiPath: string | null;
}

interface RecordPayload {
  summary: {
    students: number;
    campuses: number;
    avgSpi: number | null;
    levelAPlus: number;
    levelA: number;
    levelB: number;
    levelC: number;
    levelD: number;
    skillDebt: number;
    attendancePct: number | null;
  };
  rows: RecordRow[];
}

function levelTone(level: string): string {
  if (level === "A+" || level === "A") return "text-emerald-700";
  if (level === "B") return "text-lime-700";
  if (level === "C") return "text-amber-700";
  if (level === "D") return "text-orange-700";
  return "text-red-700";
}

function fmt(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-IN");
}

export default function SpiRecordDashboard() {
  const { user } = useAuth();
  const isBoa = user?.role === "boa";
  const [, setLocation] = useLocation();
  const query = useQueryParams();
  const grain = (query.get("group") as Grain) || "campus";
  const campuses = splitList(query.get("campuses")).length
    ? splitList(query.get("campuses"))
    : isBoa && user?.campuses?.length === 1
      ? [user.campuses[0]!]
      : [];
  const semesters = splitList(query.get("semesters"));
  const sections = splitList(query.get("sections")).map(parseSection).filter((item) => item.campus && item.section);
  const students = splitList(query.get("students")).map(parseStudent).filter((item) => item.studentId);
  const shown = (splitList(query.get("bar")) as FilterId[]).filter((id) => id in { group: 1, campus: 1, semester: 1, section: 1, student: 1, spi: 1, attendance: 1 });
  const activeFilters = withRequiredFilters(shown);
  const spiOp = (query.get("spiOp") || "") as BoundOp;
  const spiA = query.get("spiA") || "";
  const spiB = query.get("spiB") || "";
  const attendanceOp = (query.get("attOp") || "") as BoundOp;
  const attendanceA = query.get("attA") || "";
  const attendanceB = query.get("attB") || "";
  const attendanceRange = (query.get("attRange") || "semester_to_date") as AttendanceRange;
  const attendanceFrom = query.get("attFrom") || "";
  const attendanceTo = query.get("attTo") || "";

  const [columns, setColumns] = useState<ColumnId[]>(DEFAULT_COLUMNS);
  const [draft, setDraft] = useState<ColumnId[]>(DEFAULT_COLUMNS);
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [exporting, setExporting] = useState(false);

  const { data: filterOptions } = useGetDashboardFilters(undefined, {
    query: { queryKey: getGetDashboardFiltersQueryKey(), staleTime: 5 * 60_000 },
  });
  const campusOptions = useMemo(() => {
    if (isBoa && user?.campuses?.length === 1) return omitExcludedInstitutes(user.campuses);
    return omitExcludedInstitutes(filterOptions?.campuses ?? []);
  }, [filterOptions, isBoa, user?.campuses]);
  const semesterOptions = useAttendanceSemesters(campuses.length === 1 ? campuses[0] : undefined, { currentOnly: true });

  const params = new URLSearchParams({ group: grain, attRange: attendanceRange });
  if (campuses.length) params.set("campuses", campuses.join("||"));
  if (semesters.length) params.set("semesters", semesters.join("||"));
  if (sections.length) params.set("sections", sections.map((item) => `${item.campus}\t${item.section}`).join("||"));
  if (students.length) params.set("students", students.map((item) => item.studentId).join("||"));
  if (activeFilters.includes("spi") && spiOp && spiA) {
    params.set("spiOp", spiOp);
    params.set("spiA", spiA);
    if (spiOp === "between" && spiB) params.set("spiB", spiB);
  }
  if (activeFilters.includes("attendance") && attendanceOp && attendanceA) {
    params.set("attOp", attendanceOp);
    params.set("attA", attendanceA);
    if (attendanceOp === "between" && attendanceB) params.set("attB", attendanceB);
  }
  if (attendanceRange === "custom" && attendanceFrom && attendanceTo) {
    params.set("attFrom", attendanceFrom);
    params.set("attTo", attendanceTo);
  }

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["spi-record", params.toString()],
    queryFn: async () => {
      const res = await fetch(`/api/dashboard/spi-record?${params.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load SPI record");
      return res.json() as Promise<RecordPayload>;
    },
    staleTime: 5 * 60_000,
  });

  const writeQuery = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(query);
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setPage(1);
    const qs = next.toString();
    setLocation(qs ? `/dashboard/spi-record?${qs}` : "/dashboard/spi-record");
  };

  useEffect(() => {
    if (!semesterOptions.length || !semesters.length) return;
    const kept = semesters.filter((name) => semesterOptions.includes(name));
    if (kept.length === semesters.length) return;
    writeQuery({ semesters: kept.join("||") || undefined });
  }, [semesterOptions, semesters.join("||")]);

  const rows = data?.rows ?? [];
  const viewRows = rows;
  const pageRows = viewRows.slice((page - 1) * pageSize, page * pageSize);
  const summary = data?.summary;
  const total = summary?.students ?? 0;
  const split = (count: number) => (total > 0 ? Math.round((count / total) * 100) : 0);
  const levelColumns: ColumnId[] = ["levelAPlus", "levelA", "levelB", "levelC", "levelD"];
  const visible = columns.filter((id) => {
    if (grain === "student" && (id === "sections" || levelColumns.includes(id))) return false;
    if (grain !== "student" && id === "skillLevel") return false;
    return true;
  });

  const identityHeaders =
    grain === "all"
      ? ["Scope"]
      : grain === "semester"
        ? ["Campus", "Semester"]
        : grain === "section"
          ? ["Campus", "Section"]
          : grain === "student"
            ? ["Campus", "Semester", "Section", "Name", "Student ID"]
            : ["Campus"];

  const identityCells = (row: RecordRow): string[] => {
    if (grain === "semester") return [row.university || "—", row.semester || "—"];
    if (grain === "section") return [row.university || "—", row.section || "—"];
    if (grain === "student") {
      return [row.university || "—", row.semester || "—", row.section || "—", row.studentName || "—", row.studentId || "—"];
    }
    if (grain === "all") return ["All campuses"];
    return [row.university || "—"];
  };

  const cell = (row: RecordRow, id: ColumnId): string => {
    if (id === "attendancePct") return row.attendancePct == null ? "—" : `${row.attendancePct.toFixed(1)}%`;
    if (id === "avgSpi" || id === "classroomPoints" || id === "modulePoints") {
      const value = row[id];
      return value == null ? "—" : value.toFixed(1);
    }
    if (id === "skillLevel") return row.skillLevel || "—";
    if (id === "skillDebt" && grain === "student") return row.skillDebt > 0 ? "Yes" : "No";
    return fmt(row[id]);
  };

  const exportRows = (source: RecordRow[], filename: string) => {
    exportCsv(
      filename,
      [...identityHeaders, ...visible.map((id) => COLUMN_LABEL[id])],
      source.map((row) => [...identityCells(row), ...visible.map((id) => cell(row, id))]),
    );
  };

  const exportAll = async () => {
    setExporting(true);
    try {
      const all = new URLSearchParams({ group: grain, attRange: attendanceRange });
      if (semesters.length) all.set("semesters", semesters.join("||"));
      if (attendanceRange === "custom" && attendanceFrom && attendanceTo) {
        all.set("attFrom", attendanceFrom);
        all.set("attTo", attendanceTo);
      }
      const res = await fetch(`/api/dashboard/spi-record?${all.toString()}`, { credentials: "include" });
      if (!res.ok) return;
      const body = (await res.json()) as RecordPayload;
      exportRows(body.rows, "spi-record-this-grain.csv");
    } finally {
      setExporting(false);
    }
  };

  const scopeBits = [
    campuses.length ? campuses.join(", ") : "All campuses",
    semesters.length ? semesters.join(", ") : "Current semesters",
    sections.length ? sections.map((item) => item.section).join(", ") : "",
  ].filter(Boolean);
  const scopeLabel = scopeBits.join(" · ");

  const toolbar = (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <SpiRecordFiltersButton
        shown={activeFilters}
        onShown={(next) => {
          const patch: Record<string, string | undefined> = { bar: next.join("||") };
          if (!next.includes("campus")) patch.campuses = undefined;
          if (!next.includes("semester")) patch.semesters = undefined;
          if (!next.includes("section")) patch.sections = undefined;
          if (!next.includes("student")) patch.students = undefined;
          if (!next.includes("spi")) {
            patch.spiOp = undefined;
            patch.spiA = undefined;
            patch.spiB = undefined;
          }
          if (!next.includes("attendance")) {
            patch.attOp = undefined;
            patch.attA = undefined;
            patch.attB = undefined;
            patch.attRange = undefined;
            patch.attFrom = undefined;
            patch.attTo = undefined;
          }
          writeQuery(patch);
        }}
      />
      <Popover open={open} onOpenChange={(next) => { setOpen(next); if (next) setDraft(columns); }}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm">Columns</Button>
        </PopoverTrigger>
        <PopoverContent className="w-72" align="end">
          <p className="mb-2 text-xs text-gray-500">Drag to set the column order. {columns.length} of {Object.keys(COLUMN_LABEL).length} selected.</p>
          <ColumnOrderList
            ids={[...draft, ...ALL_SPI_COLUMNS.filter((id) => !draft.includes(id))]}
            label={(id) => COLUMN_LABEL[id]}
            checked={(id) => draft.includes(id)}
            onToggle={(id) =>
              setDraft((current) =>
                current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
              )
            }
            onReorder={(from, to) => {
              const order = [...draft, ...ALL_SPI_COLUMNS.filter((id) => !draft.includes(id))];
              const next = moveListItem(order, from, to);
              setDraft(next.filter((id) => draft.includes(id)));
            }}
          />
          <Button
            size="sm"
            className="mt-1 w-full"
            onClick={() => {
              setColumns(draft);
              setOpen(false);
            }}
          >
            Apply
          </Button>
        </PopoverContent>
      </Popover>
      <Button variant="outline" size="sm" disabled={!viewRows.length} onClick={() => exportRows(viewRows, "spi-record-this-view.csv")}>
        <Download className="mr-1 h-4 w-4" /> Export
      </Button>
      <Button size="sm" disabled={exporting} onClick={() => void exportAll()}>
        <Download className="mr-1 h-4 w-4" /> Export everything at this grain
      </Button>
    </div>
  );

  return (
    <div className="flex min-w-0 flex-col">
      <PageHeader title="SPI Record Dashboard" right={toolbar} />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Tile label="Students evaluated" value={isLoading ? null : fmt(summary?.students ?? 0)} hint={scopeLabel} />
        <Tile
          label="Average SPI points"
          value={isLoading ? null : summary?.avgSpi == null ? "—" : summary.avgSpi.toFixed(1)}
          hint="0–10. Classroom 10% and module 15%. Missing quizzes count as 0."
        />
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Skill level split</div>
          {isLoading || !summary ? (
            <Skeleton className="mt-3 h-8 w-full" />
          ) : (
            <>
              <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-gray-100">
                <span className="bg-emerald-700" style={{ width: `${split(summary.levelAPlus)}%` }} />
                <span className="bg-emerald-500" style={{ width: `${split(summary.levelA)}%` }} />
                <span className="bg-lime-500" style={{ width: `${split(summary.levelB)}%` }} />
                <span className="bg-amber-400" style={{ width: `${split(summary.levelC)}%` }} />
                <span className="bg-orange-500" style={{ width: `${split(summary.levelD)}%` }} />
                <span className="bg-red-600" style={{ width: `${split(summary.skillDebt)}%` }} />
              </div>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-gray-600">
                <span>A+ {split(summary.levelAPlus)}%</span>
                <span>A {split(summary.levelA)}%</span>
                <span>B {split(summary.levelB)}%</span>
                <span>C {split(summary.levelC)}%</span>
                <span>D {split(summary.levelD)}%</span>
                <span>Skill Debt {split(summary.skillDebt)}%</span>
              </div>
            </>
          )}
        </div>
        <Tile
          label="Attendance %"
          value={isLoading ? null : summary?.attendancePct == null ? "—" : `${summary.attendancePct.toFixed(1)}%`}
          hint="Calendar attendance date range. Separate from the semester skill cycle."
        />
        <Tile
          label="Skill Debt"
          value={isLoading ? null : fmt(summary?.skillDebt ?? 0)}
          hint="Below 50% on a quiz the student has, or no classroom and no module quiz."
          tone="rose"
        />
      </div>

      <div className="mb-4">
        <SpiRecordFilterBar
          shown={activeFilters}
          grain={grain}
          onGrain={(value) => writeQuery({ group: value === "campus" ? undefined : value })}
          campuses={campuses}
          campusOptions={campusOptions}
          onCampuses={(next) => {
            const keptSections = next.length ? sections.filter((item) => next.includes(item.campus)) : [];
            const keptStudents = next.length ? students.filter((item) => next.includes(item.campus)) : [];
            writeQuery({
              campuses: next.join("||") || undefined,
              sections: encodeSections(keptSections),
              students: encodeStudents(keptStudents),
            });
          }}
          semesters={semesters}
          semesterOptions={semesterOptions}
          onSemesters={(next) => writeQuery({ semesters: next.join("||") || undefined })}
          sections={sections}
          onSections={(next) => {
            const keptStudents = next.length
              ? students.filter((item) => next.some((section) => section.campus === item.campus && section.section === item.section))
              : [];
            writeQuery({ sections: encodeSections(next), students: encodeStudents(keptStudents) });
          }}
          students={students}
          onStudents={(next) => writeQuery({ students: encodeStudents(next) })}
          spiOp={spiOp}
          spiA={spiA}
          spiB={spiB}
          onSpi={(op, a, b) => writeQuery({ spiOp: op || undefined, spiA: a || undefined, spiB: b || undefined })}
          attendanceOp={attendanceOp}
          attendanceA={attendanceA}
          attendanceB={attendanceB}
          attendanceRange={attendanceRange}
          attendanceFrom={attendanceFrom}
          attendanceTo={attendanceTo}
          onAttendance={(patch) => {
            const next: Record<string, string | undefined> = {};
            if (patch.op !== undefined) next.attOp = patch.op || undefined;
            if (patch.a !== undefined) next.attA = patch.a || undefined;
            if (patch.b !== undefined) next.attB = patch.b || undefined;
            if (patch.range !== undefined) next.attRange = patch.range;
            if (patch.from !== undefined) next.attFrom = patch.from || undefined;
            if (patch.to !== undefined) next.attTo = patch.to || undefined;
            writeQuery(next);
          }}
          onClear={() =>
            writeQuery({
              campuses: undefined,
              semesters: undefined,
              sections: undefined,
              students: undefined,
              spiOp: undefined,
              spiA: undefined,
              spiB: undefined,
              attOp: undefined,
              attA: undefined,
              attB: undefined,
              attRange: undefined,
              attFrom: undefined,
              attTo: undefined,
            })
          }
        />
      </div>

      {isError ? (
        <ErrorState message="Failed to load the SPI record." onRetry={() => void refetch()} />
      ) : (
        <TableShell className="min-w-0">
          <Table className="w-max min-w-full">
            <TableHeader>
              <TableRow>
                {identityHeaders.map((header) => (
                  <TableHead key={header} className={cn("whitespace-nowrap text-left", header === "Name" && "min-w-[12rem]")}>{header}</TableHead>
                ))}
                {visible.map((id) => (
                  <TableHead key={id} className="text-right">{COLUMN_LABEL[id]}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading
                ? Array.from({ length: 6 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={8}><Skeleton className="h-5 w-full" /></TableCell>
                    </TableRow>
                  ))
                : pageRows.map((row, index) => (
                    <TableRow key={`${row.university ?? ""}-${row.semester ?? ""}-${row.section ?? ""}-${row.studentId ?? index}`}>
                      {identityCells(row).map((value, cellIndex) => (
                        <TableCell key={`${cellIndex}-${value}`} className={cn("whitespace-nowrap font-medium", grain === "student" && cellIndex === 3 && "min-w-[12rem]")}>
                          {grain === "student" && cellIndex === 3 && row.spiPath ? (
                            <a className="text-brand-700 hover:underline" href={row.spiPath}>{value}</a>
                          ) : (
                            value
                          )}
                        </TableCell>
                      ))}
                      {visible.map((id) => (
                        <TableCell key={id} className="text-right tabular-nums">
                          {id === "skillLevel" ? (
                            <span className={cn("text-xs font-bold", levelTone(row.skillLevel ?? ""))}>{cell(row, id)}</span>
                          ) : (
                            cell(row, id)
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
            </TableBody>
          </Table>
          <TablePagination
            page={page}
            totalPages={Math.max(1, Math.ceil(rows.length / pageSize))}
            totalItems={rows.length}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
            itemLabel="rows"
          />
        </TableShell>
      )}
    </div>
  );
}

function withRequiredFilters(ids: FilterId[]): FilterId[] {
  const next = ids.length ? [...ids] : [...DEFAULT_FILTERS];
  if (!next.includes("group")) next.unshift("group");
  if (!next.includes("student")) next.splice(Math.max(next.indexOf("section") + 1, 1), 0, "student");
  return next;
}

function splitList(value: string | null): string[] {
  return value ? value.split("||").map((item) => item.trim()).filter(Boolean) : [];
}

function parseSection(value: string): SectionChoice {
  const [campus, section] = value.split("\t");
  return { campus: campus ?? "", section: section ?? "" };
}

function parseStudent(value: string): StudentChoice {
  const [studentId, campus, section, studentName] = value.split("\t");
  return { studentId: studentId ?? "", campus: campus ?? "", section: section ?? "", studentName: studentName || studentId || "" };
}

function encodeSections(items: SectionChoice[]): string | undefined {
  return items.length ? items.map((item) => `${item.campus}\t${item.section}`).join("||") : undefined;
}

function encodeStudents(items: StudentChoice[]): string | undefined {
  return items.length ? items.map((item) => [item.studentId, item.campus, item.section, item.studentName].join("\t")).join("||") : undefined;
}

function Tile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string | null;
  hint: string;
  tone?: "rose";
}) {
  return (
    <div className={cn("rounded-lg border p-4", tone === "rose" ? "border-rose-200 bg-rose-50" : "border-gray-200 bg-white")}>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{label}</div>
      {value == null ? <Skeleton className="mt-2 h-8 w-24" /> : <div className="mt-1 text-2xl font-semibold text-gray-900">{value}</div>}
      <div className="mt-1 text-xs text-gray-500">{hint}</div>
    </div>
  );
}
