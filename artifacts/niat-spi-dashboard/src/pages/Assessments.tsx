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
import { ColumnOrderList, moveListItem } from "@/components/ColumnOrderList";
import { BoundControl, CheckMenu } from "@/components/SpiRecordFilterBar";
import { ChevronRight, Download, ExternalLink, Lock } from "lucide-react";
import { pctColor, pctTextColor } from "@/lib/utils";
import { useQueryParams } from "@/hooks/useQueryParams";
import { omitExcludedInstitutes } from "@/lib/excludedInstitutes";
import { exportCsv } from "@/lib/csv";
import { useAuth } from "@/contexts/AuthContext";
import {
  assessmentHeader,
  buildAssessmentRows,
  countsFromStudentWork,
  distinctStudents,
  filterRoster,
  filterSlots,
  finishCounts,
  parseScoreBound,
  passesScore,
  selectTypes,
  type AssessmentCounts,
  type AssessmentType,
  type AssessmentGrain,
  type AssessmentRosterRow,
  type AssessmentSlot,
  type AssessmentViewRow,
} from "@/lib/assessmentAggregate";
import { keepPreviousData, useQuery } from "@tanstack/react-query";

const PAGE_SIZES = [25, 50, 100];
// v2 adds the score columns; a saved v1 layout would hide them.
const COLUMN_KEY = "assessment-columns-v2";

type Grain = AssessmentGrain;
type BoundOp = "" | "gte" | "lte" | "between";
type ColumnId = "students" | "cq" | "cqPct" | "cqAvg" | "mq" | "mqPct" | "mqAvg" | "total" | "overall" | "avg";

const ALL_COLUMNS: ColumnId[] = ["students", "cq", "cqPct", "cqAvg", "mq", "mqPct", "mqAvg", "total", "overall", "avg"];
const DEFAULT_COLUMNS: ColumnId[] = ALL_COLUMNS;
const COLUMN_LABEL: Record<ColumnId, string> = {
  students: "Students",
  cq: "CQ attempted",
  cqPct: "CQ completion",
  cqAvg: "CQ avg score",
  mq: "MQ attempted",
  mqPct: "MQ completion",
  mqAvg: "MQ avg score",
  total: "Total attempted",
  overall: "Overall completion",
  avg: "Avg score",
};
/** Columns that belong to one quiz type; hidden when that type is filtered out. */
const COLUMN_TYPE: Partial<Record<ColumnId, AssessmentType>> = {
  cq: "cq",
  cqPct: "cq",
  cqAvg: "cq",
  mq: "mq",
  mqPct: "mq",
  mqAvg: "mq",
};
const ALL_TYPES: AssessmentType[] = ["cq", "mq"];

interface DetailPayload {
  slots: AssessmentSlot[];
  roster: AssessmentRosterRow[];
}

interface StudentApiRow extends AssessmentCounts {
  studentId: string;
  studentName: string;
  instituteName: string;
  semester: string;
  sectionName: string;
  spiPath: string;
}

/** The API sends score sums as cq/mq*; fold them into the shared counts shape. */
function normalizeStudentRow(
  row: Omit<StudentApiRow, "classroomScoreSum" | "classroomScoreN" | "moduleScoreSum" | "moduleScoreN" | "classroomAvgScore" | "moduleAvgScore" | "avgScore"> & {
    cqScoreSum?: number;
    cqScoreN?: number;
    mqScoreSum?: number;
    mqScoreN?: number;
  },
): StudentApiRow {
  return {
    ...row,
    ...finishCounts({
      classroomCompleted: row.classroomCompleted,
      classroomTotal: row.classroomTotal,
      moduleCompleted: row.moduleCompleted,
      moduleTotal: row.moduleTotal,
      classroomStudentCompleted: row.classroomStudentCompleted,
      classroomStudentTotal: row.classroomStudentTotal,
      moduleStudentCompleted: row.moduleStudentCompleted,
      moduleStudentTotal: row.moduleStudentTotal,
      classroomScoreSum: row.cqScoreSum ?? 0,
      classroomScoreN: row.cqScoreN ?? 0,
      moduleScoreSum: row.mqScoreSum ?? 0,
      moduleScoreN: row.mqScoreN ?? 0,
    }),
  };
}

function splitList(value: string | null): string[] {
  if (!value) return [];
  return value.split("||").map((item) => item.trim()).filter(Boolean);
}

function loadColumns(): ColumnId[] {
  try {
    const raw = localStorage.getItem(COLUMN_KEY);
    if (!raw) return DEFAULT_COLUMNS;
    const parsed = JSON.parse(raw) as ColumnId[];
    const known = new Set(ALL_COLUMNS);
    const next = parsed.filter((id) => known.has(id));
    return next.length ? next : DEFAULT_COLUMNS;
  } catch {
    return DEFAULT_COLUMNS;
  }
}

export default function Assessments() {
  const [location, setLocation] = useLocation();
  const path = location.split("?")[0] ?? location;

  useEffect(() => {
    if (!path.startsWith("/dashboard/assessments/")) return;
    const params = new URLSearchParams(location.split("?")[1] ?? "");
    const next = new URLSearchParams();
    if (path.includes("/students")) next.set("group", "student");
    else if (path.includes("/subjects")) next.set("group", "subject");
    const campus = params.get("campus");
    const semester = params.get("semester");
    if (campus && campus !== "all") next.set("campuses", campus);
    if (semester) next.set("semesters", semester);
    const subject = params.get("subject");
    if (subject) next.set("subject", subject);
    const qs = next.toString();
    setLocation(qs ? `/dashboard/assessments?${qs}` : "/dashboard/assessments");
  }, [path, location, setLocation]);

  if (path.startsWith("/dashboard/assessments/")) return null;
  return <AssessmentsPage />;
}

function AssessmentsPage() {
  const { user } = useAuth();
  const isBoa = user?.role === "boa";
  const hideCampus = Boolean(isBoa && user?.campuses?.length === 1);
  const [, setLocation] = useLocation();
  const query = useQueryParams();
  const grain = parseGrain(query.get("group"));
  const legacyCampus = query.get("campus");
  const campuses = splitList(query.get("campuses")).length
    ? splitList(query.get("campuses"))
    : legacyCampus && legacyCampus !== "all"
      ? [legacyCampus]
      : [];
  const legacySemester = query.get("semester");
  const semesters = splitList(query.get("semesters")).length
    ? splitList(query.get("semesters"))
    : legacySemester
      ? [legacySemester]
      : [];
  const sections = splitList(query.get("sections")).map((value) => {
    const [campus, section] = value.split("\t");
    return { campus: campus ?? "", section: section ?? "" };
  }).filter((item) => item.campus && item.section);
  const legacySubject = query.get("subject") || "";
  const subjects = splitList(query.get("subjects")).length
    ? splitList(query.get("subjects"))
    : legacySubject
      ? [legacySubject]
      : [];
  const typesParam = splitList(query.get("types")).filter((id): id is AssessmentType => id === "cq" || id === "mq");
  const types: AssessmentType[] = typesParam.length ? typesParam : ALL_TYPES;
  const rawScoreOp = query.get("scoreOp") || "";
  const scoreOp = (["gte", "lte", "between"].includes(rawScoreOp) ? rawScoreOp : "") as BoundOp;
  const scoreA = query.get("scoreA") || "";
  const scoreB = query.get("scoreB") || "";
  const scoreBound = parseScoreBound(scoreOp, scoreA, scoreB);
  const students = splitList(query.get("students")).map((value) => {
    const [studentId, campus, studentName] = value.split("\t");
    return { studentId: studentId ?? "", campus: campus ?? "", studentName: studentName ?? "" };
  }).filter((item) => item.studentId);

  const [studentQuery, setStudentQuery] = useState("");
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(1);
  const [columns, setColumns] = useState<ColumnId[]>(loadColumns);
  const [draftColumns, setDraftColumns] = useState<ColumnId[]>(columns);
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
    if ("subjects" in patch) params.delete("subject");
    const qs = params.toString();
    setPage(1);
    setLocation(qs ? `/dashboard/assessments?${qs}` : "/dashboard/assessments");
  };

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["assessment-detail"],
    queryFn: async () => {
      const res = await fetch("/api/dashboard/assessment-detail", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load assessments");
      return res.json() as Promise<DetailPayload>;
    },
    placeholderData: keepPreviousData,
    staleTime: 15 * 60_000,
  });

  const fetchStudentsByCampus = grain === "student" && campuses.length > 0;
  const fetchStudentsById = students.length > 0 && !fetchStudentsByCampus;
  const studentParams = new URLSearchParams();
  if (fetchStudentsByCampus) studentParams.set("campuses", campuses.join("||"));
  else if (fetchStudentsById) studentParams.set("students", students.map((item) => item.studentId).join("||"));
  if (subjects.length && (fetchStudentsByCampus || fetchStudentsById)) studentParams.set("subjects", subjects.join("||"));
  const studentEnabled = fetchStudentsByCampus || fetchStudentsById;
  const {
    data: studentRows,
    isLoading: studentLoading,
    isError: studentError,
    refetch: refetchStudents,
  } = useQuery({
    queryKey: ["assessment-student-rows", studentParams.toString()],
    enabled: studentEnabled,
    queryFn: async () => {
      const res = await fetch(`/api/dashboard/assessment-student-rows?${studentParams.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load students");
      const rows = (await res.json()) as Parameters<typeof normalizeStudentRow>[0][];
      return rows.map(normalizeStudentRow);
    },
    placeholderData: keepPreviousData,
    staleTime: 15 * 60_000,
  });

  const campusOptions = useMemo(() => {
    if (isBoa && user?.campuses?.length === 1) return omitExcludedInstitutes(user.campuses);
    const names = new Set((data?.roster ?? []).map((row) => row.instituteName));
    return omitExcludedInstitutes([...names].sort((left, right) => left.localeCompare(right)));
  }, [data, isBoa, user?.campuses]);
  const semesterOptions = useMemo(() => {
    const campusSet = new Set(campuses);
    const names = new Set<string>();
    for (const row of data?.roster ?? []) {
      if (campusSet.size && !campusSet.has(row.instituteName)) continue;
      names.add(row.semester);
    }
    return [...names].sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
  }, [data, campuses]);
  const sectionChoices = useMemo(() => {
    if (!campuses.length) return [];
    const campusSet = new Set(campuses);
    const semesterSet = new Set(semesters);
    const seen = new Set<string>();
    const list: { campus: string; section: string }[] = [];
    for (const row of data?.roster ?? []) {
      if (!campusSet.has(row.instituteName)) continue;
      if (semesterSet.size && !semesterSet.has(row.semester)) continue;
      const key = `${row.instituteName}\t${row.section}`;
      if (seen.has(key)) continue;
      seen.add(key);
      list.push({ campus: row.instituteName, section: row.section });
    }
    return list.sort((left, right) => left.section.localeCompare(right.section, undefined, { numeric: true }));
  }, [data, campuses, semesters]);

  const subjectOptions = useMemo(() => {
    const campusSet = new Set(campuses);
    const semesterSet = new Set(semesters);
    const sectionSet = new Set(sections.map((item) => `${item.campus}\t${item.section}`));
    const names = new Set<string>();
    for (const slot of data?.slots ?? []) {
      if (campusSet.size && !campusSet.has(slot.instituteName)) continue;
      if (semesterSet.size && !semesterSet.has(slot.semester)) continue;
      if (sectionSet.size && !sectionSet.has(`${slot.instituteName}\t${slot.section}`)) continue;
      const name = slot.subject.trim();
      if (name && name.toLowerCase() !== "null") names.add(slot.subject);
    }
    return [...names].sort((left, right) => left.localeCompare(right));
  }, [data, campuses.join("||"), semesters.join("||"), sections.map((item) => `${item.campus}\t${item.section}`).join("||")]);

  useEffect(() => {
    if (!semesterOptions.length || !semesters.length) return;
    const kept = semesters.filter((name) => semesterOptions.includes(name));
    if (kept.length === semesters.length) return;
    writeQuery({ semesters: kept.join("||") || undefined });
  }, [semesterOptions.join("|"), semesters.join("||")]);

  const scope = {
    campuses,
    semesters,
    sections: sections.map((item) => `${item.campus}\t${item.section}`),
    subjects,
  };
  const filteredSlots = useMemo(
    () => filterSlots(data?.slots ?? [], scope),
    [data, campuses.join("||"), semesters.join("||"), scope.sections.join("||"), subjects.join("||")],
  );
  const rosterForCounts = useMemo(
    () => filterRoster(data?.roster ?? [], scope),
    [data, campuses.join("||"), semesters.join("||"), scope.sections.join("||")],
  );
  const studentKeys = students.map((item) => `${item.campus}\t${item.studentId}`);
  const headerStudents = distinctStudents(
    filterRoster(data?.roster ?? [], scope, studentKeys),
  );
  const slotHeader = assessmentHeader(filteredSlots);
  const selectedStudentRows = useMemo(() => {
    if (!students.length) return [];
    const keys = new Set(studentKeys);
    const seen = new Set<string>();
    const rows: StudentApiRow[] = [];
    for (const row of studentRows ?? []) {
      const key = `${row.instituteName}\t${row.studentId}`;
      if (!keys.has(key) || seen.has(key)) continue;
      if (semesters.length && !semesters.includes(row.semester)) continue;
      if (scope.sections.length && !scope.sections.includes(`${row.instituteName}\t${row.sectionName}`)) continue;
      seen.add(key);
      rows.push(row);
    }
    return rows;
  }, [studentRows, studentKeys.join("||"), semesters.join("||"), scope.sections.join("||")]);
  const typeKey = types.join("||");
  const scoreKey = scoreBound ? `${scoreBound.min}:${scoreBound.max}` : "";

  const viewRows = useMemo(
    () =>
      grain === "student"
        ? []
        : buildAssessmentRows(filteredSlots, rosterForCounts, grain)
            .map((row) => ({ ...row, counts: selectTypes(row.counts, types) }))
            .filter((row) => passesScore(row.counts, scoreBound)),
    [filteredSlots, rosterForCounts, grain, typeKey, scoreKey],
  );
  const visibleStudents = useMemo(() => {
    const campusSet = new Set(campuses);
    const semesterSet = new Set(semesters);
    const sectionSet = new Set(scope.sections);
    const studentSet = new Set(studentKeys);
    const seen = new Set<string>();
    const rows: StudentApiRow[] = [];
    for (const row of studentRows ?? []) {
      if (campusSet.size && !campusSet.has(row.instituteName)) continue;
      if (semesterSet.size && !semesterSet.has(row.semester)) continue;
      if (sectionSet.size && !sectionSet.has(`${row.instituteName}\t${row.sectionName}`)) continue;
      if (studentSet.size && !studentSet.has(`${row.instituteName}\t${row.studentId}`)) continue;
      const key = `${row.instituteName}\t${row.studentId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const typed = { ...row, ...selectTypes(row, types) };
      if (!passesScore(typed, scoreBound)) continue;
      rows.push(typed);
    }
    return rows.sort((left, right) => left.completionPct - right.completionPct || left.studentName.localeCompare(right.studentName));
  }, [studentRows, campuses.join("||"), semesters.join("||"), scope.sections.join("||"), studentKeys.join("||"), typeKey, scoreKey]);

  // With a score filter the tiles add up the rows that pass it (student work), so they match the table.
  const headerCounts = selectTypes(
    scoreBound
      ? countsFromStudentWork(grain === "student" ? visibleStudents : viewRows.map((row) => row.counts))
      : students.length && selectedStudentRows.length
        ? countsFromStudentWork(selectedStudentRows)
        : slotHeader,
    types,
  );
  const uniqueTiles = !scoreBound && students.length === 0;

  const tableCount = grain === "student" ? visibleStudents.length : viewRows.length;
  const totalPages = Math.max(1, Math.ceil(tableCount / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pagedRows = viewRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const pagedStudents = visibleStudents.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const catalog = useMemo(() => {
    const q = studentQuery.trim().toLowerCase();
    if (q.length < 2) return [];
    const seen = new Set<string>();
    const hits: { studentId: string; studentName: string; campus: string; section: string }[] = [];
    for (const row of rosterForCounts) {
      const key = `${row.instituteName}\t${row.studentId}`;
      if (seen.has(key)) continue;
      if (!row.studentName.toLowerCase().includes(q) && !row.studentId.toLowerCase().includes(q)) continue;
      seen.add(key);
      hits.push({
        studentId: row.studentId,
        studentName: row.studentName,
        campus: row.instituteName,
        section: row.section,
      });
      if (hits.length >= 20) break;
    }
    return hits;
  }, [rosterForCounts, studentQuery]);

  const multiCampus = campuses.length !== 1;
  const visibleColumns = columns.filter((id) => {
    if (grain === "student" && id === "students") return false;
    const type = COLUMN_TYPE[id];
    return !type || types.includes(type);
  });
  const columnOrder = [...draftColumns, ...ALL_COLUMNS.filter((id) => !draftColumns.includes(id))];

  const applyColumns = () => {
    const next = columnOrder.filter((id) => draftColumns.includes(id));
    const saved = next.length ? next : DEFAULT_COLUMNS;
    setColumns(saved);
    localStorage.setItem(COLUMN_KEY, JSON.stringify(saved));
    setColumnsOpen(false);
  };

  const exportView = () => {
    if (grain === "student") {
      exportCsv(
        "assessment-students.csv",
        [...identityHeaders("student", multiCampus), ...visibleColumns.map((id) => COLUMN_LABEL[id])],
        visibleStudents.map((row) => [
          row.studentName,
          ...(multiCampus ? [row.instituteName] : []),
          row.sectionName,
          ...visibleColumns.map((id) => studentCell(row, id)),
        ]),
      );
      return;
    }
    exportCsv(
      "assessment-view.csv",
      [...identityHeaders(grain, multiCampus), ...visibleColumns.map((id) => COLUMN_LABEL[id])],
      viewRows.map((row) => [
        ...identityValues(row, grain),
        ...visibleColumns.map((id) => viewCell(row, id)),
      ]),
    );
  };

  const exportAll = () => {
    const allSlots = filterSlots(data?.slots ?? [], { campuses: [], semesters, sections: [], subjects });
    const allRoster = filterRoster(data?.roster ?? [], { campuses: [], semesters, sections: [] });
    const rows = buildAssessmentRows(
      allSlots,
      allRoster,
      grain === "student" ? "campus" : grain,
    )
      .map((row) => ({ ...row, counts: selectTypes(row.counts, types) }))
      .filter((row) => passesScore(row.counts, scoreBound));
    exportCsv(
      "assessment-all-campuses.csv",
      [...identityHeaders(grain === "student" ? "campus" : grain), ...visibleColumns.map((id) => COLUMN_LABEL[id])],
      rows.map((row) => [
        ...identityValues(row, grain === "student" ? "campus" : grain),
        ...visibleColumns.map((id) => viewCell(row, id)),
      ]),
    );
  };

  const subtitle = [
    campusScopeLabel(campuses, campusOptions),
    semesterScopeLabel(semesters, semesterOptions),
    subjects.length === 1 ? subjects[0] : subjects.length > 1 ? `${subjects.length} subjects` : "",
    `${isLoading && !data ? "—" : headerStudents.toLocaleString("en-IN")} students`,
  ].filter(Boolean).join(" · ");
  const tableLoading = isLoading || (grain === "student" && studentEnabled && studentLoading && !studentRows);
  const showStudentPrompt = grain === "student" && campuses.length === 0 && students.length === 0;

  const toolbar = (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Popover
        open={columnsOpen}
        onOpenChange={(open) => {
          setColumnsOpen(open);
          if (open) setDraftColumns(columns);
        }}
      >
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" size="sm">Columns</Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72">
          <p className="mb-2 text-xs text-gray-500">Drag to set the column order.</p>
          <ColumnOrderList
            ids={columnOrder}
            label={(id) => COLUMN_LABEL[id]}
            checked={(id) => draftColumns.includes(id)}
            onToggle={(id) =>
              setDraftColumns((current) =>
                current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
              )
            }
            onReorder={(from, to) => {
              const next = moveListItem(columnOrder, from, to);
              setDraftColumns(next.filter((id) => draftColumns.includes(id)));
            }}
          />
          <div className="mt-3">
            <Button type="button" size="sm" onClick={applyColumns}>Apply</Button>
          </div>
        </PopoverContent>
      </Popover>
      <Button type="button" variant="outline" size="sm" disabled={tableCount === 0 || tableLoading} onClick={exportView}>
        <Download className="mr-1 h-4 w-4" /> Export this view
      </Button>
      <Button type="button" variant="outline" size="sm" disabled={isLoading || grain === "student"} onClick={exportAll}>
        <Download className="mr-1 h-4 w-4" /> Export all campuses
      </Button>
    </div>
  );

  return (
    <div className="flex min-w-0 flex-col">
      <PageHeader title="Assessments" subtitle={subtitle} right={toolbar} />
      {isLoading && !data ? (
        <div className="mb-4 mt-4">
          <Skeleton className="h-24 w-full" />
        </div>
      ) : (
        <div className="mt-4">
          <SummaryStrip totals={headerCounts} uniqueCounts={uniqueTiles} types={types} />
        </div>
      )}
      <div className="mb-4 flex flex-nowrap items-end gap-3 overflow-x-auto pb-1">
        <FilterField label="Group by">
          <SearchableSelect
            value={grain}
            onValueChange={(value) => writeQuery({ group: value === "campus" ? undefined : value })}
            options={[
              { value: "campus", label: "Campus-wise" },
              { value: "subject", label: "Subject-wise" },
              { value: "section", label: "Section-wise" },
              { value: "semester", label: "Semester-wise" },
              { value: "student", label: "Student-wise" },
            ]}
            placeholder="Group by"
            searchPlaceholder="Search…"
            className="w-[180px]"
          />
        </FilterField>
        {!hideCampus && (
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
                const [campus, section] = id.split("\t");
                return { campus: campus ?? "", section: section ?? "" };
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
        <FilterField label="Student">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="w-[180px] justify-between">
                {students.length ? `${students.length} selected` : "All students"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72" align="start">
              <Input
                value={studentQuery}
                placeholder="Search name or ID"
                onChange={(event) => setStudentQuery(event.target.value)}
              />
              <div className="mt-2 max-h-56 space-y-1 overflow-y-auto">
                {catalog.map((hit) => {
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
                        <span className="block text-xs text-gray-500">{hit.campus} — {hit.section}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </PopoverContent>
          </Popover>
        </FilterField>
        <FilterField label="Subject">
          <CheckMenu
            label={subjects.length ? `${subjects.length} selected` : "All subjects"}
            options={subjectOptions.map((name) => ({ id: name, label: name }))}
            selected={subjects}
            onChange={(next) => writeQuery({ subjects: next.join("||") || undefined })}
          />
        </FilterField>
        <TypeMenu
          selected={types}
          onChange={(next) =>
            writeQuery({ types: next.length === ALL_TYPES.length || next.length === 0 ? undefined : next.join("||") })
          }
        />
        <FilterField label="Avg score (0–100%)">
          <BoundControl
            name="Avg score %"
            min={0}
            max={100}
            op={scoreOp}
            a={scoreA}
            b={scoreB}
            onChange={(op, a, b) =>
              writeQuery({
                scoreOp: op || undefined,
                scoreA: op ? a || undefined : undefined,
                scoreB: op === "between" ? b || undefined : undefined,
              })
            }
          />
        </FilterField>
        <Button
          type="button"
          variant="outline"
          className="h-9"
          onClick={() => writeQuery({
            campuses: undefined,
            semesters: undefined,
            sections: undefined,
            students: undefined,
            campus: undefined,
            semester: undefined,
            subject: undefined,
            subjects: undefined,
            types: undefined,
            scoreOp: undefined,
            scoreA: undefined,
            scoreB: undefined,
          })}
        >
          Clear
        </Button>
      </div>

      {isError && (
        <div className="mb-4">
          <ErrorState message="Failed to load assessments." onRetry={() => void refetch()} />
        </div>
      )}
      {grain === "student" && studentError && (
        <div className="mb-4">
          <ErrorState message="Failed to load student assessments." onRetry={() => void refetchStudents()} />
        </div>
      )}

      <TableShell>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-gray-200 bg-gray-50 hover:bg-gray-50">
                {identityHeaders(grain, multiCampus).map((label) => (
                  <Th key={label}>{label}</Th>
                ))}
                {visibleColumns.map((id) => (
                  <Th key={id} className="text-right">{COLUMN_LABEL[id]}</Th>
                ))}
                {grain === "student" ? <Th className="w-20 text-right">SPI</Th> : <Th className="w-10" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {tableLoading ? (
                Array.from({ length: 8 }).map((_, index) => (
                  <TableRow key={index}>
                    <TableCell colSpan={identityHeaders(grain, multiCampus).length + visibleColumns.length + 1}>
                      <Skeleton className="h-8 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : showStudentPrompt ? (
                <TableRow>
                  <TableCell colSpan={identityHeaders(grain, multiCampus).length + visibleColumns.length + 1} className="h-32 text-center text-gray-500">
                    Select a campus to see student-wise assessments.
                  </TableCell>
                </TableRow>
              ) : grain === "student" ? (
                pagedStudents.length === 0 ? (
                  <EmptyRow span={identityHeaders(grain, multiCampus).length + visibleColumns.length + 1} message="No students found." />
                ) : (
                  pagedStudents.map((row) => (
                    <TableRow key={`${row.instituteName}-${row.studentId}`} className="border-b border-gray-200 hover:bg-gray-50">
                      <TableCell className="py-3 font-medium text-gray-900">{row.studentName}</TableCell>
                      {multiCampus && <TableCell className="text-gray-600">{row.instituteName}</TableCell>}
                      <TableCell className="text-gray-600">{row.sectionName || "—"}</TableCell>
                      {visibleColumns.map((id) => (
                        <TableCell key={id} className="text-right">
                          <MetricCell id={id} counts={row} students={null} />
                        </TableCell>
                      ))}
                      <TableCell className="text-right">
                        <a href={row.spiPath} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:text-brand-700 hover:underline">
                          Open <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </TableCell>
                    </TableRow>
                  ))
                )
              ) : pagedRows.length === 0 ? (
                <EmptyRow span={identityHeaders(grain, multiCampus).length + visibleColumns.length + 1} message="No rows for this view." />
              ) : (
                pagedRows.map((row) => (
                  <TableRow
                    key={row.key}
                    className="cursor-pointer border-b border-gray-200 hover:bg-brand-50/40"
                    onClick={() => drill(row, grain, writeQuery)}
                  >
                    {identityValues(row, grain).map((value, index) => (
                      <TableCell key={`${row.key}-${index}`} className={index === 0 ? "py-3 font-medium text-gray-900" : "text-gray-600"}>
                        {value}
                      </TableCell>
                    ))}
                    {visibleColumns.map((id) => (
                      <TableCell key={id} className="text-right">
                        <MetricCell id={id} counts={row.counts} students={id === "students" ? row.studentCount : null} />
                      </TableCell>
                    ))}
                    <TableCell className="text-right text-gray-300">
                      <ChevronRight className="ml-auto h-4 w-4" />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        {!tableLoading && tableCount > 0 && !showStudentPrompt && (
          <TablePagination
            page={currentPage}
            totalPages={totalPages}
            totalItems={tableCount}
            pageSize={pageSize}
            pageSizeOptions={PAGE_SIZES}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
            itemLabel={grain === "student" ? "students" : "rows"}
          />
        )}
      </TableShell>
    </div>
  );
}

function drill(
  row: AssessmentViewRow,
  grain: Exclude<Grain, "student">,
  writeQuery: (patch: Record<string, string | undefined>) => void,
) {
  if (grain === "campus") {
    writeQuery({ campuses: row.university, group: "subject", sections: undefined, students: undefined, subjects: undefined });
    return;
  }
  if (grain === "subject") {
    writeQuery({
      campuses: row.university,
      group: "student",
      subjects: row.subject ?? undefined,
      sections: undefined,
      students: undefined,
    });
    return;
  }
  if (grain === "section") {
    writeQuery({
      campuses: row.university,
      sections: `${row.university}\t${row.section ?? ""}`,
      group: "student",
      students: undefined,
    });
    return;
  }
  writeQuery({ semesters: row.semester ?? undefined, campuses: row.university });
}

function parseGrain(value: string | null): Grain {
  if (value === "subject" || value === "section" || value === "semester" || value === "student") return value;
  return "campus";
}

function identityHeaders(grain: Grain, multiCampus = false): string[] {
  if (grain === "semester") return ["Campus", "Semester"];
  if (grain === "section") return ["Campus", "Section"];
  if (grain === "subject") return ["Campus", "Subject"];
  if (grain === "student") return multiCampus ? ["Student name", "Campus", "Section"] : ["Student name", "Section"];
  return ["Campus"];
}

function identityValues(row: AssessmentViewRow, grain: Exclude<Grain, "student">): string[] {
  if (grain === "semester") return [row.university, row.semester ?? ""];
  if (grain === "section") return [row.university, row.section ?? ""];
  if (grain === "subject") return [row.university, row.subject ?? ""];
  return [row.university];
}

const NONE_ASSIGNED = "No quizzes assigned";
const NOT_ATTEMPTED = "Not attempted";

/** Assigned and completed quizzes for a column's quiz type (overall for the combined columns). */
function columnParts(counts: AssessmentCounts, id: ColumnId): {
  completed: number;
  total: number;
  studentTotal: number;
  pct: number;
  avg: number | null;
} {
  if (id === "cq" || id === "cqPct" || id === "cqAvg") {
    return {
      completed: counts.classroomCompleted,
      total: counts.classroomTotal,
      studentTotal: counts.classroomStudentTotal,
      pct: counts.classroomPct,
      avg: counts.classroomAvgScore,
    };
  }
  if (id === "mq" || id === "mqPct" || id === "mqAvg") {
    return {
      completed: counts.moduleCompleted,
      total: counts.moduleTotal,
      studentTotal: counts.moduleStudentTotal,
      pct: counts.modulePct,
      avg: counts.moduleAvgScore,
    };
  }
  return {
    completed: counts.totalCompleted,
    total: counts.totalAssigned,
    studentTotal: counts.classroomStudentTotal + counts.moduleStudentTotal,
    pct: counts.completionPct,
    avg: counts.avgScore,
  };
}

/** Plain-text cell for CSV export; says why a value is empty. */
function exportCell(counts: AssessmentCounts, id: ColumnId, studentCount?: number): string | number {
  if (id === "students") return studentCount ?? "";
  const part = columnParts(counts, id);
  if (part.total <= 0) return NONE_ASSIGNED;
  if (id === "cq" || id === "mq" || id === "total") return `${part.completed}/${part.total}`;
  if (id === "cqPct" || id === "mqPct" || id === "overall") return part.studentTotal > 0 ? part.pct : NONE_ASSIGNED;
  return part.avg ?? NOT_ATTEMPTED;
}

function viewCell(row: AssessmentViewRow, id: ColumnId): string | number {
  return exportCell(row.counts, id, row.studentCount);
}

function studentCell(row: AssessmentCounts, id: ColumnId): string | number {
  return exportCell(row, id);
}

function MetricCell({
  id,
  counts,
  students,
}: {
  id: ColumnId;
  counts: AssessmentCounts;
  students: number | null;
}) {
  if (id === "students") return <span className="tabular-nums text-gray-600">{(students ?? 0).toLocaleString()}</span>;
  const part = columnParts(counts, id);
  if (part.total <= 0) return <EmptyNote text={NONE_ASSIGNED} />;
  if (id === "cq" || id === "mq" || id === "total") return <CountCell completed={part.completed} total={part.total} />;
  if (id === "cqPct" || id === "mqPct") {
    return part.studentTotal > 0
      ? <span className="font-semibold tabular-nums" style={{ color: pctTextColor(part.pct) }}>{part.pct}%</span>
      : <EmptyNote text={NONE_ASSIGNED} />;
  }
  if (id === "overall") return <PctBar pct={part.pct} />;
  if (part.avg == null) return <EmptyNote text={NOT_ATTEMPTED} />;
  return <span className="font-semibold tabular-nums" style={{ color: pctTextColor(part.avg) }}>{part.avg.toFixed(1)}%</span>;
}

function EmptyRow({ span, message }: { span: number; message: string }) {
  return (
    <TableRow>
      <TableCell colSpan={span} className="h-32 text-center text-gray-500">{message}</TableCell>
    </TableRow>
  );
}

function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex shrink-0 flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
      {label}
      {children}
    </label>
  );
}

function campusScopeLabel(selected: string[], options: string[]): string {
  if (!selected.length) return "All campuses";
  const everyCampus = options.length > 0 && options.every((name) => selected.includes(name));
  if (everyCampus) return `${options.length.toLocaleString("en-IN")} campuses`;
  return selected.join(", ");
}

function semesterScopeLabel(selected: string[], options: string[]): string {
  if (!selected.length) return "Current semesters";
  const every = options.length > 0 && options.every((name) => selected.includes(name));
  if (every) return `${options.length.toLocaleString("en-IN")} semesters`;
  return selected.join(", ");
}

function SummaryStrip({
  totals,
  uniqueCounts = false,
  types,
}: {
  totals: AssessmentCounts;
  uniqueCounts?: boolean;
  types: AssessmentType[];
}) {
  const both = types.includes("cq") && types.includes("mq");
  return (
    <div className="mb-4 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 sm:grid-cols-3 lg:grid-cols-5">
      {types.includes("cq") && (
        <Kpi label="Classroom quizzes" completed={totals.classroomCompleted} total={totals.classroomTotal} studentPct={totals.classroomPct} avgScore={totals.classroomAvgScore} uniqueCounts={uniqueCounts} />
      )}
      {types.includes("mq") && (
        <Kpi label="Module quizzes" completed={totals.moduleCompleted} total={totals.moduleTotal} studentPct={totals.modulePct} avgScore={totals.moduleAvgScore} uniqueCounts={uniqueCounts} />
      )}
      {both && (
        <Kpi label="Total (CQ + MQ)" completed={totals.totalCompleted} total={totals.totalAssigned} studentPct={totals.completionPct} avgScore={totals.avgScore} uniqueCounts={uniqueCounts} />
      )}
      <div className="bg-white px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Skills assessments</p>
        <p className="mt-1 flex items-center gap-1.5 text-sm text-gray-400"><Lock className="h-3.5 w-3.5" /> Coming soon</p>
      </div>
      <div className="bg-white px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Final skills assessment</p>
        <p className="mt-1 flex items-center gap-1.5 text-sm text-gray-400"><Lock className="h-3.5 w-3.5" /> Coming soon</p>
      </div>
    </div>
  );
}

function Kpi({
  label,
  completed,
  total,
  studentPct,
  avgScore,
  uniqueCounts,
}: {
  label: string;
  completed: number;
  total: number;
  studentPct: number;
  avgScore: number | null;
  uniqueCounts?: boolean;
}) {
  return (
    <div className="bg-white px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-gray-900">
        {completed.toLocaleString()}
        <span className="text-sm font-normal text-gray-400"> / {total.toLocaleString()}</span>
      </p>
      <p className="mt-0.5 text-[11px] text-gray-400">{uniqueCounts ? "Unique quizzes" : "Student work"}</p>
      <p className="mt-0.5 text-xs font-medium tabular-nums" style={{ color: total > 0 ? pctTextColor(studentPct) : undefined }}>
        {total > 0 ? `${studentPct}% student completion` : "No quizzes assigned"}
      </p>
      {total > 0 && (
        <p className="mt-0.5 text-xs font-medium tabular-nums" style={{ color: avgScore != null ? pctTextColor(avgScore) : undefined }}>
          {avgScore != null ? `Avg score ${avgScore.toFixed(1)}%` : "Avg score — not attempted yet"}
        </p>
      )}
    </div>
  );
}

function CountCell({ completed, total }: { completed: number; total: number }) {
  if (total <= 0) return <EmptyNote text={NONE_ASSIGNED} />;
  return (
    <span className="tabular-nums">
      <span className="font-semibold text-gray-900">{completed.toLocaleString()}</span>
      <span className="text-gray-400"> / {total.toLocaleString()}</span>
      {completed === 0 && <span className="block text-[11px] font-normal text-gray-400">{NOT_ATTEMPTED}</span>}
    </span>
  );
}

function EmptyNote({ text }: { text: string }) {
  return <span className="whitespace-nowrap text-xs text-gray-400">{text}</span>;
}

function TypeMenu({ selected, onChange }: { selected: AssessmentType[]; onChange: (next: AssessmentType[]) => void }) {
  const options: { id: AssessmentType | "skill" | "final"; label: string; disabled?: boolean }[] = [
    { id: "cq", label: "Classroom quiz" },
    { id: "mq", label: "Module quiz" },
    { id: "skill", label: "Skill Assessment", disabled: true },
    { id: "final", label: "Final Skill Assessment", disabled: true },
  ];
  const label = selected.length === ALL_TYPES.length ? "All quiz types" : selected.map((id) => (id === "cq" ? "Classroom" : "Module")).join(", ");
  return (
    <div role="group" aria-label="Assessment type" className="flex shrink-0 flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Assessment type</span>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" className="w-[180px] justify-between">{label}</Button>
        </PopoverTrigger>
        <PopoverContent className="w-64" align="start">
          <div className="space-y-1.5">
            {options.map((option) => {
              const on = !option.disabled && selected.includes(option.id as AssessmentType);
              return (
                <label
                  key={option.id}
                  className={"flex items-center gap-2 text-sm " + (option.disabled ? "cursor-not-allowed text-gray-400" : "")}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={option.disabled}
                    onChange={() => {
                      const id = option.id as AssessmentType;
                      const next = on ? selected.filter((item) => item !== id) : [...selected, id];
                      // Keep at least one type selected.
                      if (next.length) onChange(ALL_TYPES.filter((item) => next.includes(item)));
                    }}
                  />
                  {option.label}
                  {option.disabled && (
                    <span className="ml-auto inline-flex items-center gap-1 text-[11px]">
                      <Lock className="h-3 w-3" /> Coming soon
                    </span>
                  )}
                </label>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function PctBar({ pct }: { pct: number }) {
  return (
    <div className="flex items-center justify-end gap-3">
      <div className="hidden h-2 w-24 overflow-hidden rounded-full bg-gray-200 sm:block">
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, pct)}%`, backgroundColor: pctColor(pct) }} />
      </div>
      <span className="w-14 font-bold tabular-nums" style={{ color: pctTextColor(pct) }}>{pct}%</span>
    </div>
  );
}

function Th({ className, children }: { className?: string; children?: React.ReactNode }) {
  return (
    <TableHead className={"h-11 px-3 text-[11px] font-semibold uppercase tracking-wider text-gray-600 " + (className ?? "")}>
      {children}
    </TableHead>
  );
}
