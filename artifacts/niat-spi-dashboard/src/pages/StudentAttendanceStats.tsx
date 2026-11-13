import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/PageHeader";
import { ErrorState } from "@/components/PageStates";
import { Body, Head, Pager, type Sort } from "@/components/assessments/quiz/QuizTables";
import { CopyUid } from "@/components/assessments/quiz/CopyUid";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Building2, Check, ChevronDown, Loader2, ChevronRight, Download, FileText, GraduationCap, Layers, LayoutGrid, Search, SlidersHorizontal, User, X, type LucideIcon } from "lucide-react";
import { CheckMenu } from "@/components/SpiRecordFilterBar";
import { cn } from "@/lib/utils";
import { ATTENDANCE_TIERS, getTier, NO_SESSIONS_LABEL, TIER_AT_RISK, TIER_ELIGIBLE, TIER_RECOVERY } from "@/lib/attendanceTiers";
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
import { AttendanceCaption } from "@/components/AttendanceInfo";

/** Tighter cells than the Assessments tables: up to eleven columns have to fit next to the sidebar. */
const cell = "whitespace-nowrap px-2.5 py-2.5 text-sm text-slate-700";
const num = `${cell} text-right tabular-nums`;

/** Shorter tier headings for the table; the Columns list and the CSV keep the full labels. */
const TABLE_TIER_LABEL: Partial<Record<ColumnId, string>> = {
  eligible: `Eligible ≥${TIER_ELIGIBLE}%`,
  recoveryEligible: `Recovery ${TIER_RECOVERY}⁠–⁠${TIER_ELIGIBLE - 1}%`,
  atRisk: `At risk ${TIER_AT_RISK}⁠–⁠${TIER_RECOVERY - 1}%`,
  ineligible: `Ineligible <${TIER_AT_RISK}%`,
};

const VIEWS: { value: Grain; label: string; icon: LucideIcon }[] = [
  { value: "university", label: "Campus-wise", icon: Building2 },
  { value: "university_batch", label: "Batch-wise", icon: GraduationCap },
  { value: "university_section", label: "Section-wise", icon: LayoutGrid },
  { value: "university_subject", label: "Subject-wise", icon: FileText },
  { value: "university_unit", label: "Unit-wise", icon: Layers },
  { value: "university_student", label: "Student-wise", icon: User },
];

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

const TIER_COLUMNS = new Set<ColumnId>(["eligible", "recoveryEligible", "atRisk", "ineligible"]);

/**
 * The one column order on screen and in the CSV: who, how many, attendance, then the
 * tiers from best to worst, then the optional session counts. Saved column choices
 * only show or hide columns; they never reorder them.
 */
const COLUMN_ORDER: ColumnId[] = [
  "students",
  "grainPct",
  "overallPct",
  "eligible",
  "recoveryEligible",
  "atRisk",
  "ineligible",
  "present",
  "scheduled",
  "absences",
  "sessions",
];

/** Always shown: the row's student count and attendance %. */
const LOCKED_COLUMNS = new Set<ColumnId>(["students", "grainPct"]);

const DEFAULT_COLUMNS: ColumnId[] = [
  "students",
  "grainPct",
  "overallPct",
  "eligible",
  "recoveryEligible",
  "atRisk",
  "ineligible",
];

const GRAIN_PCT_LABEL: Record<Grain, string> = {
  university: "Attendance %",
  university_batch: "Attendance %",
  university_subject: "Subject attendance %",
  university_section: "Section attendance %",
  university_unit: "Unit attendance %",
  university_student: "Attendance %",
};

/** Campus % repeats the row's own % on Campus-wise and means little on one student's row. */
function columnApplies(id: ColumnId, grain: Grain): boolean {
  if (id === "overallPct") return grain !== "university" && grain !== "university_student";
  if (id === "students" || TIER_COLUMNS.has(id)) return grain !== "university_student";
  return true;
}

const COLUMN_LABEL: Record<ColumnId, string> = {
  overallPct: "Campus attendance %",
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


interface StatsRow {
  university: string;
  batch: string | null;
  semester: string | null;
  ended: boolean;
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
  /** Student-wise: the lowest subject attendance, which sets the tier (as on the student report). */
  lowestPct: number | null;
  lowestSubject: string | null;
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
    batches: BatchOption[];
    semesters: string[];
    sections: { campus: string; section: string }[];
    subjects: string[];
    ended: { batches: number; students: number };
  };
}

interface BatchOption {
  campus: string;
  batch: string;
  semester: string;
  ended: boolean;
  students: number;
}

/** The More filters panel's choices before Apply. */
interface MoreDraft {
  /** "college\tsection" */
  sections: string[];
  subjects: string[];
  scope: "semester" | "day" | "range";
  day: string;
  dateFrom: string;
  dateTo: string;
}

const EMPTY_DRAFT: MoreDraft = { sections: [], subjects: [], scope: "semester", day: "", dateFrom: "", dateTo: "" };

/** "Semester 3" → "Sem 3"; other titles (e.g. "Year 2 - Term 2") as they are. */
function shortSemester(title: string): string {
  return title.replace(/^Semester\s+/i, "Sem ");
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
  if (TIER_COLUMNS.has(id)) return Number(row[id]);
  return Number(row[id]).toLocaleString();
}

/** Share of the row's students in a tier, as a whole %. */
function tierShare(row: StatsRow, id: ColumnId): string {
  if (!row.students) return "—";
  return `${Math.round((Number(row[id]) / row.students) * 100)}%`;
}

export default function StudentAttendanceStats() {
  const { user } = useAuth();
  const isBoa = user?.role === "boa" || user?.role === "cos";
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
  /** Main level: "college\tbatch" keys, then the semester (latest per batch, running / ended only, or one earlier semester). */
  const batches = splitList(query.get("batches")).filter((value) => value.includes("\t"));
  const status = query.get("status") === "running" || query.get("status") === "ended" ? query.get("status")! : "";
  const students = splitList(query.get("students")).map((value) => {
    const [studentId, studentCampus, studentName] = value.split("\t");
    return { studentId: studentId ?? "", campus: studentCampus ?? "", studentName: studentName ?? "" };
  }).filter((item) => item.studentId);
  const scopeKind = query.get("scope") || "semester";
  const day = query.get("date") || "";
  const dateFrom = query.get("dateFrom") || "";
  const dateTo = query.get("dateTo") || "";

  const [moreOpen, setMoreOpen] = useState(false);
  const [draft, setDraft] = useState<MoreDraft>(EMPTY_DRAFT);
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(1);
  const [columns, setColumns] = useState<ColumnId[]>(DEFAULT_COLUMNS);
  const [draftColumns, setDraftColumns] = useState<ColumnId[]>(DEFAULT_COLUMNS);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sort, setSort] = useState<Sort | null>(null);

  useEffect(() => {
    const id = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(id);
  }, [search]);

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
  const viewParams = (overrides: { campuses?: string[]; batches?: string[]; sections?: string[]; students?: string[] } = {}) => {
    const params = new URLSearchParams(detailParams);
    if (grain !== "university") params.set("group", grain);
    const list = (key: string, values: string[]) => {
      if (values.length) params.set(key, values.join("||"));
    };
    list("campuses", overrides.campuses ?? campuses);
    const batchList = overrides.batches ?? batches;
    list("batches", batchList);
    if (status) params.set("status", status);
    list("semesters", semesters);
    list("sections", overrides.sections ?? sections.map((item) => `${item.campus}\t${item.section}`));
    list("students", overrides.students ?? students.map((item) => `${item.campus}\t${item.studentId}`));
    list("subjects", subjects);
    if (debouncedSearch) params.set("q", debouncedSearch);
    if (sort) {
      params.set("sort", sort.key);
      params.set("dir", sort.dir);
    }
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

  const { data, isLoading, isFetching, isError, refetch } = useQuery({
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
  const batchChoices = data?.options.batches ?? [];
  const sectionChoices = data?.options.sections ?? [];
  const subjectOptions = useMemo(() => subjectOptionList(data?.options.subjects ?? []), [data]);
  const endedNote = data?.options.ended ?? { batches: 0, students: 0 };


  const summary: AttendanceHeader = data?.summary ?? EMPTY_SUMMARY;
  /** Old numbers are on screen while the new filters load. */
  const updating = isFetching && !isLoading;
  const tableLoading = grain === "university_unit"
    ? (campuses.length > 0 || batches.length > 0) && isLoading
    : isLoading;
  const paged = data?.rows ?? [];
  const totalRows = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;
  const currentPage = data?.page ?? page;

  const identity = identityHeaders(grain);
  const isStudent = grain === "university_student";
  const shownColumns = COLUMN_ORDER.filter(
    (id) => (LOCKED_COLUMNS.has(id) || columns.includes(id)) && columnApplies(id, grain),
  );
  const tierShown = COLUMN_ORDER.some((id) => TIER_COLUMNS.has(id) && columns.includes(id));

  const semesterLabel = status === "running"
      ? "Running"
      : status === "ended"
        ? "Ended"
        : "This semester";
  const scopeLabel = [
    campusScopeLabel(campuses, campusOptions),
    batches.length === 1 ? batches[0]!.split("\t")[1] : batches.length > 1 ? `${batches.length} batches` : "",
    scopeKind === "semester" ? semesterLabel : "",
    semesters.length ? semesters.join(", ") : "",
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
    const studentExtras = isStudent && tierShown;
    exportCsv(
      filename,
      [
        "College",
        ...identity,
        ...(isStudent ? ["UUID"] : []),
        ...shownColumns.map((id) => columnLabel(id, grain)),
        ...(studentExtras ? ["Lowest subject %", "Lowest subject", "Tier"] : []),
      ],
      data.map((row) => [
        row.university,
        ...identityValues(row, grain),
        ...(isStudent ? [row.studentId ?? ""] : []),
        ...shownColumns.map((id) => cellValue(row, id)),
        ...(studentExtras
          ? [
              row.lowestPct == null ? NO_SESSIONS_LABEL : `${row.lowestPct}%`,
              row.lowestSubject ?? "",
              row.lowestPct == null ? "" : getTier(row.lowestPct).label,
            ]
          : []),
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
    const params = viewParams({ campuses: [], batches: [], sections: [], students: [] });
    params.delete("q");
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
    if (LOCKED_COLUMNS.has(id)) return;
    setDraftColumns((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  };

  const rated = summary.eligible + summary.recoveryEligible + summary.atRisk + summary.ineligible;
  const share = (count: number) => (rated > 0 ? `${Math.round((count / rated) * 100)}%` : "—");
  const multiCampus = campuses.length !== 1;

  const tableColumns: { key: string; label: string; align?: "right"; sortable?: boolean }[] = [
    { key: "university", label: "College" },
    ...identity.map((header) => ({ key: header.toLowerCase(), label: header })),
    ...(isStudent ? [{ key: "uuid", label: "UUID", sortable: false }] : []),
    ...shownColumns.map((id) => ({ key: id, label: TABLE_TIER_LABEL[id] ?? columnLabel(id, grain), align: "right" as const })),
    ...(isStudent && tierShown
      ? [
          { key: "lowest", label: "Lowest subject", sortable: false },
          { key: "tier", label: "Tier", sortable: false },
        ]
      : []),
  ];
  const onSort = (key: string) => {
    setPage(1);
    setSort((current) =>
      current?.key === key
        ? { key, dir: current.dir === "asc" ? "desc" : "asc" }
        : { key, dir: ["university", "batch", "semester", "subject", "section", "unit", "student"].includes(key) ? "asc" : "desc" },
    );
  };

  /** Unit-wise reads BigQuery per college, so it needs a college (or batch) first. */
  const needCollege = grain === "university_unit" && !campuses.length && !batches.length;
  const emptyText = `No rows for ${scopeLabel}.`;
  const lockedCampus = isBoa && user?.campuses?.length === 1;
  const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-600 focus-visible:ring-offset-2";
  /** Every filter field looks like a dropdown: full width, value on the left, arrow on the right. */
  const fieldTrigger = "h-10 w-full min-w-0 justify-between gap-2 rounded-lg border-slate-300 px-3 font-normal text-slate-900";
  const fieldBox = "flex h-10 w-full min-w-0 items-center rounded-lg border border-slate-300 px-3 text-sm text-slate-900";

  /** More filters panel: choices are a draft until Apply, so one Apply is one reload of the table. */
  const currentDraft = (): MoreDraft => ({
    sections: sections.map((item) => `${item.campus}\t${item.section}`),
    subjects,
    scope: scopeKind === "day" || scopeKind === "range" ? scopeKind : "semester",
    day,
    dateFrom,
    dateTo,
  });
  const openMore = () => {
    setDraft(currentDraft());
    setMoreOpen(true);
  };
  const isoDate = /^\d{4}-\d{2}-\d{2}$/;
  const draftDateError =
    draft.scope === "day" && !isoDate.test(draft.day)
      ? "Pick a day."
      : draft.scope === "range" && !(isoDate.test(draft.dateFrom) && isoDate.test(draft.dateTo))
        ? "Pick both a From and a To date."
        : draft.scope === "range" && draft.dateFrom > draft.dateTo
          ? "From must be on or before To."
          : "";
  const applyMore = () => {
    if (draftDateError) return;
    writeQuery({
      sections: draft.sections.join("||") || undefined,
      subjects: draft.subjects.join("||") || undefined,
      scope: draft.scope === "semester" ? undefined : draft.scope,
      date: draft.scope === "day" ? draft.day : undefined,
      dateFrom: draft.scope === "range" ? draft.dateFrom : undefined,
      dateTo: draft.scope === "range" ? draft.dateTo : undefined,
    });
    setMoreOpen(false);
  };
  const moreCount = sections.length + subjects.length + (scopeKind === "day" || scopeKind === "range" ? 1 : 0);

  const setCampuses = (next: string[]) => {
    const keptBatches = next.length ? batches.filter((key) => next.includes(key.split("\t")[0]!)) : [];
    const keptSections = next.length ? sections.filter((item) => next.includes(item.campus)) : [];
    const keptStudents = next.length ? students.filter((item) => next.includes(item.campus)) : [];
    writeQuery({
      campuses: next.join("||") || undefined,
      batches: keptBatches.join("||") || undefined,
      sections: keptSections.map((item) => `${item.campus}\t${item.section}`).join("||") || undefined,
      students: keptStudents.map((item) => `${item.studentId}\t${item.campus}\t${item.studentName}`).join("||") || undefined,
    });
  };
  const setBatches = (next: string[]) => writeQuery({ batches: next.join("||") || undefined, sections: undefined });
  const setSemester = (choice: { status?: string }) => writeQuery({ status: choice.status });

  /** Filters behind More filters (and ones that only arrive from links), shown as removable chips under the bar. */
  const chips: { key: string; label: string; clear: () => void }[] = [
    ...sections.map((item) => ({
      key: `section-${item.campus}-${item.section}`,
      label: `Section: ${multiCampus ? `${item.campus} — ` : ""}${item.section}`,
      clear: () => writeQuery({ sections: sections.filter((other) => other !== item).map((other) => `${other.campus}\t${other.section}`).join("||") || undefined }),
    })),
    ...subjects.map((name) => ({
      key: `subject-${name}`,
      label: `Subject: ${name}`,
      clear: () => writeQuery({ subjects: subjects.filter((other) => other !== name).join("||") || undefined }),
    })),
    ...(scopeKind === "day" && day
      ? [{ key: "date", label: `Date: ${formatDay(day)}`, clear: () => writeQuery({ scope: undefined, date: undefined }) }]
      : scopeKind === "range" && dateFrom && dateTo
        ? [{ key: "date", label: `Dates: ${formatDay(dateFrom)} – ${formatDay(dateTo)}`, clear: () => writeQuery({ scope: undefined, dateFrom: undefined, dateTo: undefined }) }]
        : []),
    ...semesters.map((name) => ({
      key: `semester-${name}`,
      label: `Semester: ${name}`,
      clear: () => writeQuery({ semesters: semesters.filter((other) => other !== name).join("||") || undefined }),
    })),
    ...students.map((item) => ({
      key: `student-${item.campus}-${item.studentId}`,
      label: `Student: ${item.studentName || item.studentId}`,
      clear: () => writeQuery({ students: students.filter((other) => other !== item).map((other) => `${other.studentId}\t${other.campus}\t${other.studentName}`).join("||") || undefined }),
    })),
  ];
  const anyFilter =
    (!lockedCampus && campuses.length > 0) || batches.length > 0 || Boolean(status) || sections.length > 0 || subjects.length > 0 ||
    semesters.length > 0 || students.length > 0 || scopeKind !== "semester";
  /** Resets every filter in the box (a single-campus user keeps their campus). */
  const clearAll = () => {
    setSearch("");
    writeQuery({
      campuses: undefined,
      batches: undefined,
      status: undefined,
      semesters: undefined,
      sections: undefined,
      students: undefined,
      subjects: undefined,
      campus: undefined,
      semester: undefined,
      scope: undefined,
      date: undefined,
      dateFrom: undefined,
      dateTo: undefined,
    });
  };

  return (
    <div className="flex min-w-0 flex-col">
      <PageHeader
        attendanceNote
        title="Student Attendance Stats"
        right={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button type="button" variant="outline" size="sm" disabled={totalRows === 0 || tableLoading} onClick={() => void exportView()}>
              <Download className="mr-1 h-4 w-4" aria-hidden="true" /> Export this view
            </Button>
            <Button type="button" size="sm" disabled={isLoading || !scopeReady || grain === "university_unit"} onClick={() => void exportAll()}>
              <Download className="mr-1 h-4 w-4" aria-hidden="true" /> Export all campuses
            </Button>
          </div>
        }
      />

      <section aria-label="Filters" className="mb-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <div className="grid w-full min-w-0 grid-cols-1 gap-3 sm:grid-cols-3 lg:flex-1">
            <FilterField label="College">
              {lockedCampus ? (
                <div className={cn(fieldBox, "cursor-default bg-slate-50")}>
                  <span className="min-w-0 truncate">{campuses[0]}</span>
                </div>
              ) : (
                <CheckMenu
                  chevron
                  className={fieldTrigger}
                  label={campuses.length === 1 ? campuses[0]! : campuses.length ? `${campuses.length} colleges` : "All colleges"}
                  options={campusOptions.map((name) => ({ id: name, label: name }))}
                  selected={campuses}
                  onChange={setCampuses}
                />
              )}
            </FilterField>
            <FilterField label="Batch">
              <CheckMenu
                chevron
                className={fieldTrigger}
                label={batches.length === 1 ? batches[0]!.split("\t")[1]! : batches.length ? `${batches.length} batches` : "All batches"}
                options={batchChoices.map((item) => ({
                  id: `${item.campus}\t${item.batch}`,
                  label: multiCampus ? `${item.campus} — ${item.batch}` : item.batch,
                  hint: `${shortSemester(item.semester)}${item.ended ? " · Ended" : ""} · ${item.students.toLocaleString("en-IN")}`,
                }))}
                selected={batches}
                onChange={setBatches}
              />
            </FilterField>
            <FilterField label="Semester">
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={fieldTrigger}>
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate">{scopeKind !== "semester" ? "Custom dates" : semesterLabel}</span>
                    </span>
                    <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-72 p-1.5">
                  {scopeKind !== "semester" ? (
                    <div className="space-y-2 p-2 text-sm text-slate-600">
                      <p>A date filter is on, so the table shows every semester inside those dates.</p>
                      <Button type="button" size="sm" variant="outline" onClick={() => writeQuery({ scope: undefined, date: undefined, dateFrom: undefined, dateTo: undefined })}>
                        Remove dates
                      </Button>
                    </div>
                  ) : (
                    <>
                      <SemesterOption on={!status} label="This semester" hint="all batches" onSelect={() => setSemester({})} />
                      <SemesterOption on={status === "running"} label="Running" hint="semester in progress" onSelect={() => setSemester({ status: "running" })} />
                      <SemesterOption on={status === "ended"} label="Ended" hint={endedNote.batches ? `${endedNote.batches} batches` : undefined} onSelect={() => setSemester({ status: "ended" })} />
                    </>
                  )}
                </PopoverContent>
              </Popover>
            </FilterField>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" className="h-10 flex-1 gap-2 border-slate-300 lg:flex-none" onClick={openMore} aria-haspopup="dialog">
              <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
              More filters
              {moreCount > 0 && (
                <span className="rounded-full bg-violet-600 px-1.5 text-[11px] font-semibold leading-5 text-white tabular-nums" aria-label={`${moreCount} on`}>{moreCount}</span>
              )}
            </Button>
            {anyFilter && (
              <Button type="button" variant="ghost" className="h-10 px-3 text-slate-600" onClick={clearAll}>Clear all</Button>
            )}
          </div>
        </div>
        {chips.length > 0 && (
          <ul aria-label="Filters in use" className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-3">
            {chips.map((chip) => (
              <li key={chip.key} className="inline-flex h-8 max-w-full items-center gap-1 rounded-full bg-violet-50 pl-3 pr-1 text-xs font-medium text-violet-800">
                <span className="min-w-0 truncate" title={chip.label}>{chip.label}</span>
                <button type="button" aria-label={`Remove ${chip.label}`} className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-full hover:bg-violet-100", focusRing)} onClick={chip.clear}>
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
          <SheetHeader className="border-b border-slate-200 px-5 py-4 text-left">
            <SheetTitle>More filters</SheetTitle>
            <SheetDescription>Narrow the totals and the table by section, subject or dates.</SheetDescription>
          </SheetHeader>
          <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
            <FilterField label="Section">
              <CheckMenu
                chevron
                className={fieldTrigger}
                label={draft.sections.length ? `${draft.sections.length} selected` : campuses.length || batches.length ? "All sections" : "Pick a college or batch first"}
                options={sectionChoices.map((item) => ({
                  id: `${item.campus}\t${item.section}`,
                  label: multiCampus ? `${item.campus} — ${item.section}` : item.section,
                }))}
                selected={draft.sections}
                onChange={(next) => setDraft((d) => ({ ...d, sections: next }))}
              />
            </FilterField>
            <FilterField label="Subject">
              <CheckMenu
                chevron
                className={fieldTrigger}
                label={draft.subjects.length === 1 ? draft.subjects[0]! : draft.subjects.length ? `${draft.subjects.length} subjects` : "All subjects"}
                options={subjectOptions.map((name) => ({ id: name, label: name }))}
                selected={draft.subjects}
                onChange={(next) => setDraft((d) => ({ ...d, subjects: next }))}
              />
            </FilterField>
            <fieldset className="space-y-2">
              <legend className="text-xs font-medium text-slate-600">Dates</legend>
              <div role="radiogroup" aria-label="Dates" className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1">
                {([
                  ["semester", "Semester"],
                  ["day", "One day"],
                  ["range", "Date range"],
                ] as const).map(([value, label]) => {
                  const on = draft.scope === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      className={cn("h-9 rounded-md text-sm font-medium transition-colors motion-reduce:transition-none", focusRing, on ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900")}
                      onClick={() => setDraft((d) => ({ ...d, scope: value }))}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              {draft.scope === "day" && (
                <FilterField label="Day">
                  <Input type="date" value={draft.day} className="h-10" onChange={(e) => setDraft((d) => ({ ...d, day: e.target.value }))} />
                </FilterField>
              )}
              {draft.scope === "range" && (
                <div className="grid grid-cols-2 gap-3">
                  <FilterField label="From">
                    <Input type="date" value={draft.dateFrom} className="h-10" onChange={(e) => setDraft((d) => ({ ...d, dateFrom: e.target.value }))} />
                  </FilterField>
                  <FilterField label="To">
                    <Input type="date" value={draft.dateTo} className="h-10" onChange={(e) => setDraft((d) => ({ ...d, dateTo: e.target.value }))} />
                  </FilterField>
                </div>
              )}
              {draftDateError ? (
                <p className="text-xs font-medium text-red-700" role="alert">{draftDateError}</p>
              ) : draft.scope !== "semester" ? (
                <p className="text-xs text-slate-500">Dates show every semester inside them, so the Semester filter is set aside.</p>
              ) : null}
            </fieldset>
          </div>
          <SheetFooter className="flex-row justify-between gap-2 border-t border-slate-200 px-5 py-4 sm:justify-between">
            <Button type="button" variant="ghost" onClick={() => setDraft(EMPTY_DRAFT)}>Reset</Button>
            <div className="flex gap-2">
              <SheetClose asChild>
                <Button type="button" variant="outline">Cancel</Button>
              </SheetClose>
              <Button type="button" disabled={Boolean(draftDateError)} onClick={applyMore}>Apply</Button>
            </div>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <div
        aria-busy={updating}
        className={cn("grid grid-cols-2 gap-2.5 transition-opacity duration-200 motion-reduce:transition-none md:grid-cols-3 xl:grid-cols-6", updating && "opacity-50")}
      >
        <StatTile label="Students" value={isLoading ? null : summary.students.toLocaleString("en-IN")} />
        <StatTile label="Overall attendance" value={isLoading ? null : summary.overallPct == null ? "—" : `${summary.overallPct.toFixed(1)}%`} />
        <StatTile label="Eligible" tier={ATTENDANCE_TIERS[0]} value={isLoading ? null : summary.eligible.toLocaleString("en-IN")} hint={isLoading ? "" : `${share(summary.eligible)} · ≥${TIER_ELIGIBLE}%`} />
        <StatTile label="Recovery" tier={ATTENDANCE_TIERS[1]} value={isLoading ? null : summary.recoveryEligible.toLocaleString("en-IN")} hint={isLoading ? "" : `${share(summary.recoveryEligible)} · ${TIER_RECOVERY}–${TIER_ELIGIBLE - 1}%`} />
        <StatTile label="At risk" tier={ATTENDANCE_TIERS[2]} value={isLoading ? null : summary.atRisk.toLocaleString("en-IN")} hint={isLoading ? "" : `${share(summary.atRisk)} · ${TIER_AT_RISK}–${TIER_RECOVERY - 1}%`} />
        <StatTile label="Ineligible" tier={ATTENDANCE_TIERS[3]} value={isLoading ? null : summary.ineligible.toLocaleString("en-IN")} hint={isLoading ? "" : `${share(summary.ineligible)} · below ${TIER_AT_RISK}%`} />
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
                  writeQuery({ group: value === "university" ? undefined : value });
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

      {isError && (
        <div className="mt-3">
          <ErrorState message="Failed to load attendance stats." onRetry={() => void refetch()} />
        </div>
      )}

      <section className="relative mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm" aria-label="Attendance" aria-busy={updating}>
        {updating && <div className="absolute inset-x-0 top-0 h-1 animate-pulse bg-violet-600 motion-reduce:animate-none" aria-hidden="true" />}
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-3">
          <label className="relative min-w-[14rem] flex-1 sm:max-w-xs">
            <span className="sr-only">Search this view</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name, ID, batch or section"
              className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-600"
            />
          </label>

          <p hidden={needCollege} className="min-w-0 truncate text-sm text-slate-500 tabular-nums" title={scopeLabel} role="status" aria-live="polite">
            {updating ? (
              <span className="inline-flex items-center gap-1.5 font-medium text-violet-700">
                <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                Updating for your filters…
              </span>
            ) : (
              <>
            <span className="font-semibold text-slate-900">{totalRows.toLocaleString("en-IN")}</span> rows
            {scopeKind === "semester" && status !== "ended" && endedNote.batches > 0 && (
              <>
                {" · "}
                <button type="button" className={cn("rounded font-medium text-amber-700 hover:underline", focusRing)} onClick={() => setSemester({ status: "ended" })}>
                  {endedNote.batches} {endedNote.batches === 1 ? "batch" : "batches"} ended
                </button>
              </>
            )}
              </>
            )}
          </p>
          <div className="ml-auto flex items-center gap-2">
            <Popover open={columnsOpen} onOpenChange={(open) => { setColumnsOpen(open); if (open) setDraftColumns(columns); }}>
              <PopoverTrigger asChild>
                <Button type="button" variant="outline" size="sm">Columns</Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-72">
                <p className="mb-2 text-xs font-medium text-slate-600">Show columns</p>
                <div className="space-y-1">
                  {COLUMN_ORDER.filter((id) => columnApplies(id, grain)).map((id) => {
                    const locked = LOCKED_COLUMNS.has(id);
                    return (
                      <label key={id} className={cn("flex items-center gap-2 rounded px-1 py-1 text-sm", locked ? "text-slate-400" : "text-slate-700 hover:bg-slate-50")}>
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-violet-600"
                          checked={locked || draftColumns.includes(id)}
                          disabled={locked}
                          onChange={() => toggleDraft(id)}
                        />
                        {columnLabel(id, grain)}
                      </label>
                    );
                  })}
                </div>
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
          </div>
        </div>


        {needCollege ? (
          <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
            <Layers className="h-6 w-6 text-violet-600" aria-hidden="true" />
            <p className="max-w-md text-sm text-slate-600">Unit-wise shows one college's units at a time. Pick a college:</p>
            <div className="w-full max-w-xs">
              <CheckMenu
                chevron
                className={fieldTrigger}
                label="Pick a college"
                options={campusOptions.map((name) => ({ id: name, label: name }))}
                selected={[]}
                onChange={(next) => next.length && setCampuses([next[next.length - 1]!])}
              />
            </div>
          </div>
        ) : (
        <div className={cn("overflow-x-auto transition-opacity duration-200 motion-reduce:transition-none", updating && "opacity-60")}>
          <table className="w-full min-w-[48rem] text-left">
            <Head columns={tableColumns} sort={sort ?? { key: "", dir: "asc" }} onSort={onSort} extra dense />
            <Body loading={tableLoading} empty={emptyText} colSpan={tableColumns.length + 1} rowsCount={paged.length}>
              {paged.map((row) => (
                <tr key={rowKey(row, grain)} className="hover:bg-slate-50">
                  <td className={cn(cell, "font-medium text-slate-900")}>
                    <button type="button" className={cn("rounded text-left hover:underline", focusRing)} onClick={() => openUniversity(row.university)}>
                      {row.university}
                    </button>
                  </td>
                  {identity.map((header, index) => (
                    <td key={header} className={cell}>
                      {header === "Subject" && row.subject ? (
                        <button type="button" className={cn("rounded text-left font-medium text-brand-700 hover:underline", focusRing)} onClick={() => openSubject(row)}>
                          {row.subject}
                        </button>
                      ) : header === "Semester" ? (
                        <span className="inline-flex items-center gap-1.5">
                          {row.semester}
                          {row.ended && <EndedTag />}
                        </span>
                      ) : header === "Student" ? (
                        row.spiPath ? (
                          <a className="font-medium text-brand-700 hover:underline" href={row.spiPath}>{row.studentName || row.studentId}</a>
                        ) : (
                          row.studentName || row.studentId
                        )
                      ) : (
                        identityValues(row, grain)[index]
                      )}
                    </td>
                  ))}
                  {isStudent && <td className={cell}>{row.studentId ? <CopyUid uid={row.studentId} /> : "—"}</td>}
                  {shownColumns.map((id) => (
                    <td key={id} className={num}>
                      {id === "overallPct" ? (
                        <AttendancePill pct={row.overallPct} scheduled={row.campusScheduled} />
                      ) : id === "grainPct" ? (
                        <AttendancePill pct={row.grainPct} scheduled={row.scheduled} />
                      ) : TIER_COLUMNS.has(id) ? (
                        <span>
                          <span className="font-semibold text-slate-900">{Number(row[id]).toLocaleString("en-IN")}</span>
                          <span className="ml-1.5 inline-block w-9 text-right text-xs text-slate-500">{tierShare(row, id)}</span>
                        </span>
                      ) : (
                        cellValue(row, id)
                      )}
                    </td>
                  ))}
                  {isStudent && tierShown && (
                    <>
                      <td className={cell}>
                        {row.lowestPct == null ? (
                          <span className="text-slate-400">—</span>
                        ) : (
                          <span className="tabular-nums">
                            <span className="font-semibold text-slate-900">{row.lowestPct}%</span>
                            {row.lowestSubject && <span className="ml-1.5 text-xs text-slate-500">{row.lowestSubject}</span>}
                          </span>
                        )}
                      </td>
                      <td className={cell}>
                        {row.lowestPct != null ? (
                          <span className="inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold" style={{ color: getTier(row.lowestPct).color, background: getTier(row.lowestPct).bg }}>
                            {getTier(row.lowestPct).label}
                          </span>
                        ) : (
                          <span className="text-slate-400">{NO_SESSIONS_LABEL}</span>
                        )}
                      </td>
                    </>
                  )}
                  <td className="px-2 py-3 text-right">
                    {grain === "university" && (
                      <button
                        type="button"
                        aria-label={`Open sessions for ${row.university}`}
                        onClick={() => openUniversity(row.university)}
                        className={cn("rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-100", focusRing)}
                      >
                        <ChevronRight className="h-4 w-4" aria-hidden="true" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </Body>
          </table>
        </div>
        )}
        <AttendanceCaption className="mx-3 mb-2" />
        {!needCollege && <Pager
          page={totalRows > 0 ? { rows: [], total: totalRows, page: currentPage, pageSize, totalPages } : undefined}
          unit="rows"
          pageSize={pageSize}
          onPage={setPage}
          onPageSize={(size) => {
            setPageSize(size);
            setPage(1);
          }}
        />}
      </section>
    </div>
  );
}

function identityHeaders(grain: Grain): string[] {
  if (grain === "university_batch") return ["Batch", "Semester"];
  if (grain === "university_subject") return ["Subject"];
  if (grain === "university_section") return ["Batch", "Section"];
  if (grain === "university_unit") return ["Subject", "Unit"];
  if (grain === "university_student") return ["Batch", "Student"];
  return [];
}

function identityValues(row: StatsRow, grain: Grain): string[] {
  if (grain === "university_batch") return [row.batch ?? "", `${row.semester ?? ""}${row.ended ? " (Ended)" : ""}`];
  if (grain === "university_subject") return [row.subject ?? ""];
  if (grain === "university_section") return [row.batch ?? "", row.section ?? ""];
  if (grain === "university_unit") return [row.subject ?? "", row.unit ?? ""];
  if (grain === "university_student") return [row.batch ?? "", row.studentName || row.studentId || ""];
  return [];
}

function rowKey(row: StatsRow, grain: Grain): string {
  return [row.university, row.batch ?? "", row.semester ?? "", row.subject ?? "", row.section ?? "", row.unit ?? "", row.studentId ?? "", grain].join("|");
}

/** Marks a semester that has ended (the batch is between semesters, or an earlier semester is picked). */
function EndedTag() {
  return <span className="inline-flex h-5 items-center rounded-full bg-amber-50 px-2 text-[11px] font-semibold text-amber-800 ring-1 ring-inset ring-amber-200">Ended</span>;
}

function SemesterOption({ on, label, hint, tag, onSelect }: { on: boolean; label: string; hint?: string; tag?: "running" | "ended"; onSelect: () => void }) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={on}
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-600",
        on ? "bg-violet-50 font-semibold text-violet-900" : "text-slate-700 hover:bg-slate-50",
      )}
    >
      <Check className={cn("h-4 w-4 shrink-0", on ? "text-violet-600" : "invisible")} aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {tag === "ended" && <EndedTag />}
      {tag === "running" && <span className="inline-flex h-5 items-center rounded-full bg-emerald-50 px-2 text-[11px] font-semibold text-emerald-800 ring-1 ring-inset ring-emerald-200">Running</span>}
      {hint && <span className="shrink-0 text-xs font-normal text-slate-500 tabular-nums">{hint}</span>}
    </button>
  );
}

function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5 text-xs font-medium text-slate-600">
      {label}
      {children}
    </label>
  );
}

/** An attendance % in a pill coloured by its tier; "No sessions" when nothing is scheduled. */
function AttendancePill({ pct, scheduled }: { pct: number; scheduled: number }) {
  if (scheduled <= 0) return <span className="text-slate-400">{NO_SESSIONS_LABEL}</span>;
  const tier = getTier(pct);
  return (
    <span className="inline-block min-w-[3.5rem] rounded-full px-2.5 py-0.5 text-center text-xs font-semibold tabular-nums" style={{ color: tier.color, background: tier.bg }}>
      {pct}%
    </span>
  );
}

function StatTile({ label, value, hint, tier }: { label: string; value: string | null; hint?: string; tier?: { color: string } }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 shadow-sm">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      {value == null ? <Skeleton className="h-7 w-20" /> : <div className="text-xl font-bold tracking-tight tabular-nums text-slate-900" style={tier ? { color: tier.color } : undefined}>{value}</div>}
      {hint ? <div className="text-[11px] text-slate-500">{hint}</div> : null}
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
