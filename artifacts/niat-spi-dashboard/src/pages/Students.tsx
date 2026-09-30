import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
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
import { BoundControl, CheckMenu, Field } from "@/components/SpiRecordFilterBar";
import { StatTile } from "@/components/dashboard/overview";
import { useAuth } from "@/contexts/AuthContext";
import { useQueryParams } from "@/hooks/useQueryParams";
import { useDebounceValue } from "@/hooks/useDebounceValue";
import { useToast } from "@/hooks/use-toast";
import { exportCsv } from "@/lib/csv";
import { omitExcludedInstitutes } from "@/lib/excludedInstitutes";
import { ATTENDANCE_TIERS, type AttendanceTierId } from "@/lib/attendanceTiers";
import type { SpiDetailRow } from "@/lib/spiRecordAggregate";
import {
  buildDirectoryRows,
  filterDirectory,
  sortDirectory,
  summarizeDirectory,
  type BoundOp,
  type DirectoryFilters,
  type QuizFilter,
  type SortKey,
} from "@/lib/studentDirectory";
import { cn, pctTextColor } from "@/lib/utils";
import { readSubjects, subjectOptionList } from "@/lib/subjects";
import { ArrowDown, ArrowUp, Copy, Download, ExternalLink, Loader2, Search } from "lucide-react";

type Period = "semester_to_date" | "last_30" | "custom";

interface DetailPayload {
  rows: SpiDetailRow[];
  spiPaths: Record<string, string>;
}

const PAGE_SIZES = [25, 50, 100, 200];
const TIER_IDS = ATTENDANCE_TIERS.map((tier) => tier.id);
const SORT_KEYS: SortKey[] = ["name", "studentId", "campus", "section", "semester", "attendance", "classroom", "module", "spi", "skill"];

const COLUMNS: { key: SortKey; label: string; numeric?: boolean; className?: string }[] = [
  { key: "name", label: "Name", className: "min-w-[180px]" },
  { key: "studentId", label: "Student UUID", className: "min-w-[300px]" },
  { key: "campus", label: "Campus", className: "min-w-[200px]" },
  { key: "section", label: "Section", className: "min-w-[140px]" },
  { key: "semester", label: "Semester", className: "min-w-[120px]" },
  { key: "attendance", label: "Attendance", numeric: true, className: "min-w-[170px]" },
  { key: "classroom", label: "Classroom quiz", numeric: true, className: "min-w-[110px]" },
  { key: "module", label: "Module quiz", numeric: true, className: "min-w-[110px]" },
  { key: "spi", label: "SPI", numeric: true, className: "min-w-[70px]" },
  { key: "skill", label: "Skill level", numeric: true, className: "min-w-[90px]" },
];

function splitList(value: string | null): string[] {
  return value ? value.split("||").map((item) => item.trim()).filter(Boolean) : [];
}

function fmtPct(value: number | null): string {
  return value == null ? "—" : `${value.toFixed(1)}%`;
}

function skillTone(level: string): string {
  if (level === "A+" || level === "A") return "text-emerald-700";
  if (level === "B") return "text-lime-700";
  if (level === "C") return "text-amber-700";
  if (level === "D") return "text-orange-700";
  return "text-red-700";
}

function skillLabel(level: string): string {
  if (level === "F") return "Skill debt";
  if (level === "Ab") return "Skill debt (no quiz)";
  return level;
}

export default function Students() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const query = useQueryParams();

  const lockedCampus = user?.role === "boa" && user?.campuses?.length === 1 ? user.campuses[0]! : null;
  const campuses = lockedCampus ? [lockedCampus] : splitList(query.get("campuses"));
  const semesters = splitList(query.get("semesters"));
  const sections = splitList(query.get("sections")).filter((value) => value.includes("\t"));
  const subjects = readSubjects(query);
  const tiers = splitList(query.get("tiers")).filter((id): id is AttendanceTierId => TIER_IDS.includes(id as AttendanceTierId));
  const spiOp = (["gte", "lte", "between"].includes(query.get("spiOp") ?? "") ? query.get("spiOp") : "") as BoundOp;
  const spiA = query.get("spiA") ?? "";
  const spiB = query.get("spiB") ?? "";
  const debtOnly = query.get("debt") === "1";
  const needsAttention = query.get("attention") === "1";
  const rawQuiz = query.get("quiz") ?? "";
  const quiz = (["missing_classroom", "missing_module", "missing_both"].includes(rawQuiz) ? rawQuiz : "") as QuizFilter;
  const rawPeriod = query.get("attRange");
  const period: Period = rawPeriod === "last_30" || rawPeriod === "custom" ? rawPeriod : "semester_to_date";
  const attFrom = query.get("attFrom") ?? "";
  const attTo = query.get("attTo") ?? "";
  const sortKey = (SORT_KEYS.includes(query.get("sort") as SortKey) ? query.get("sort") : "name") as SortKey;
  const sortDir: 1 | -1 = query.get("dir") === "desc" ? -1 : 1;

  const [search, setSearch] = useState(query.get("q") ?? "");
  const debouncedSearch = useDebounceValue(search, 250);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const writeQuery = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(query);
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setPage(1);
    const qs = next.toString();
    setLocation(qs ? `/dashboard/students?${qs}` : "/dashboard/students", { replace: true });
  };

  useEffect(() => {
    if ((query.get("q") ?? "") !== debouncedSearch.trim()) writeQuery({ q: debouncedSearch.trim() || undefined });
  }, [debouncedSearch]);

  /* ---- data: same endpoint + key as SPI Record and the Overview ---- */

  const customReady = /^\d{4}-\d{2}-\d{2}$/.test(attFrom) && /^\d{4}-\d{2}-\d{2}$/.test(attTo);
  const detailParams = new URLSearchParams();
  if (period === "custom" && customReady) {
    detailParams.set("attRange", "custom");
    detailParams.set("attFrom", attFrom <= attTo ? attFrom : attTo);
    detailParams.set("attTo", attFrom <= attTo ? attTo : attFrom);
  } else if (period !== "custom") {
    detailParams.set("attRange", period);
  }
  // Attendance in this payload is summed across subjects, so the server narrows it.
  if (subjects.length) detailParams.set("subjects", subjects.join("||"));
  const customPending = period === "custom" && !customReady;

  const { data, isLoading, isFetching, isError, refetch } = useQuery({
    queryKey: ["spi-record-detail", detailParams.toString()],
    enabled: !customPending,
    queryFn: async () => {
      const res = await fetch(`/api/dashboard/spi-record/detail?${detailParams.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load students");
      return res.json() as Promise<DetailPayload>;
    },
    placeholderData: keepPreviousData,
    staleTime: 15 * 60_000,
  });

  const { data: subjectData } = useQuery({
    queryKey: ["subject-options"],
    queryFn: async () => {
      const res = await fetch("/api/dashboard/subject-options", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load subjects");
      return res.json() as Promise<{ options: { campus: string; semester: string; subject: string }[] }>;
    },
    staleTime: 15 * 60_000,
  });

  const allRows = useMemo(() => buildDirectoryRows(data?.rows ?? []), [data]);
  // Only classroom (10%) and module (15%) quizzes feed SPI today, so the real ceiling is 2.5.
  const maxSpi = useMemo(() => (allRows.length ? allRows.reduce((max, row) => Math.max(max, row.spi), 0) : null), [allRows]);

  /* ---- filter options ---- */

  const campusKey = campuses.join("||");
  const semesterKey = semesters.join("||");
  const campusOptions = useMemo(() => {
    if (lockedCampus) return [lockedCampus];
    return omitExcludedInstitutes([...new Set(allRows.map((row) => row.campus))].sort((a, b) => a.localeCompare(b)));
  }, [allRows, lockedCampus]);
  const semesterOptions = useMemo(() => {
    const campusSet = new Set(campuses);
    const names = new Set<string>();
    for (const row of allRows) {
      if (campusSet.size && !campusSet.has(row.campus)) continue;
      for (const name of row.semesters) names.add(name);
    }
    return [...names].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [allRows, campusKey]);
  const subjectOptions = useMemo(() => {
    const campusSet = new Set(campuses);
    const semesterSet = new Set(semesters);
    return subjectOptionList(
      (subjectData?.options ?? [])
        .filter((item) => (!campusSet.size || campusSet.has(item.campus)) && (!semesterSet.size || semesterSet.has(item.semester)))
        .map((item) => item.subject),
    );
  }, [subjectData, campusKey, semesterKey]);
  const sectionChoices = useMemo(() => {
    if (!campuses.length) return [];
    const campusSet = new Set(campuses);
    const semesterSet = new Set(semesters);
    const seen = new Map<string, { campus: string; section: string }>();
    for (const row of allRows) {
      if (!campusSet.has(row.campus)) continue;
      if (semesterSet.size && !row.semesters.some((name) => semesterSet.has(name))) continue;
      for (const section of row.sections) {
        const key = `${row.campus}\t${section}`;
        if (!seen.has(key)) seen.set(key, { campus: row.campus, section });
      }
    }
    return [...seen.values()].sort((a, b) => a.section.localeCompare(b.section, undefined, { numeric: true }));
  }, [allRows, campusKey, semesterKey]);

  /* ---- filter, summarize, sort, page ---- */

  const filters: DirectoryFilters = {
    search: query.get("q") ?? "",
    campuses,
    semesters,
    sections,
    tiers,
    spiOp,
    spiA,
    spiB,
    debtOnly,
    needsAttention,
    quiz,
  };
  const filterKey = JSON.stringify(filters);
  const filtered = useMemo(() => filterDirectory(allRows, filters), [allRows, filterKey]);
  const summary = useMemo(() => summarizeDirectory(filtered), [filtered]);
  const sorted = useMemo(() => sortDirectory(filtered, sortKey, sortDir), [filtered, sortKey, sortDir]);
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paged = sorted.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const activeCount =
    (lockedCampus ? 0 : campuses.length ? 1 : 0) +
    (semesters.length ? 1 : 0) +
    (sections.length ? 1 : 0) +
    (subjects.length ? 1 : 0) +
    (tiers.length ? 1 : 0) +
    (spiOp && spiA ? 1 : 0) +
    (debtOnly ? 1 : 0) +
    (needsAttention ? 1 : 0) +
    (quiz ? 1 : 0) +
    (filters.search ? 1 : 0);

  const clearAll = () => {
    setSearch("");
    const keep = new URLSearchParams();
    for (const key of ["attRange", "attFrom", "attTo", "sort", "dir"]) {
      const value = query.get(key);
      if (value) keep.set(key, value);
    }
    setPage(1);
    const qs = keep.toString();
    setLocation(qs ? `/dashboard/students?${qs}` : "/dashboard/students", { replace: true });
  };

  const toggleSort = (key: SortKey, numeric?: boolean) => {
    if (key === sortKey) writeQuery({ sort: key, dir: sortDir === 1 ? "desc" : undefined });
    else writeQuery({ sort: key === "name" ? undefined : key, dir: numeric ? "desc" : undefined });
  };

  const copyId = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id);
      toast({ title: "Student UUID copied", description: id });
    } catch {
      toast({ title: "Could not copy", description: id, variant: "destructive" });
    }
  };

  const handleExport = () => {
    exportCsv(
      `students-${new Date().toISOString().slice(0, 10)}.csv`,
      [
        "Student UUID",
        "Name",
        "Campus",
        "Section",
        "Semester",
        "Present",
        "Scheduled",
        "Attendance %",
        "Attendance tier",
        "Classroom quiz %",
        "Module quiz %",
        "SPI",
        "Skill level",
        "Skill debt",
      ],
      sorted.map((row) => [
        row.studentId,
        row.studentName,
        row.campus,
        row.sections.join(", "),
        row.semesters.join(", "),
        row.present,
        row.scheduled,
        row.attendancePct ?? "",
        row.tier ? ATTENDANCE_TIERS.find((tier) => tier.id === row.tier)?.label ?? "" : "",
        row.classroom ?? "",
        row.module ?? "",
        row.spi.toFixed(1),
        skillLabel(row.skill),
        row.skillDebt ? "Yes" : "No",
      ]),
    );
  };

  const periodText =
    period === "last_30"
      ? "Last 30 days"
      : period === "custom"
        ? customReady
          ? `${attFrom} to ${attTo}`
          : "Custom range"
        : "This semester so far";
  const scopeText = [
    campuses.length === 0 ? "All campuses" : campuses.length === 1 ? campuses[0] : `${campuses.length} campuses`,
    subjects.length === 1 ? subjects[0] : subjects.length > 1 ? `${subjects.length} subjects` : "",
  ].filter(Boolean).join(" · ");
  const multiCampus = campuses.length !== 1;
  const loadingTiles = isLoading || customPending;

  return (
    <div className="flex min-w-0 flex-col">
      <PageHeader
        title="Student Directory"
        subtitle={`Find a student or pull a filtered list · ${scopeText} · attendance for ${periodText}`}
        right={
          <div className="flex items-center gap-2">
            {isFetching && !isLoading && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
            <Button variant="outline" className="h-9 gap-2 border-gray-200" onClick={handleExport} disabled={sorted.length === 0}>
              <Download className="h-4 w-4" /> Export CSV
            </Button>
          </div>
        }
      />

      {/* ---- filters ---- */}
      <div className="flex flex-col gap-3 border-y border-slate-200 bg-white px-5 py-3">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Search">
            <div className="relative w-[280px]">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Name or student UUID"
                className="h-9 pl-9 normal-case tracking-normal"
              />
            </div>
          </Field>
          {!lockedCampus && (
            <Field label="Campus">
              <CheckMenu
                label={campuses.length ? `${campuses.length} selected` : "All campuses"}
                options={campusOptions.map((name) => ({ id: name, label: name }))}
                selected={campuses}
                onChange={(next) => writeQuery({ campuses: next.join("||") || undefined, sections: undefined })}
              />
            </Field>
          )}
          <Field label="Semester">
            <CheckMenu
              label={semesters.length ? `${semesters.length} selected` : "All semesters"}
              options={semesterOptions.map((name) => ({ id: name, label: name }))}
              selected={semesters}
              onChange={(next) => writeQuery({ semesters: next.join("||") || undefined, sections: undefined })}
            />
          </Field>
          <Field label="Section">
            <CheckMenu
              label={sections.length ? `${sections.length} selected` : campuses.length ? "All sections" : "Select a campus"}
              options={sectionChoices.map((item) => ({
                id: `${item.campus}\t${item.section}`,
                label: multiCampus ? `${item.campus} — ${item.section}` : item.section,
              }))}
              selected={sections}
              onChange={(next) => writeQuery({ sections: next.join("||") || undefined })}
            />
          </Field>
          <Field label="Subject">
            <CheckMenu
              label={subjects.length ? `${subjects.length} selected` : "All subjects"}
              options={subjectOptions.map((name) => ({ id: name, label: name }))}
              selected={subjects}
              onChange={(next) => writeQuery({ subjects: next.join("||") || undefined })}
            />
          </Field>
          <Field label="Attendance period">
            <div className="flex flex-wrap items-center gap-2">
              <SearchableSelect
                value={period}
                onValueChange={(value) => writeQuery({ attRange: value === "semester_to_date" ? undefined : value })}
                options={[
                  { value: "semester_to_date", label: "This semester so far" },
                  { value: "last_30", label: "Last 30 days" },
                  { value: "custom", label: "Custom range" },
                ]}
                className="w-[190px]"
              />
              {period === "custom" && (
                <>
                  <Input type="date" aria-label="Attendance from" className="h-9 w-[150px]" value={attFrom} onChange={(event) => writeQuery({ attFrom: event.target.value || undefined })} />
                  <Input type="date" aria-label="Attendance to" className="h-9 w-[150px]" value={attTo} onChange={(event) => writeQuery({ attTo: event.target.value || undefined })} />
                </>
              )}
            </div>
          </Field>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <GroupField label="Attendance tier">
            <div className="flex flex-wrap gap-1.5">
              {ATTENDANCE_TIERS.map((tier) => {
                const on = tiers.includes(tier.id);
                return (
                  <button
                    key={tier.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      writeQuery({
                        tiers: (on ? tiers.filter((id) => id !== tier.id) : [...tiers, tier.id]).join("||") || undefined,
                      })
                    }
                    className={cn(
                      "h-9 rounded-md border px-2.5 text-xs font-medium normal-case tracking-normal transition-colors",
                      on ? "border-transparent" : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50",
                    )}
                    style={on ? { background: tier.bg, color: tier.color, borderColor: tier.color } : undefined}
                  >
                    {tier.label} <span className="opacity-70">{tier.hint}</span>
                  </button>
                );
              })}
            </div>
          </GroupField>
          <Field label={`SPI points (0–10 · highest now ${maxSpi == null ? "—" : maxSpi.toFixed(1)})`}>
            <BoundControl
              scale="0–10"
              op={spiOp}
              a={spiA}
              b={spiB}
              onChange={(op, a, b) => writeQuery({ spiOp: op || undefined, spiA: op ? a || undefined : undefined, spiB: op === "between" ? b || undefined : undefined })}
            />
          </Field>
          <Field label="Quiz data">
            <SearchableSelect
              value={quiz || "any"}
              onValueChange={(value) => writeQuery({ quiz: value === "any" ? undefined : value })}
              options={[
                { value: "any", label: "Any" },
                { value: "missing_classroom", label: "No classroom quiz" },
                { value: "missing_module", label: "No module quiz" },
                { value: "missing_both", label: "No quizzes at all" },
              ]}
              className="w-[170px]"
            />
          </Field>
          <div className="flex items-end gap-2">
            <ToggleChip on={debtOnly} onClick={() => writeQuery({ debt: debtOnly ? undefined : "1" })}>
              Skill debt only
            </ToggleChip>
            <ToggleChip on={needsAttention} onClick={() => writeQuery({ attention: needsAttention ? undefined : "1" })}>
              Needs attention
            </ToggleChip>
            {activeCount > 0 && (
              <Button type="button" variant="ghost" size="sm" className="h-9 text-red-600 hover:text-red-700" onClick={clearAll}>
                Clear ({activeCount})
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* ---- summary ---- */}
      <div className="grid grid-cols-2 gap-px border-b border-slate-200 bg-slate-200 md:grid-cols-3 xl:grid-cols-6">
        <StatTile
          label="Students"
          value={loadingTiles ? null : summary.students.toLocaleString("en-IN")}
          hint={
            filtered.length > summary.students
              ? `${(filtered.length - summary.students).toLocaleString("en-IN")} listed under two campuses, so the table has ${filtered.length.toLocaleString("en-IN")} rows`
              : "Match these filters"
          }
        />
        <StatTile
          label="Avg attendance"
          value={loadingTiles ? null : fmtPct(summary.avgAttendance)}
          valueColor={summary.avgAttendance != null ? pctTextColor(summary.avgAttendance) : undefined}
          hint="Mean of student attendance"
        />
        <StatTile label="Eligible ≥80%" value={loadingTiles ? null : summary.eligible.toLocaleString("en-IN")} hint="Attendance" />
        <ClickTile active={tiers.length === 2 && tiers.includes("at_risk") && tiers.includes("ineligible")} onClick={() => writeQuery({ tiers: "at_risk||ineligible" })}>
          <StatTile
            label="Below 60%"
            value={loadingTiles ? null : summary.belowSixty.toLocaleString("en-IN")}
            valueColor={summary.belowSixty ? "#b91c1c" : undefined}
            hint="Click to list them"
          />
        </ClickTile>
        <StatTile
          label="Avg SPI"
          value={loadingTiles ? null : summary.avgSpi == null ? "—" : summary.avgSpi.toFixed(1)}
          hint="0–10 · classroom 10% + module 15% so far"
        />
        <ClickTile active={debtOnly} onClick={() => writeQuery({ debt: "1" })}>
          <StatTile
            label="Skill debt"
            value={loadingTiles ? null : summary.skillDebt.toLocaleString("en-IN")}
            valueColor={summary.skillDebt ? "#b91c1c" : undefined}
            hint="Click to list them"
          />
        </ClickTile>
      </div>

      {/* ---- table ---- */}
      {isError ? (
        <ErrorState message="Failed to load students." onRetry={() => refetch()} />
      ) : customPending ? (
        <p className="bg-white px-5 py-10 text-center text-sm text-slate-500">Pick both a start and an end date for the custom range.</p>
      ) : (
        <TableShell className="mt-4">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-b border-gray-200 bg-gray-50 hover:bg-gray-50">
                  {COLUMNS.map((column) => (
                    <TableHead
                      key={column.key}
                      className={cn("h-11 px-3 text-[11px] font-semibold uppercase tracking-wider text-gray-600", column.numeric && "text-right", column.className)}
                      aria-sort={sortKey === column.key ? (sortDir === 1 ? "ascending" : "descending") : undefined}
                    >
                      <button
                        type="button"
                        className={cn("inline-flex items-center gap-1 uppercase hover:text-gray-900", column.numeric && "flex-row-reverse")}
                        onClick={() => toggleSort(column.key, column.numeric)}
                      >
                        {column.label}
                        {sortKey === column.key && (sortDir === 1 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                      </button>
                    </TableHead>
                  ))}
                  <TableHead className="h-11 min-w-[80px] px-3 text-right text-[11px] font-semibold uppercase tracking-wider text-gray-600">Report</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <TableRow key={i} className="border-b border-gray-100">
                      {Array.from({ length: COLUMNS.length + 1 }).map((__, j) => (
                        <TableCell key={j} className="py-3">
                          <Skeleton className="h-5 w-full max-w-[160px]" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : paged.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={COLUMNS.length + 1} className="h-24 text-center text-gray-500">
                      No students match these filters.
                    </TableCell>
                  </TableRow>
                ) : (
                  paged.map((row) => {
                    const tier = ATTENDANCE_TIERS.find((item) => item.id === row.tier);
                    const spiPath = data?.spiPaths[row.studentId];
                    return (
                      <TableRow key={row.key} className="border-b border-gray-200 hover:bg-gray-50">
                        <TableCell className="py-3">
                          <div className="max-w-[240px] truncate font-medium text-gray-900" title={row.studentName}>
                            {row.studentName || "—"}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-xs text-gray-600">{row.studentId}</span>
                            <button
                              type="button"
                              onClick={() => copyId(row.studentId)}
                              className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                              aria-label={`Copy UUID for ${row.studentName}`}
                              title="Copy UUID"
                            >
                              <Copy className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </TableCell>
                        <TableCell className="text-gray-600">
                          <div className="max-w-[240px] truncate" title={row.campus}>{row.campus}</div>
                        </TableCell>
                        <TableCell className="text-gray-600">{row.sections.join(", ") || "—"}</TableCell>
                        <TableCell className="text-gray-600">{row.semesters.join(", ") || "—"}</TableCell>
                        <TableCell className="whitespace-nowrap text-right">
                          <span className="tabular-nums">
                            <span className="font-bold" style={row.attendancePct != null ? { color: pctTextColor(row.attendancePct) } : undefined}>
                              {fmtPct(row.attendancePct)}
                            </span>
                            {row.scheduled > 0 && (
                              <span className="ml-1 text-xs text-gray-400">({row.present}/{row.scheduled})</span>
                            )}
                          </span>
                          {tier && (
                            <span className="ml-2 rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: tier.bg, color: tier.color }}>
                              {tier.label}
                            </span>
                          )}
                        </TableCell>
                        <PctCell value={row.classroom} />
                        <PctCell value={row.module} />
                        <TableCell className="text-right font-semibold tabular-nums text-gray-900">{row.spi.toFixed(1)}</TableCell>
                        <TableCell className={cn("whitespace-nowrap text-right text-sm font-semibold", skillTone(row.skill))}>
                          {skillLabel(row.skill)}
                        </TableCell>
                        <TableCell className="text-right">
                          {spiPath ? (
                            <a
                              href={spiPath}
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
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
          {!isLoading && sorted.length > 0 && (
            <TablePagination
              page={currentPage}
              totalPages={totalPages}
              totalItems={sorted.length}
              pageSize={pageSize}
              pageSizeOptions={PAGE_SIZES}
              onPageChange={setPage}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(1);
              }}
              itemLabel={sorted.length > summary.students ? "rows" : "students"}
            />
          )}
        </TableShell>
      )}
    </div>
  );
}

function PctCell({ value }: { value: number | null }) {
  return (
    <TableCell className="text-right">
      {value == null ? (
        <span className="text-gray-300">—</span>
      ) : (
        <span className="font-semibold tabular-nums" style={{ color: pctTextColor(value) }}>
          {value.toFixed(1)}%
        </span>
      )}
    </TableCell>
  );
}

function GroupField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex shrink-0 flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{label}</span>
      {children}
    </div>
  );
}

function ToggleChip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "h-9 rounded-md border px-3 text-xs font-medium transition-colors",
        on ? "border-brand-600 bg-brand-50 text-brand-700" : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50",
      )}
    >
      {children}
    </button>
  );
}

function ClickTile({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("block h-full w-full text-left", active && "ring-2 ring-inset ring-brand-600")}
    >
      {children}
    </button>
  );
}
