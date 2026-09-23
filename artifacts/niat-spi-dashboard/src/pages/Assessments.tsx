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
import { PageBreadcrumb } from "@/components/PageBreadcrumb";
import { TableShell, TablePagination } from "@/components/DataTable";
import {
  assessmentStudentsPath,
  assessmentSubjectsPath,
  assessmentsPath,
} from "@/components/SubNav";
import {
  SearchableSelect,
  campusSelectOptions,
} from "@/components/SearchableSelect";
import {
  Search,
  Loader2,
  ChevronRight,
  Download,
  ExternalLink,
  Lock,
} from "lucide-react";
import { pctColor, pctTextColor } from "@/lib/utils";
import { useDebounceValue } from "@/hooks/useDebounceValue";
import { useQueryParams } from "@/hooks/useQueryParams";
import { omitExcludedInstitutes, isExcludedInstitute } from "@/lib/excludedInstitutes";
import { exportCsv } from "@/lib/csv";
import { useAuth } from "@/contexts/AuthContext";

const PAGE_SIZES = [25, 50, 100];
const FETCH_LIMIT = 5000;
const CURRENT_SEMESTER = "current";

function useCampusNames() {
  const [names, setNames] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    fetch("/api/dashboard/filters", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: { campuses?: string[] }) => {
        if (alive) setNames(omitExcludedInstitutes(data.campuses ?? []));
      })
      .catch(() => {
        if (alive) setNames([]);
      });
    return () => {
      alive = false;
    };
  }, []);
  return names;
}

function withCurrentCampus(names: string[], campus: string) {
  if (!campus || campus === "all" || names.includes(campus)) return names;
  return [campus, ...names];
}

function filterContext(campus: string, semester: string, extras: string[] = []) {
  const campusLabel = !campus || campus === "all" ? "All campuses" : campus;
  const semesterLabel = semester || "Current semester";
  return [campusLabel, semesterLabel, ...extras.filter(Boolean)].join(" · ");
}

function useSemesters(campus: string) {
  const [semesters, setSemesters] = useState<string[]>([]);
  useEffect(() => {
    if (!campus || campus === "all") {
      setSemesters([]);
      return;
    }
    let alive = true;
    fetch(
      `/api/attendance/recovery/semesters?campus=${encodeURIComponent(campus)}`,
      { credentials: "include" },
    )
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: string[]) => {
        if (alive) setSemesters(data ?? []);
      })
      .catch(() => {
        if (alive) setSemesters([]);
      });
    return () => {
      alive = false;
    };
  }, [campus]);
  return semesters;
}

function AssessmentFilters({
  campus,
  semester,
  campusNames,
  semesters,
  hideCampus,
  onCampusChange,
  onSemesterChange,
}: {
  campus: string;
  semester: string;
  campusNames: string[];
  semesters: string[];
  hideCampus?: boolean;
  onCampusChange: (campus: string) => void;
  onSemesterChange: (semester: string) => void;
}) {
  const campusAll = !campus || campus === "all";
  return (
    <>
      {!hideCampus && (
        <SearchableSelect
          value={campusAll ? "all" : campus}
          onValueChange={onCampusChange}
          options={campusSelectOptions(campusNames)}
          placeholder="All campuses"
          searchPlaceholder="Search campuses…"
          className="w-[220px]"
          disabled={campusNames.length === 0}
        />
      )}
      <SearchableSelect
        value={semester || CURRENT_SEMESTER}
        onValueChange={(value) =>
          onSemesterChange(value === CURRENT_SEMESTER ? "" : value)
        }
        options={[
          { value: CURRENT_SEMESTER, label: "Current semester" },
          ...semesters.map((s) => ({ value: s, label: s })),
        ]}
        placeholder="Current semester"
        searchPlaceholder="Search semesters…"
        className="w-[220px]"
        disabled={campusAll || semesters.length === 0}
      />
    </>
  );
}

interface AssessmentCounts {
  classroomCompleted: number;
  classroomTotal: number;
  moduleCompleted: number;
  moduleTotal: number;
  totalCompleted: number;
  totalAssigned: number;
  classroomStudentCompleted: number;
  classroomStudentTotal: number;
  moduleStudentCompleted: number;
  moduleStudentTotal: number;
  classroomPct: number;
  modulePct: number;
  completionPct: number;
}

interface AssessmentCampus extends AssessmentCounts {
  instituteName: string;
  studentCount: number;
  subjectCount: number;
}

interface AssessmentSubject extends AssessmentCounts {
  subjectTitle: string;
  studentCount: number;
}

interface AssessmentStudent extends AssessmentCounts {
  studentId: string;
  studentName: string;
  instituteName: string;
  sectionName: string | null;
  spiPath: string;
}

export default function Assessments() {
  const [location] = useLocation();
  const path = location.split("?")[0] ?? location;
  if (path.startsWith("/dashboard/assessments/students")) return <StudentList />;
  if (path.startsWith("/dashboard/assessments/subjects")) return <SubjectList />;
  return <CampusList />;
}

function CampusList() {
  const { user } = useAuth();
  const isBoa = user?.role === "boa";
  const [, setLocation] = useLocation();
  const query = useQueryParams();
  const campusFilter = query.get("campus") || "all";
  const semester = campusFilter === "all" ? "" : (query.get("semester") ?? "");
  const campusNames = useCampusNames();
  const semesters = useSemesters(campusFilter);
  const [rows, setRows] = useState<AssessmentCampus[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(1);
  const hideCampus = Boolean(isBoa && user?.campuses?.length === 1);

  useEffect(() => {
    if (isBoa && user?.campuses?.length === 1 && user.campuses[0]) {
      setLocation(
        assessmentSubjectsPath(user.campuses[0], semester || undefined),
      );
    }
  }, [isBoa, user?.campuses, semester, setLocation]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setFetchError(false);
    const params = new URLSearchParams();
    if (campusFilter !== "all") {
      params.set("campus", campusFilter);
      if (semester) params.set("semester", semester);
    }
    const qs = params.toString();
    fetch(
      qs
        ? `/api/dashboard/assessment-campuses?${qs}`
        : "/api/dashboard/assessment-campuses",
      { credentials: "include" },
    )
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: AssessmentCampus[]) => {
        if (alive) setRows(data ?? []);
      })
      .catch(() => {
        if (alive) {
          setRows([]);
          setFetchError(true);
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [campusFilter, semester]);

  const filtered = useMemo(() => {
    const visible = rows.filter((c) => !isExcludedInstitute(c.instituteName));
    if (campusFilter === "all") return visible;
    return visible.filter((c) => c.instituteName === campusFilter);
  }, [rows, campusFilter]);

  const totals = useMemo(() => sumCounts(filtered), [filtered]);
  const { currentPage, totalPages, paged } = usePaging(
    filtered,
    page,
    pageSize,
  );
  const selected = campusFilter === "all" ? null : filtered[0];
  const studentTotal = filtered.reduce((sum, row) => sum + row.studentCount, 0);
  const names = campusNames.length
    ? campusNames
    : omitExcludedInstitutes(rows.map((c) => c.instituteName));

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Assessments"
        subtitle={filterContext(
          campusFilter,
          semester,
          selected
            ? [
                `${selected.studentCount.toLocaleString()} students`,
                `${selected.subjectCount.toLocaleString()} subjects`,
              ]
            : campusFilter === "all" && !loading
              ? [
                  `${filtered.length.toLocaleString()} campuses`,
                  `${studentTotal.toLocaleString()} students`,
                ]
              : [],
        )}
      />
      <Toolbar
        showSearch={false}
        extraFilter={
          <AssessmentFilters
            campus={campusFilter}
            semester={semester}
            campusNames={names}
            semesters={semesters}
            hideCampus={hideCampus}
            onCampusChange={(value) => {
              setPage(1);
              setLocation(assessmentsPath(value === "all" ? undefined : value));
            }}
            onSemesterChange={(next) => {
              setPage(1);
              setLocation(
                assessmentsPath(campusFilter, next || undefined),
              );
            }}
          />
        }
        loading={loading}
        exportDisabled={filtered.length === 0 || loading}
        onExport={() => {
          exportCsv(
            "assessment-campus-stats.csv",
            [
              "Campus",
              "Students",
              "Subjects",
              "CQ unique completed",
              "CQ unique assigned",
              "MQ unique completed",
              "MQ unique assigned",
              "CQ student %",
              "MQ student %",
              "Overall student %",
            ],
            filtered.map((c) => [
              c.instituteName,
              c.studentCount,
              c.subjectCount,
              c.classroomCompleted,
              c.classroomTotal,
              c.moduleCompleted,
              c.moduleTotal,
              c.classroomPct,
              c.modulePct,
              c.completionPct,
            ]),
          );
        }}
      />
      {fetchError && (
        <div className="mb-4">
          <ErrorState message="Failed to load campus assessment counts." />
        </div>
      )}
      {!loading && filtered.length > 0 && (
        <SummaryStrip totals={totals} uniqueCounts />
      )}
      <CountTable
        title="Assessment counts by campus"
        subtitle={`${filtered.length.toLocaleString()} campus${filtered.length === 1 ? "" : "es"} · unique quizzes · click a row for subjects`}
        loading={loading}
        empty="No campuses found."
        firstColumn="Campus"
        rows={paged}
        nameOf={(c: AssessmentCampus) => c.instituteName}
        studentsOf={(c) => c.studentCount}
        onRowClick={(c) =>
          setLocation(
            assessmentSubjectsPath(
              c.instituteName,
              campusFilter === c.instituteName ? semester || undefined : undefined,
            ),
          )
        }
        pagination={{
          page: currentPage,
          totalPages,
          totalItems: filtered.length,
          pageSize,
          onPageChange: setPage,
          onPageSizeChange: (s) => {
            setPageSize(s);
            setPage(1);
          },
          itemLabel: "campuses",
        }}
      />
    </div>
  );
}

function SubjectList() {
  const { user } = useAuth();
  const isBoa = user?.role === "boa";
  const [, setLocation] = useLocation();
  const query = useQueryParams();
  const campus = query.get("campus") ?? "";
  const semester = query.get("semester") ?? "";
  const campusNames = useCampusNames();
  const semesters = useSemesters(campus);
  const [rows, setRows] = useState<AssessmentSubject[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounceValue(search, 300);
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(1);
  const hideCampus = Boolean(isBoa && user?.campuses?.length === 1);

  useEffect(() => {
    if (!campus) {
      setLocation(assessmentsPath());
    }
  }, [campus, setLocation]);

  useEffect(() => {
    if (!campus) return;
    let alive = true;
    setLoading(true);
    setFetchError(false);
    const params = new URLSearchParams({ campus });
    if (semester) params.set("semester", semester);
    fetch(`/api/dashboard/assessment-subjects?${params.toString()}`, {
      credentials: "include",
    })
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: AssessmentSubject[]) => {
        if (alive) setRows(data ?? []);
      })
      .catch(() => {
        if (alive) {
          setRows([]);
          setFetchError(true);
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [campus, semester]);

  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((s) => s.subjectTitle.toLowerCase().includes(q));
  }, [rows, debouncedSearch]);

  const totals = useMemo(() => sumCounts(filtered), [filtered]);
  const { currentPage, totalPages, paged } = usePaging(
    filtered,
    page,
    pageSize,
  );
  const studentCount = filtered.reduce(
    (max, row) => Math.max(max, row.studentCount),
    0,
  );

  return (
    <div className="flex flex-col">
      <PageBreadcrumb
        items={[
          {
            label: "Assessments",
            onClick: () => setLocation(assessmentsPath()),
          },
          { label: campus, current: true },
        ]}
      />
      <PageHeader
        title={campus || "Subjects"}
        subtitle={filterContext(
          campus,
          semester,
          loading
            ? []
            : [
                studentCount
                  ? `${studentCount.toLocaleString()} students`
                  : "",
                `${filtered.length.toLocaleString()} subjects`,
              ],
        )}
      />
      <Toolbar
        search={search}
        searchPlaceholder="Search subjects…"
        showSearch
        extraFilter={
          <AssessmentFilters
            campus={campus}
            semester={semester}
            campusNames={withCurrentCampus(campusNames, campus)}
            semesters={semesters}
            hideCampus={hideCampus}
            onCampusChange={(value) => {
              setPage(1);
              if (value === "all") {
                setLocation(assessmentsPath());
                return;
              }
              setLocation(assessmentSubjectsPath(value));
            }}
            onSemesterChange={(next) => {
              setPage(1);
              setLocation(assessmentSubjectsPath(campus, next || undefined));
            }}
          />
        }
        loading={loading}
        exportDisabled={filtered.length === 0 || loading}
        onSearch={(value) => {
          setSearch(value);
          setPage(1);
        }}
        onExport={() => {
          exportCsv(
            `assessment-subjects-${safeFileName(campus)}.csv`,
            [
              "Subject",
              "Students",
              "CQ unique completed",
              "CQ unique assigned",
              "MQ unique completed",
              "MQ unique assigned",
              "CQ student %",
              "MQ student %",
              "Overall student %",
            ],
            filtered.map((s) => [
              s.subjectTitle,
              s.studentCount,
              s.classroomCompleted,
              s.classroomTotal,
              s.moduleCompleted,
              s.moduleTotal,
              s.classroomPct,
              s.modulePct,
              s.completionPct,
            ]),
          );
        }}
      />
      {fetchError && (
        <div className="mb-4">
          <ErrorState message="Failed to load subject assessment counts." />
        </div>
      )}
      {!loading && filtered.length > 0 && (
        <SummaryStrip totals={totals} uniqueCounts />
      )}
      <CountTable
        title={`Assessment counts by subject · ${campus}`}
        subtitle={`${filtered.length.toLocaleString()} subject${filtered.length === 1 ? "" : "s"} · unique quizzes · click a row for students`}
        loading={loading}
        empty="No subjects found for this campus."
        firstColumn="Subject"
        rows={paged}
        nameOf={(s: AssessmentSubject) => s.subjectTitle}
        studentsOf={(s) => s.studentCount}
        onRowClick={(s) =>
          setLocation(
            assessmentStudentsPath(
              campus,
              s.subjectTitle,
              semester || undefined,
            ),
          )
        }
        pagination={{
          page: currentPage,
          totalPages,
          totalItems: filtered.length,
          pageSize,
          onPageChange: setPage,
          onPageSizeChange: (s) => {
            setPageSize(s);
            setPage(1);
          },
          itemLabel: "subjects",
        }}
      />
    </div>
  );
}

function StudentList() {
  const { user } = useAuth();
  const isBoa = user?.role === "boa";
  const [, setLocation] = useLocation();
  const query = useQueryParams();
  const campus = query.get("campus") ?? "";
  const subject = query.get("subject") ?? "";
  const semester = query.get("semester") ?? "";
  const campusNames = useCampusNames();
  const semesters = useSemesters(campus);
  const [rows, setRows] = useState<AssessmentStudent[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounceValue(search, 300);
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(1);
  const hideCampus = Boolean(isBoa && user?.campuses?.length === 1);

  useEffect(() => {
    if (!campus) {
      setLocation(assessmentsPath());
      return;
    }
    if (!subject) {
      setLocation(assessmentSubjectsPath(campus, semester || undefined));
    }
  }, [campus, subject, semester, setLocation]);

  useEffect(() => {
    if (!campus || !subject) return;
    let alive = true;
    setLoading(true);
    setFetchError(false);
    const params = new URLSearchParams({
      campus,
      subject,
      limit: String(FETCH_LIMIT),
    });
    if (semester) params.set("semester", semester);
    fetch(`/api/dashboard/assessment-students?${params.toString()}`, {
      credentials: "include",
    })
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: AssessmentStudent[]) => {
        if (alive) setRows(data ?? []);
      })
      .catch(() => {
        if (alive) {
          setRows([]);
          setFetchError(true);
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [campus, subject, semester]);

  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (s) =>
        s.studentName.toLowerCase().includes(q) ||
        s.studentId.toLowerCase().includes(q) ||
        (s.sectionName ?? "").toLowerCase().includes(q),
    );
  }, [rows, debouncedSearch]);

  const totals = useMemo(() => sumCounts(filtered), [filtered]);
  const { currentPage, totalPages, paged } = usePaging(
    filtered,
    page,
    pageSize,
  );

  return (
    <div className="flex flex-col">
      <PageBreadcrumb
        items={[
          {
            label: "Assessments",
            onClick: () => setLocation(assessmentsPath()),
          },
          {
            label: campus,
            onClick: () =>
              setLocation(assessmentSubjectsPath(campus, semester || undefined)),
          },
          { label: subject, current: true },
        ]}
      />
      <PageHeader
        title={subject || "Students"}
        subtitle={filterContext(
          campus,
          semester,
          loading
            ? [subject]
            : [subject, `${filtered.length.toLocaleString()} students`],
        )}
      />
      <Toolbar
        search={search}
        searchPlaceholder="Search student name or ID…"
        showSearch
        extraFilter={
          <AssessmentFilters
            campus={campus}
            semester={semester}
            campusNames={withCurrentCampus(campusNames, campus)}
            semesters={semesters}
            hideCampus={hideCampus}
            onCampusChange={(value) => {
              setPage(1);
              if (value === "all") {
                setLocation(assessmentsPath());
                return;
              }
              setLocation(assessmentSubjectsPath(value));
            }}
            onSemesterChange={(next) => {
              setPage(1);
              setLocation(
                assessmentStudentsPath(campus, subject, next || undefined),
              );
            }}
          />
        }
        loading={loading}
        exportDisabled={filtered.length === 0 || loading}
        onSearch={(value) => {
          setSearch(value);
          setPage(1);
        }}
        onExport={() => {
          exportCsv(
            `assessment-students-${safeFileName(campus)}-${safeFileName(subject)}.csv`,
            [
              "Student name",
              "Student ID",
              "Section",
              "CQ completed",
              "CQ assigned",
              "MQ completed",
              "MQ assigned",
              "Total completed",
              "Total assigned",
              "CQ student %",
              "MQ student %",
              "Overall student %",
            ],
            filtered.map((s) => [
              s.studentName,
              s.studentId,
              s.sectionName ?? "",
              s.classroomCompleted,
              s.classroomTotal,
              s.moduleCompleted,
              s.moduleTotal,
              s.totalCompleted,
              s.totalAssigned,
              s.classroomPct,
              s.modulePct,
              s.completionPct,
            ]),
          );
        }}
      />
      {fetchError && (
        <div className="mb-4">
          <ErrorState message="Failed to load student assessment counts." />
        </div>
      )}
      {!loading && filtered.length > 0 && <SummaryStrip totals={totals} />}
      <TableShell>
        <div className="border-b border-gray-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-gray-900">
            Assessment counts by student · {subject}
          </h2>
          <p className="mt-0.5 text-xs text-gray-500">
            {filtered.length.toLocaleString()} student
            {filtered.length === 1 ? "" : "s"} · this student's completed / assigned · incomplete first
          </p>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-gray-200 bg-gray-50 hover:bg-gray-50">
                <Th>Student name</Th>
                <Th>Student ID</Th>
                <Th>Section</Th>
                <Th className="text-right">CQ</Th>
                <Th className="text-right">MQ</Th>
                <Th className="text-right">Total</Th>
                <Th className="text-right">CQ %</Th>
                <Th className="text-right">MQ %</Th>
                <Th className="w-[180px] text-right">Overall %</Th>
                <Th className="w-20 text-right">SPI</Th>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={10}>
                      <Skeleton className="h-8 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : paged.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={10}
                    className="h-32 text-center text-gray-500"
                  >
                    No students found for this subject.
                  </TableCell>
                </TableRow>
              ) : (
                paged.map((s) => (
                  <TableRow
                    key={s.studentId}
                    className="border-b border-gray-200 hover:bg-gray-50"
                  >
                    <TableCell className="py-3 font-medium text-gray-900">
                      <div className="max-w-[240px] truncate" title={s.studentName}>
                        {s.studentName}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-gray-500">
                      <div className="max-w-[220px] truncate" title={s.studentId}>
                        {s.studentId}
                      </div>
                    </TableCell>
                    <TableCell className="text-gray-600">
                      {s.sectionName || "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <CountCell
                        completed={s.classroomCompleted}
                        total={s.classroomTotal}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <CountCell
                        completed={s.moduleCompleted}
                        total={s.moduleTotal}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <CountCell
                        completed={s.totalCompleted}
                        total={s.totalAssigned}
                      />
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">
                      {s.classroomTotal > 0 ? `${s.classroomPct}%` : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">
                      {s.moduleTotal > 0 ? `${s.modulePct}%` : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <PctBar pct={s.completionPct} />
                    </TableCell>
                    <TableCell className="text-right">
                      <a
                        href={s.spiPath}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:text-brand-700 hover:underline"
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
        {!loading && filtered.length > 0 && (
          <TablePagination
            page={currentPage}
            totalPages={totalPages}
            totalItems={filtered.length}
            pageSize={pageSize}
            pageSizeOptions={PAGE_SIZES}
            onPageChange={setPage}
            onPageSizeChange={(s) => {
              setPageSize(s);
              setPage(1);
            }}
            itemLabel="students"
          />
        )}
      </TableShell>
    </div>
  );
}

function usePaging<T>(rows: T[], page: number, pageSize: number) {
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paged = rows.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );
  return { currentPage, totalPages, paged };
}

function safeFileName(value: string) {
  return value.replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-") || "export";
}

function sumCounts(rows: AssessmentCounts[]): AssessmentCounts {
  const empty: AssessmentCounts = {
    classroomCompleted: 0,
    classroomTotal: 0,
    moduleCompleted: 0,
    moduleTotal: 0,
    totalCompleted: 0,
    totalAssigned: 0,
    classroomStudentCompleted: 0,
    classroomStudentTotal: 0,
    moduleStudentCompleted: 0,
    moduleStudentTotal: 0,
    classroomPct: 0,
    modulePct: 0,
    completionPct: 0,
  };
  const summed = rows.reduce((acc, row) => {
    acc.classroomCompleted += row.classroomCompleted;
    acc.classroomTotal += row.classroomTotal;
    acc.moduleCompleted += row.moduleCompleted;
    acc.moduleTotal += row.moduleTotal;
    acc.totalCompleted += row.totalCompleted;
    acc.totalAssigned += row.totalAssigned;
    acc.classroomStudentCompleted +=
      row.classroomStudentCompleted ?? row.classroomCompleted ?? 0;
    acc.classroomStudentTotal +=
      row.classroomStudentTotal ?? row.classroomTotal ?? 0;
    acc.moduleStudentCompleted +=
      row.moduleStudentCompleted ?? row.moduleCompleted ?? 0;
    acc.moduleStudentTotal +=
      row.moduleStudentTotal ?? row.moduleTotal ?? 0;
    return acc;
  }, empty);
  summed.classroomPct =
    summed.classroomStudentTotal > 0
      ? Math.round(
          (summed.classroomStudentCompleted / summed.classroomStudentTotal) *
            1000,
        ) / 10
      : 0;
  summed.modulePct =
    summed.moduleStudentTotal > 0
      ? Math.round(
          (summed.moduleStudentCompleted / summed.moduleStudentTotal) * 1000,
        ) / 10
      : 0;
  const studentCompleted =
    summed.classroomStudentCompleted + summed.moduleStudentCompleted;
  const studentAssigned =
    summed.classroomStudentTotal + summed.moduleStudentTotal;
  summed.completionPct =
    studentAssigned > 0
      ? Math.round((studentCompleted / studentAssigned) * 1000) / 10
      : 0;
  return summed;
}

function Toolbar({
  search,
  searchPlaceholder,
  showSearch,
  extraFilter,
  loading,
  exportDisabled,
  onSearch,
  onExport,
}: {
  search?: string;
  searchPlaceholder?: string;
  showSearch: boolean;
  extraFilter?: ReactNode;
  loading: boolean;
  exportDisabled: boolean;
  onSearch?: (value: string) => void;
  onExport: () => void;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {extraFilter}
      {showSearch && (
        <div className="relative min-w-[200px] sm:w-72">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            placeholder={searchPlaceholder}
            value={search}
            onChange={(e) => onSearch?.(e.target.value)}
            className="h-9 border-gray-200 pl-9"
          />
        </div>
      )}
      {loading && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
      <Button
        variant="outline"
        className="h-9 gap-2 border-gray-200"
        onClick={onExport}
        disabled={exportDisabled}
      >
        <Download className="h-4 w-4" /> Export
      </Button>
    </div>
  );
}

function CountTable<T extends AssessmentCounts>({
  title,
  subtitle,
  loading,
  empty,
  firstColumn,
  rows,
  nameOf,
  studentsOf,
  onRowClick,
  pagination,
}: {
  title: string;
  subtitle: string;
  loading: boolean;
  empty: string;
  firstColumn: string;
  rows: T[];
  nameOf: (row: T) => string;
  studentsOf: (row: T) => number;
  onRowClick: (row: T) => void;
  pagination: {
    page: number;
    totalPages: number;
    totalItems: number;
    pageSize: number;
    onPageChange: (p: number) => void;
    onPageSizeChange: (s: number) => void;
    itemLabel: string;
  };
}) {
  return (
    <TableShell>
      <div className="border-b border-gray-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        <p className="mt-0.5 text-xs text-gray-500">{subtitle}</p>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-b border-gray-200 bg-gray-50 hover:bg-gray-50">
              <Th>{firstColumn}</Th>
              <Th className="text-right">Students</Th>
              <Th className="text-right">CQ</Th>
              <Th className="text-right">MQ</Th>
              <Th className="text-right">Total</Th>
              <Th className="text-right">CQ %</Th>
              <Th className="text-right">MQ %</Th>
              <Th className="w-[160px] text-right">Overall %</Th>
              <Th className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={9}>
                    <Skeleton className="h-8 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="h-32 text-center text-gray-500">
                  {empty}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow
                  key={nameOf(row)}
                  className="cursor-pointer border-b border-gray-200 hover:bg-brand-50/40"
                  onClick={() => onRowClick(row)}
                >
                  <TableCell className="py-3 font-medium text-gray-900">
                    {nameOf(row)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-gray-600">
                    {studentsOf(row).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <CountCell
                      completed={row.classroomCompleted}
                      total={row.classroomTotal}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <CountCell
                      completed={row.moduleCompleted}
                      total={row.moduleTotal}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <CountCell
                      completed={row.totalCompleted}
                      total={row.totalAssigned}
                    />
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">
                    {row.classroomStudentTotal > 0
                      ? `${row.classroomPct}%`
                      : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">
                    {row.moduleStudentTotal > 0 ? `${row.modulePct}%` : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <PctBar pct={row.completionPct} />
                  </TableCell>
                  <TableCell className="text-right text-gray-300">
                    <ChevronRight className="ml-auto h-4 w-4" />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      {!loading && pagination.totalItems > 0 && (
        <TablePagination
          page={pagination.page}
          totalPages={pagination.totalPages}
          totalItems={pagination.totalItems}
          pageSize={pagination.pageSize}
          pageSizeOptions={PAGE_SIZES}
          onPageChange={pagination.onPageChange}
          onPageSizeChange={pagination.onPageSizeChange}
          itemLabel={pagination.itemLabel}
        />
      )}
    </TableShell>
  );
}

function SummaryStrip({
  totals,
  uniqueCounts = false,
}: {
  totals: AssessmentCounts;
  uniqueCounts?: boolean;
}) {
  return (
    <div className="mb-4 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 sm:grid-cols-3 lg:grid-cols-5">
      <Kpi
        label="Classroom quizzes"
        completed={totals.classroomCompleted}
        total={totals.classroomTotal}
        studentPct={totals.classroomPct}
        uniqueCounts={uniqueCounts}
      />
      <Kpi
        label="Module quizzes"
        completed={totals.moduleCompleted}
        total={totals.moduleTotal}
        studentPct={totals.modulePct}
        uniqueCounts={uniqueCounts}
      />
      <Kpi
        label="Total (CQ + MQ)"
        completed={totals.totalCompleted}
        total={totals.totalAssigned}
        studentPct={totals.completionPct}
        uniqueCounts={uniqueCounts}
      />
      <div className="bg-white px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
          Skills assessments
        </p>
        <p className="mt-1 flex items-center gap-1.5 text-sm text-gray-400">
          <Lock className="h-3.5 w-3.5" /> Coming soon
        </p>
      </div>
      <div className="bg-white px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
          Final skills assessment
        </p>
        <p className="mt-1 flex items-center gap-1.5 text-sm text-gray-400">
          <Lock className="h-3.5 w-3.5" /> Coming soon
        </p>
      </div>
    </div>
  );
}

function Kpi({
  label,
  completed,
  total,
  studentPct,
  uniqueCounts,
}: {
  label: string;
  completed: number;
  total: number;
  studentPct: number;
  uniqueCounts?: boolean;
}) {
  return (
    <div className="bg-white px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-gray-900">
        {completed.toLocaleString()}
        <span className="text-sm font-normal text-gray-400">
          {" "}
          / {total.toLocaleString()}
        </span>
      </p>
      {uniqueCounts ? (
        <p className="mt-0.5 text-[11px] text-gray-400">Unique quizzes</p>
      ) : (
        <p className="mt-0.5 text-[11px] text-gray-400">Student work</p>
      )}
      <p
        className="mt-0.5 text-xs font-medium tabular-nums"
        style={{ color: total > 0 ? pctTextColor(studentPct) : undefined }}
      >
        {total > 0
          ? `${studentPct}% student completion`
          : "No quizzes assigned"}
      </p>
    </div>
  );
}

function CountCell({
  completed,
  total,
}: {
  completed: number;
  total: number;
}) {
  if (total <= 0) {
    return <span className="text-gray-400">—</span>;
  }
  return (
    <span className="tabular-nums">
      <span className="font-semibold text-gray-900">
        {completed.toLocaleString()}
      </span>
      <span className="text-gray-400"> / {total.toLocaleString()}</span>
    </span>
  );
}

function PctBar({ pct }: { pct: number }) {
  return (
    <div className="flex items-center justify-end gap-3">
      <div className="hidden h-2 w-24 overflow-hidden rounded-full bg-gray-200 sm:block">
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
  );
}

function Th({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
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
