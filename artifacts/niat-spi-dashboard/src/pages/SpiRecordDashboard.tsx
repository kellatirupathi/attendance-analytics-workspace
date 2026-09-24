import { useMemo, useState } from "react";
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
  SearchableSelect,
  campusSelectOptions,
} from "@/components/SearchableSelect";
import { useAuth } from "@/contexts/AuthContext";
import { useAttendanceSemesters } from "@/hooks/useAttendanceSemesters";
import { useQueryParams } from "@/hooks/useQueryParams";
import { exportCsv } from "@/lib/csv";
import { omitExcludedInstitutes } from "@/lib/excludedInstitutes";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";

type Grain = "all" | "campus" | "semester" | "section" | "student";

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
  | "sections";

const COLUMN_GROUPS: { title: string; ids: ColumnId[] }[] = [
  { title: "SPI score", ids: ["students", "avgSpi", "skillLevel", "classroomPoints", "modulePoints"] },
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
];

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
  const campus =
    query.get("campus") ||
    (isBoa && user?.campuses?.length === 1 ? user.campuses[0]! : "all");
  const section = query.get("section") || "all";
  const scope = query.get("scope") || "current";
  const semester = query.get("semester") || "";

  const [columns, setColumns] = useState<ColumnId[]>(DEFAULT_COLUMNS);
  const [draft, setDraft] = useState<ColumnId[]>(DEFAULT_COLUMNS);
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [exporting, setExporting] = useState(false);

  const { data: filterOptions } = useGetDashboardFilters(
    campus !== "all" ? { campus } : undefined,
    {
      query: {
        queryKey: getGetDashboardFiltersQueryKey(campus !== "all" ? { campus } : undefined),
        staleTime: 5 * 60_000,
      },
    },
  );
  const campusOptions = useMemo(() => {
    if (isBoa && user?.campuses?.length === 1) return omitExcludedInstitutes(user.campuses);
    return omitExcludedInstitutes(filterOptions?.campuses ?? []);
  }, [filterOptions, isBoa, user?.campuses]);
  const semesters = useAttendanceSemesters(campus === "all" ? undefined : campus);
  const needsCampus = grain === "section" || grain === "student";
  const ready = !needsCampus || campus !== "all";

  const params = new URLSearchParams({ group: grain });
  if (campus !== "all") params.set("campus", campus);
  if (grain === "student" && section !== "all") params.set("section", section);
  if (scope === "all") params.set("scope", "all");
  else if (semester) params.set("semester", semester);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["spi-record", params.toString()],
    enabled: ready,
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

  const rows = data?.rows ?? [];
  const pageRows = rows.slice((page - 1) * pageSize, page * pageSize);
  const summary = data?.summary;
  const total = summary?.students ?? 0;
  const split = (count: number) => (total > 0 ? Math.round((count / total) * 100) : 0);
  const levelColumns: ColumnId[] = ["levelAPlus", "levelA", "levelB", "levelC", "levelD"];
  const visible = columns.filter((id) => {
    if (grain === "student" && (id === "students" || id === "sections" || levelColumns.includes(id))) return false;
    if (grain !== "student" && id === "skillLevel") return false;
    return true;
  });

  const identityHeader =
    grain === "all" ? "Scope" : grain === "semester" ? "Semester" : grain === "section" ? "Section" : grain === "student" ? "Name" : "Campus";

  const identity = (row: RecordRow) => {
    if (grain === "semester") return row.semester || "—";
    if (grain === "section") return row.section || "—";
    if (grain === "student") return row.studentName || "—";
    if (grain === "all") return "All campuses";
    return row.university || "—";
  };

  const cell = (row: RecordRow, id: ColumnId): string => {
    if (id === "avgSpi" || id === "classroomPoints" || id === "modulePoints") {
      const value = row[id];
      return value == null ? "—" : value.toFixed(1);
    }
    if (id === "skillLevel") return row.skillLevel || "—";
    if (id === "skillDebt" && grain === "student") return row.skillDebt > 0 ? "Yes" : "No";
    return fmt(row[id]);
  };

  const exportRows = (source: RecordRow[], filename: string) => {
    const headers = [
      identityHeader,
      ...(grain === "student" ? ["Student ID"] : []),
      ...visible.map((id) => COLUMN_LABEL[id]),
    ];
    exportCsv(
      filename,
      headers,
      source.map((row) => [
        identity(row),
        ...(grain === "student" ? [row.studentId ?? ""] : []),
        ...visible.map((id) => cell(row, id)),
      ]),
    );
  };

  const exportAll = async () => {
    setExporting(true);
    try {
      const all = new URLSearchParams({ group: "campus" });
      if (scope === "all") all.set("scope", "all");
      else if (semester) all.set("semester", semester);
      const res = await fetch(`/api/dashboard/spi-record?${all.toString()}`, { credentials: "include" });
      if (!res.ok) return;
      const body = (await res.json()) as RecordPayload;
      exportCsv(
        "spi-record-all-campuses.csv",
        ["Campus", "Students", "SPI points", "A+", "A", "B", "C", "D", "Skill Debt"],
        body.rows.map((row) => [
          row.university ?? "",
          row.students,
          row.avgSpi ?? "",
          row.levelAPlus,
          row.levelA,
          row.levelB,
          row.levelC,
          row.levelD,
          row.skillDebt,
        ]),
      );
    } finally {
      setExporting(false);
    }
  };

  const scopeLabel = scope === "all" ? "All semesters" : semester || "Current semester";

  return (
    <div className="flex flex-col">
      <PageHeader
        title="SPI Record Dashboard"
        subtitle={`Skill Performance Index · ${scopeLabel}. SPI points use the Reports formula. Skill level follows plan §3.2.`}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tile label="Students evaluated" value={isLoading ? null : fmt(summary?.students ?? 0)} hint={`Across ${fmt(summary?.campuses ?? 0)} campuses, ${scopeLabel.toLowerCase()}`} />
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
          label="Skill Debt"
          value={isLoading ? null : fmt(summary?.skillDebt ?? 0)}
          hint="Below 50% on a quiz the student has, or no classroom and no module quiz."
          tone="rose"
        />
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label="Group by">
          <SearchableSelect
            value={grain}
            onValueChange={(value) => writeQuery({ group: value === "campus" ? undefined : value })}
            options={[
              { value: "all", label: "All-campus cumulative" },
              { value: "campus", label: "Campus-wise" },
              { value: "semester", label: "Semester-wise" },
              { value: "section", label: "Section-wise" },
              { value: "student", label: "Student-wise" },
            ]}
            className="w-[220px]"
          />
        </Field>
        <Field label="Date scope">
          <SearchableSelect
            value={scope === "all" ? "all" : semester || "current"}
            onValueChange={(value) => {
              if (value === "current") writeQuery({ scope: undefined, semester: undefined });
              else if (value === "all") writeQuery({ scope: "all", semester: undefined });
              else writeQuery({ scope: undefined, semester: value });
            }}
            options={[
              { value: "current", label: "Current semester" },
              { value: "all", label: "All semesters" },
              ...semesters.map((item) => ({ value: item, label: item })),
            ]}
            className="w-[200px]"
          />
        </Field>
        {needsCampus && (
          <Field label="Campus">
            <SearchableSelect
              value={campus}
              onValueChange={(value) => writeQuery({ campus: value === "all" ? undefined : value, section: undefined })}
              options={campusSelectOptions(campusOptions)}
              className="w-[240px]"
            />
          </Field>
        )}
        {grain === "student" && campus !== "all" && (
          <Field label="Section">
            <SearchableSelect
              value={section}
              onValueChange={(value) => writeQuery({ section: value === "all" ? undefined : value })}
              options={[
                { value: "all", label: "All sections" },
                ...(filterOptions?.sections ?? []).map((item) => ({ value: item, label: item })),
              ]}
              className="w-[200px]"
            />
          </Field>
        )}
        <Field label="Columns">
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" className="w-[180px] justify-between">
                {columns.length} of {Object.keys(COLUMN_LABEL).length} selected
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64" align="start">
              {COLUMN_GROUPS.map((group) => (
                <div key={group.title} className="mb-2">
                  <div className="px-1 py-1 text-[11px] font-semibold uppercase text-gray-500">{group.title}</div>
                  {group.ids.map((id) => (
                    <label key={id} className="flex items-center gap-2 px-1 py-1 text-sm">
                      <input
                        type="checkbox"
                        checked={draft.includes(id)}
                        onChange={() =>
                          setDraft((current) =>
                            current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
                          )
                        }
                      />
                      {COLUMN_LABEL[id]}
                    </label>
                  ))}
                </div>
              ))}
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
        </Field>
        <Field label="Export">
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={!rows.length} onClick={() => exportRows(rows, "spi-record-this-view.csv")}>
              <Download className="mr-1 h-4 w-4" /> Export this view
            </Button>
            <Button size="sm" disabled={exporting} onClick={() => void exportAll()}>
              <Download className="mr-1 h-4 w-4" /> Export all campuses
            </Button>
          </div>
        </Field>
      </div>

      {!ready ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Pick a campus first. Section-wise and student-wise lists are too large to show for every campus at once.
        </div>
      ) : isError ? (
        <ErrorState message="Failed to load the SPI record." onRetry={() => void refetch()} />
      ) : (
        <TableShell>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{identityHeader}</TableHead>
                {grain === "student" && <TableHead>Student ID</TableHead>}
                {visible.map((id) => (
                  <TableHead key={id}>{COLUMN_LABEL[id]}</TableHead>
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
                    <TableRow key={`${identity(row)}-${row.studentId ?? index}`}>
                      <TableCell className="font-medium">
                        {grain === "student" && row.spiPath ? (
                          <a className="text-brand-700 hover:underline" href={row.spiPath}>{identity(row)}</a>
                        ) : (
                          identity(row)
                        )}
                      </TableCell>
                      {grain === "student" && <TableCell className="text-gray-500">{row.studentId}</TableCell>}
                      {visible.map((id) => (
                        <TableCell key={id}>
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
      {label}
      {children}
    </label>
  );
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
