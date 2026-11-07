import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Building2, CalendarDays, Download, Info, LayoutGrid, Search, User, X, type LucideIcon } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { ErrorState } from "@/components/PageStates";
import { Body, Head, Pager, type Sort } from "@/components/assessments/quiz/QuizTables";
import { CopyUid } from "@/components/assessments/quiz/CopyUid";
import { CheckMenu } from "@/components/SpiRecordFilterBar";
import { SearchableSelect } from "@/components/SearchableSelect";
import { ColumnOrderList, moveListItem } from "@/components/ColumnOrderList";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/AuthContext";
import { useQueryParams } from "@/hooks/useQueryParams";
import { exportCsv } from "@/lib/csv";
import { omitExcludedInstitutes } from "@/lib/excludedInstitutes";
import { cn } from "@/lib/utils";

type Grain = "campus" | "semester" | "section" | "student";
type Grade = "A+" | "A" | "B" | "C" | "D" | "F";

interface RecordRow {
  university: string;
  semester: string | null;
  section: string | null;
  studentId: string | null;
  studentName: string | null;
  students: number;
  evaluated: number;
  cq: number | null;
  mq: number | null;
  sa: number | null;
  fsa: number | null;
  spi: number | null;
  grade: Grade | null;
  spiPath: string | null;
}

interface TablePayload {
  rows: RecordRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  summary: { students: number; evaluated: number; avgSpi: number | null; grades: Record<Grade, number> };
  options: { campuses: string[]; semesters: string[]; sections: { campus: string; section: string }[] };
}

const VIEWS: { value: Grain; label: string; icon: LucideIcon }[] = [
  { value: "campus", label: "Campus-wise", icon: Building2 },
  { value: "semester", label: "Semester-wise", icon: CalendarDays },
  { value: "section", label: "Section-wise", icon: LayoutGrid },
  { value: "student", label: "Student-wise", icon: User },
];

/** Grade colours: A+ green, A teal, B blue, C orange, D red; F (policy §3.2) grey. */
const GRADE_STYLE: Record<Grade, { color: string; bg: string }> = {
  "A+": { color: "#15803D", bg: "#E8F6EE" },
  A: { color: "#0F766E", bg: "#E0F5F2" },
  B: { color: "#1D4FD8", bg: "#EAF1FF" },
  C: { color: "#C2410C", bg: "#FFEDE0" },
  D: { color: "#B42318", bg: "#FDECEA" },
  F: { color: "#4B5563", bg: "#E5E7EB" },
};
const KPI_GRADES: Grade[] = ["A+", "A", "B", "C", "D"];
const GRADE_OPTIONS = [...(["A+", "A", "B", "C", "D", "F"] as Grade[]), "Pending"].map((value) => ({ value, label: value }));

type ColumnId = "university" | "semester" | "section" | "studentId" | "studentName" | "students" | "evaluated" | "cq" | "mq" | "sa" | "fsa" | "spi" | "grade";

const COLUMNS: Record<Grain, ColumnId[]> = {
  campus: ["university", "students", "evaluated", "cq", "mq", "sa", "fsa", "spi", "grade"],
  semester: ["university", "semester", "students", "evaluated", "cq", "mq", "sa", "fsa", "spi", "grade"],
  section: ["university", "semester", "section", "students", "evaluated", "cq", "mq", "sa", "fsa", "spi", "grade"],
  student: ["studentId", "studentName", "university", "semester", "section", "cq", "mq", "sa", "fsa", "spi", "grade"],
};

const WEIGHT: Partial<Record<ColumnId, string>> = { cq: "10%", mq: "15%", sa: "25%", fsa: "50%" };

function columnLabel(id: ColumnId, grain: Grain): string {
  const average = grain !== "student";
  const base: Record<ColumnId, string> = {
    university: "College",
    semester: "Semester",
    section: "Section",
    studentId: "Student ID",
    studentName: "Student Name",
    students: "Students",
    evaluated: "Evaluated",
    cq: average ? "Avg CQ" : "CQ",
    mq: average ? "Avg MQ" : "MQ",
    sa: average ? "Avg SA" : "SA",
    fsa: average ? "Avg FSA" : "FSA",
    spi: average ? "Avg SPI" : "SPI",
    grade: "Grade",
  };
  return base[id];
}

const NUMERIC = new Set<ColumnId>(["students", "evaluated", "cq", "mq", "sa", "fsa", "spi"]);
const SORT_KEY: Partial<Record<ColumnId, string>> = { studentName: "studentName" };
const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-600 focus-visible:ring-offset-2";

export default function SpiRecordDashboard() {
  const { user } = useAuth();
  const isBoa = user?.role === "boa" || user?.role === "cos";
  const [, setLocation] = useLocation();
  const query = useQueryParams();
  const grain = (VIEWS.some((view) => view.value === query.get("group")) ? query.get("group") : "campus") as Grain;
  const lockedCampus = isBoa && user?.campuses?.length === 1;
  const campuses = splitList(query.get("campuses")).length ? splitList(query.get("campuses")) : lockedCampus ? [user!.campuses![0]!] : [];
  const semesters = splitList(query.get("semesters"));
  const sections = splitList(query.get("sections"));
  const grade = query.get("grade") || "";

  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [sort, setSort] = useState<Sort | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [hidden, setHidden] = useState<Record<Grain, ColumnId[]>>({ campus: [], semester: [], section: [], student: [] });
  const [order, setOrder] = useState<Record<Grain, ColumnId[]>>(COLUMNS);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const viewParams = () => {
    const params = new URLSearchParams();
    if (grain !== "campus") params.set("group", grain);
    if (campuses.length) params.set("campuses", campuses.join("||"));
    if (semesters.length) params.set("semesters", semesters.join("||"));
    if (sections.length) params.set("sections", sections.join("||"));
    if (grade) params.set("grade", grade);
    if (debounced) params.set("q", debounced);
    if (sort) {
      params.set("sort", SORT_KEY[sort.key as ColumnId] ?? sort.key);
      params.set("dir", sort.dir);
    }
    return params;
  };
  const viewKey = viewParams().toString();

  const fetchTable = async (params: URLSearchParams): Promise<TablePayload> => {
    const res = await fetch(`/api/dashboard/spi-record/table?${params.toString()}`, { credentials: "include" });
    if (!res.ok) throw new Error("Failed to load SPI record");
    return res.json() as Promise<TablePayload>;
  };

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["spi-record-table", viewKey, page, pageSize],
    queryFn: () => {
      const params = new URLSearchParams(viewKey);
      params.set("page", String(page));
      params.set("pageSize", String(pageSize));
      return fetchTable(params);
    },
    placeholderData: keepPreviousData,
    staleTime: 15 * 60_000,
  });

  const campusOptions = useMemo(
    () => (lockedCampus ? omitExcludedInstitutes(user!.campuses!) : omitExcludedInstitutes(data?.options.campuses ?? [])),
    [data, lockedCampus, user],
  );
  const semesterOptions = data?.options.semesters ?? [];
  const sectionChoices = data?.options.sections ?? [];
  const multiCampus = campuses.length !== 1;

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

  const columns = order[grain].filter((id) => !hidden[grain].includes(id));
  const rows = data?.rows ?? [];
  const totalRows = data?.total ?? 0;
  const summary = data?.summary;
  const evaluated = summary?.evaluated ?? 0;
  const share = (count: number) => (evaluated > 0 ? `${((count / evaluated) * 100).toFixed(1)}% of evaluated` : "Pending");
  const scopeLabel = [
    campuses.length ? campuses.join(", ") : "All campuses",
    semesters.length ? semesters.join(", ") : "Current semesters",
  ].join(" · ");

  const cellText = (row: RecordRow, id: ColumnId): string => {
    if (id === "university") return row.university;
    if (id === "semester") return row.semester ?? "";
    if (id === "section") return row.section ?? "";
    if (id === "studentId") return row.studentId ?? "";
    if (id === "studentName") return row.studentName ?? "";
    if (id === "students" || id === "evaluated") return String(row[id]);
    if (id === "grade") return row.grade ?? "Pending";
    const value = row[id];
    if (value == null) return "N/A";
    return id === "spi" ? value.toFixed(2) : `${value.toFixed(1)}%`;
  };

  const exportRows = (source: RecordRow[], filename: string) =>
    exportCsv(filename, columns.map((id) => columnLabel(id, grain)), source.map((row) => columns.map((id) => cellText(row, id))));
  const exportView = async () => {
    const params = viewParams();
    params.set("export", "1");
    exportRows((await fetchTable(params)).rows, "spi-record-this-view.csv");
  };
  /** Every campus at this view: filters are dropped. */
  const exportAll = async () => {
    const params = new URLSearchParams();
    if (grain !== "campus") params.set("group", grain);
    params.set("export", "1");
    exportRows((await fetchTable(params)).rows, "spi-record-all-campuses.csv");
  };

  const clearFilters = () => {
    setSearch("");
    writeQuery({ campuses: undefined, semesters: undefined, sections: undefined, grade: undefined });
  };

  const onSort = (key: string) => {
    setPage(1);
    setSort((current) => (current?.key === key ? { key, dir: current.dir === "asc" ? "desc" : "asc" } : { key, dir: NUMERIC.has(key as ColumnId) ? "desc" : "asc" }));
  };

  const header = columns.map((id) => ({
    key: id,
    label: WEIGHT[id] ? `${columnLabel(id, grain)} (${WEIGHT[id]})` : columnLabel(id, grain),
    align: NUMERIC.has(id) ? ("right" as const) : undefined,
    sortable: id !== "studentId",
  }));

  const renderCell = (row: RecordRow, id: ColumnId): ReactNode => {
    if (id === "studentId") return row.studentId ? <CopyUid uid={row.studentId} /> : "";
    if (id === "studentName") {
      return row.spiPath ? <a className="font-medium text-brand-700 hover:underline" href={row.spiPath}>{row.studentName || row.studentId}</a> : row.studentName;
    }
    if (id === "grade") return <GradePill grade={row.grade} />;
    if (id === "university") return <span className="font-medium text-slate-900">{row.university}</span>;
    if (id === "semester" || id === "section") return row[id] ?? "";
    if (id === "students" || id === "evaluated") return row[id].toLocaleString("en-IN");
    const value = row[id];
    if (value == null) return <NotAvailable what={id === "spi" ? "Pending: the Final (FSA) is not available yet" : id === "sa" || id === "fsa" ? "Coming soon: not in the data yet" : "Not conducted yet"} />;
    if (id === "spi") {
      return (
        <span className="inline-flex flex-col items-end">
          <span className="font-bold text-slate-900">{value.toFixed(2)}</span>
          <span aria-hidden="true" className="mt-0.5 block h-[3px] w-11 overflow-hidden rounded bg-slate-200"><span className="block h-full bg-violet-600" style={{ width: `${value * 10}%` }} /></span>
        </span>
      );
    }
    return `${value.toFixed(1)}%`;
  };

  const rowKey = (row: RecordRow) => [row.university, row.semester, row.section, row.studentId].join("|");

  return (
    <div className="flex min-w-0 flex-col">
      <PageHeader
        title="SPI Record Dashboard"
        right={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button type="button" variant="outline" size="sm" disabled={totalRows === 0 || isLoading} onClick={() => void exportView()}>
              <Download className="mr-1 h-4 w-4" aria-hidden="true" /> Export this view
            </Button>
            <Button type="button" size="sm" disabled={isLoading} onClick={() => void exportAll()}>
              <Download className="mr-1 h-4 w-4" aria-hidden="true" /> Export all campuses
            </Button>
          </div>
        }
      />

      {noteOpen && (
        <div role="note" className="mt-3 flex items-start gap-2.5 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-[13px] leading-relaxed text-slate-800">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-violet-600" aria-hidden="true" />
          <p className="flex-1">
            <b>Course score</b> = CQ 10% + MQ 15% + SA 25% + FSA 50% (a part below 50% earns 0; parts with no data are left out and the score is re-scaled to 100). <b>SPI</b> = credit-weighted average of course level points. Shown once the Final (FSA) is available.
          </p>
          <button type="button" aria-label="Hide message" onClick={() => setNoteOpen(false)} className={cn("rounded p-1 text-slate-500 hover:bg-white", focusRing)}>
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2.5 md:grid-cols-4 xl:grid-cols-7">
        <StatTile label="Total students evaluated" value={isLoading ? null : evaluated.toLocaleString("en-IN")} hint={isLoading ? "" : `of ${(summary?.students ?? 0).toLocaleString("en-IN")} students${summary?.grades.F ? ` · ${summary.grades.F.toLocaleString("en-IN")} F` : ""}`} accent="#6D4AE0" />
        <StatTile label="Average SPI" value={isLoading ? null : summary?.avgSpi == null ? "N/A" : summary.avgSpi.toFixed(2)} hint={isLoading ? "" : summary?.avgSpi == null ? "Pending Final (FSA)" : "out of 10"} accent="#6D4AE0" />
        {KPI_GRADES.map((g) => (
          <StatTile key={g} label={`${g} grade`} value={isLoading ? null : (summary?.grades[g] ?? 0).toLocaleString("en-IN")} hint={isLoading ? "" : share(summary?.grades[g] ?? 0)} accent={GRADE_STYLE[g].color} />
        ))}
      </div>

      <div role="group" aria-label="View by" className="mt-3 flex flex-wrap items-center gap-3">
        <span className="text-sm font-bold text-slate-900">View by</span>
        <div className="flex flex-wrap gap-2">
          {VIEWS.map(({ value, label, icon: Icon }) => {
            const on = grain === value;
            return (
              <button
                key={value}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  if (on) return;
                  setSort(null);
                  setSearch("");
                  writeQuery({ group: value === "campus" ? undefined : value });
                }}
                className={cn(
                  "inline-flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-semibold transition-all motion-reduce:transition-none",
                  focusRing,
                  on ? "bg-violet-600 text-white shadow-md shadow-violet-600/30" : "bg-white text-slate-700 shadow-sm hover:-translate-y-px hover:shadow-md motion-reduce:hover:translate-y-0",
                )}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div role="group" aria-label="Filters" className="mt-3 grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {!lockedCampus && (
          <FilterField label="College">
            <CheckMenu
              className="w-full"
              label={campuses.length ? `${campuses.length} selected` : "All colleges"}
              options={campusOptions.map((name) => ({ id: name, label: name }))}
              selected={campuses}
              onChange={(next) =>
                writeQuery({
                  campuses: next.join("||") || undefined,
                  sections: next.length ? sections.filter((id) => next.includes(id.split("\t")[0] ?? "")).join("||") || undefined : undefined,
                })
              }
            />
          </FilterField>
        )}
        <FilterField label="Semester">
          <CheckMenu
            className="w-full"
            label={semesters.length ? `${semesters.length} selected` : "Current semesters"}
            options={semesterOptions.map((name) => ({ id: name, label: name }))}
            selected={semesters}
            onChange={(next) => writeQuery({ semesters: next.join("||") || undefined })}
          />
        </FilterField>
        <FilterField label="Section">
          <CheckMenu
            className="w-full"
            label={sections.length ? `${sections.length} selected` : campuses.length ? "All sections" : "Select a college"}
            options={sectionChoices.map((item) => ({ id: `${item.campus}\t${item.section}`, label: multiCampus ? `${item.campus} — ${item.section}` : item.section }))}
            selected={sections}
            onChange={(next) => writeQuery({ sections: next.join("||") || undefined })}
          />
        </FilterField>
        <FilterField label="Grade">
          <SearchableSelect
            value={grade || "all"}
            onValueChange={(value) => writeQuery({ grade: value === "all" ? undefined : value })}
            options={[{ value: "all", label: "All grades" }, ...GRADE_OPTIONS]}
            placeholder="All grades"
          />
        </FilterField>
        <FilterField label="Student search">
          <label className="relative block">
            <span className="sr-only">Student name or ID</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Name or Student ID"
              className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-600"
            />
          </label>
        </FilterField>
      </div>

      {isError && (
        <div className="mt-3">
          <ErrorState message="Failed to load the SPI record." onRetry={() => void refetch()} />
        </div>
      )}

      <section className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm" aria-label="SPI records">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-3">
          <p className="min-w-0 truncate text-sm text-slate-500 tabular-nums" title={scopeLabel}>
            <span className="font-semibold text-slate-900">{totalRows.toLocaleString("en-IN")}</span> {rowsLabel(grain)} · {scopeLabel}
          </p>
          <div className="ml-auto flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={clearFilters}>Clear filters</Button>
            <Popover open={columnsOpen} onOpenChange={setColumnsOpen}>
              <PopoverTrigger asChild>
                <Button type="button" variant="outline" size="sm">Columns</Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-72">
                <p className="mb-2 text-xs text-gray-500">Tick the columns to show; drag to reorder.</p>
                <ColumnOrderList
                  ids={order[grain]}
                  label={(id) => columnLabel(id, grain)}
                  checked={(id) => !hidden[grain].includes(id)}
                  locked={(id) => id === (grain === "student" ? "studentName" : "university")}
                  onToggle={(id) => setHidden((current) => ({ ...current, [grain]: current[grain].includes(id) ? current[grain].filter((item) => item !== id) : [...current[grain], id] }))}
                  onReorder={(from, to) => setOrder((current) => ({ ...current, [grain]: moveListItem(current[grain], from, to) }))}
                />
              </PopoverContent>
            </Popover>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[56rem] text-left">
            <Head columns={header} sort={sort ?? { key: "", dir: "asc" }} onSort={onSort} dense />
            <Body loading={isLoading} empty={grade && grade !== "Pending" ? `No students have grade ${grade} yet. Grades appear once the Final (FSA) is available.` : "No rows match these filters."} colSpan={columns.length} rowsCount={rows.length}>
              {rows.map((row) => (
                <tr key={rowKey(row)} className="hover:bg-slate-50">
                  {columns.map((id) => (
                    <td key={id} className={cn("whitespace-nowrap px-2.5 py-2.5 text-sm text-slate-700", NUMERIC.has(id) && "text-right tabular-nums")}>
                      {renderCell(row, id)}
                    </td>
                  ))}
                </tr>
              ))}
            </Body>
          </table>
        </div>
        <Pager page={data} unit={rowsLabel(grain)} pageSize={pageSize} onPage={setPage} onPageSize={(size) => { setPageSize(size); setPage(1); }} />
      </section>
    </div>
  );
}

function rowsLabel(grain: Grain): string {
  return { campus: "campuses", semester: "campus × semester rows", section: "campus × semester × section rows", student: "students" }[grain];
}

function splitList(value: string | null): string[] {
  return value ? value.split("||").map((item) => item.trim()).filter(Boolean) : [];
}

function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-xs font-semibold text-slate-700">{label}</span>
      {children}
    </div>
  );
}

function StatTile({ label, value, hint, accent }: { label: string; value: string | null; hint?: string; accent: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-slate-200 border-t-[3px] bg-white px-3.5 py-2.5 shadow-sm" style={{ borderTopColor: accent }}>
      <div className="text-xs font-medium text-slate-500">{label}</div>
      {value == null ? <Skeleton className="h-7 w-20" /> : <div className="text-xl font-bold tracking-tight tabular-nums text-slate-900" style={{ color: accent }}>{value}</div>}
      {hint ? <div className="text-[11px] text-slate-500">{hint}</div> : null}
    </div>
  );
}

function NotAvailable({ what }: { what: string }) {
  return <span className="cursor-help text-xs font-medium text-slate-500" title={what}>N/A</span>;
}

function GradePill({ grade }: { grade: Grade | null }) {
  if (!grade) {
    return (
      <span className="inline-block rounded-full border border-dashed border-slate-300 bg-slate-50 px-2.5 py-0.5 text-xs font-semibold text-slate-500" title="Shown once the Final (FSA) is available">
        Pending
      </span>
    );
  }
  const style = GRADE_STYLE[grade];
  return (
    <span className="inline-block min-w-[2.25rem] rounded-full px-2.5 py-0.5 text-center text-xs font-bold" style={{ color: style.color, background: style.bg }}>
      {grade}
    </span>
  );
}
