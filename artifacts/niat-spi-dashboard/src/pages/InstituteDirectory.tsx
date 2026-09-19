import { useEffect, useMemo, useState, Fragment } from "react";
import { ChevronDown, Download, GraduationCap, Search } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { ErrorState } from "@/components/PageStates";
import { PageLoader } from "@/components/PageLoader";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TableShell } from "@/components/DataTable";
import { exportCsv } from "@/lib/csv";
import { cn } from "@/lib/utils";
import { useDebounceValue } from "@/hooks/useDebounceValue";

interface InstituteSemesterRow {
  semesterTitle: string;
  isCurrent: boolean;
  subjectCount: number;
  sectionCount: number;
  studentCount: number;
  subjects: string[];
  sections: string[];
}

interface InstituteDirectoryItem {
  instituteName: string;
  currentSemesters: string[];
  semesterCount: number;
  subjectCount: number;
  sectionCount: number;
  studentCount: number;
  semesters: InstituteSemesterRow[];
}

function ChipList({
  items,
  empty,
}: {
  items: string[];
  empty: string;
}) {
  if (items.length === 0) {
    return <p className="text-sm text-gray-500">{empty}</p>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <span
          key={item}
          className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-xs font-medium text-slate-700"
        >
          {item}
        </span>
      ))}
    </div>
  );
}

export default function InstituteDirectory() {
  const [rows, setRows] = useState<InstituteDirectoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounceValue(search, 250);
  const [openInstitute, setOpenInstitute] = useState<string | null>(null);
  const [openSemester, setOpenSemester] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setFetchError(false);
    fetch("/api/dashboard/institute-directory", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: InstituteDirectoryItem[]) => {
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
  }, []);

  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => {
      if (row.instituteName.toLowerCase().includes(q)) return true;
      return row.semesters.some(
        (semester) =>
          semester.semesterTitle.toLowerCase().includes(q) ||
          semester.subjects.some((subject) =>
            subject.toLowerCase().includes(q),
          ) ||
          semester.sections.some((section) =>
            section.toLowerCase().includes(q),
          ),
      );
    });
  }, [rows, debouncedSearch]);

  const totals = useMemo(() => {
    const current = new Set<string>();
    let students = 0;
    for (const row of filtered) {
      row.currentSemesters.forEach((semester) =>
        current.add(`${row.instituteName}:${semester}`),
      );
      students += row.studentCount;
    }
    return {
      institutes: filtered.length,
      currentPrograms: current.size,
      students,
    };
  }, [filtered]);

  const handleExport = () => {
    exportCsv(
      "institute-directory.csv",
      [
        "Institute",
        "Semester",
        "Current",
        "Subjects",
        "Sections",
        "Students",
        "Subject list",
        "Section list",
      ],
      filtered.flatMap((row) =>
        row.semesters.map((semester) => [
          row.instituteName,
          semester.semesterTitle,
          semester.isCurrent ? "Yes" : "No",
          semester.subjectCount,
          semester.sectionCount,
          semester.studentCount,
          semester.subjects.join("; "),
          semester.sections.join("; "),
        ]),
      ),
    );
  };

  if (loading) return <PageLoader label="Loading institute directory…" />;

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Institute Directory"
        subtitle="Running semesters, subjects, sections, and student counts for each institute. Staff view only."
        right={
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[200px] sm:w-64">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                placeholder="Search institutes, subjects, sections…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-9 border-gray-200 pl-9"
              />
            </div>
            <Button
              variant="outline"
              className="h-9 gap-2 border-gray-200"
              onClick={handleExport}
              disabled={filtered.length === 0}
            >
              <Download className="h-4 w-4" /> Export
            </Button>
          </div>
        }
      />

      {fetchError && (
        <div className="mb-4">
          <ErrorState message="Failed to load institute directory." />
        </div>
      )}

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Institutes
          </p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">
            {totals.institutes.toLocaleString()}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Current semesters running
          </p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">
            {totals.currentPrograms.toLocaleString()}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Students (semester-wise)
          </p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">
            {totals.students.toLocaleString()}
          </p>
        </div>
      </div>

      <TableShell>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-gray-200 bg-gray-50 hover:bg-gray-50">
                <TableHead className="h-11 px-3 text-[11px] font-semibold uppercase tracking-wider text-gray-600">
                  Institute
                </TableHead>
                <TableHead className="h-11 px-3 text-[11px] font-semibold uppercase tracking-wider text-gray-600">
                  Current semester
                </TableHead>
                <TableHead className="h-11 px-3 text-right text-[11px] font-semibold uppercase tracking-wider text-gray-600">
                  Semesters
                </TableHead>
                <TableHead className="h-11 px-3 text-right text-[11px] font-semibold uppercase tracking-wider text-gray-600">
                  Subjects
                </TableHead>
                <TableHead className="h-11 px-3 text-right text-[11px] font-semibold uppercase tracking-wider text-gray-600">
                  Sections
                </TableHead>
                <TableHead className="h-11 px-3 text-right text-[11px] font-semibold uppercase tracking-wider text-gray-600">
                  Students
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-gray-500">
                    No institutes found.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((row) => {
                  const open = openInstitute === row.instituteName;
                  return (
                    <Fragment key={row.instituteName}>
                      <TableRow
                        key={row.instituteName}
                        className="cursor-pointer border-b border-gray-200 hover:bg-gray-50"
                        onClick={() => {
                          setOpenInstitute(open ? null : row.instituteName);
                          setOpenSemester(null);
                        }}
                      >
                        <TableCell className="py-3 font-medium text-gray-900">
                          <span className="inline-flex items-center gap-2">
                            <ChevronDown
                              className={cn(
                                "h-4 w-4 text-gray-400 transition-transform",
                                open && "rotate-180",
                              )}
                            />
                            {row.instituteName}
                          </span>
                        </TableCell>
                        <TableCell>
                          {row.currentSemesters.length === 0 ? (
                            <span className="text-sm text-gray-400">None flagged</span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {row.currentSemesters.map((semester) => (
                                <span
                                  key={semester}
                                  className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700"
                                >
                                  <GraduationCap className="h-3 w-3" />
                                  {semester}
                                </span>
                              ))}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-gray-600">
                          {row.semesterCount}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-gray-600">
                          {row.subjectCount}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-gray-600">
                          {row.sectionCount}
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-semibold text-gray-900">
                          {row.studentCount.toLocaleString()}
                        </TableCell>
                      </TableRow>
                      {open && (
                        <TableRow
                          key={`${row.instituteName}-detail`}
                          className="border-b border-gray-200 bg-slate-50/80 hover:bg-slate-50/80"
                        >
                          <TableCell colSpan={6} className="px-4 py-4">
                            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
                              Semester-wise details
                            </p>
                            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                              <Table>
                                <TableHeader>
                                  <TableRow className="bg-slate-50 hover:bg-slate-50">
                                    <TableHead className="text-xs">Semester</TableHead>
                                    <TableHead className="text-right text-xs">
                                      Subjects
                                    </TableHead>
                                    <TableHead className="text-right text-xs">
                                      Sections
                                    </TableHead>
                                    <TableHead className="text-right text-xs">
                                      Students
                                    </TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {row.semesters.map((semester) => {
                                    const key = `${row.instituteName}:${semester.semesterTitle}`;
                                    const semesterOpen = openSemester === key;
                                    return (
                                      <Fragment key={key}>
                                        <TableRow
                                          className="cursor-pointer hover:bg-slate-50"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setOpenSemester(
                                              semesterOpen ? null : key,
                                            );
                                          }}
                                        >
                                          <TableCell className="font-medium">
                                            <span className="inline-flex items-center gap-2">
                                              {semester.semesterTitle}
                                              {semester.isCurrent && (
                                                <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">
                                                  Current
                                                </span>
                                              )}
                                            </span>
                                          </TableCell>
                                          <TableCell className="text-right tabular-nums">
                                            {semester.subjectCount}
                                          </TableCell>
                                          <TableCell className="text-right tabular-nums">
                                            {semester.sectionCount}
                                          </TableCell>
                                          <TableCell className="text-right tabular-nums font-semibold">
                                            {semester.studentCount.toLocaleString()}
                                          </TableCell>
                                        </TableRow>
                                        {semesterOpen && (
                                          <TableRow
                                            key={`${key}-lists`}
                                            className="hover:bg-white"
                                          >
                                            <TableCell colSpan={4} className="bg-slate-50/70 px-4 py-3">
                                              <div className="grid gap-4 md:grid-cols-2">
                                                <div>
                                                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                                                    Subjects ({semester.subjectCount})
                                                  </p>
                                                  <ChipList
                                                    items={semester.subjects}
                                                    empty="No subjects in attendance data."
                                                  />
                                                </div>
                                                <div>
                                                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                                                    Sections ({semester.sectionCount})
                                                  </p>
                                                  <ChipList
                                                    items={semester.sections}
                                                    empty="No sections in attendance data."
                                                  />
                                                </div>
                                              </div>
                                            </TableCell>
                                          </TableRow>
                                        )}
                                      </Fragment>
                                    );
                                  })}
                                </TableBody>
                              </Table>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </TableShell>
    </div>
  );
}
