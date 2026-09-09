import { useEffect, useMemo, useState } from "react";
import { useParams, useLocation } from "wouter";
import { PageHeader } from "@/components/PageHeader";
import { PageLoader } from "@/components/PageLoader";
import { ErrorState } from "@/components/PageStates";
import { Button } from "@/components/ui/button";
import { recoveryListPath } from "@/components/SubNav";
import { useQueryParams } from "@/hooks/useQueryParams";
import {
  ChevronLeft,
  Download,
  ExternalLink,
  Search,
} from "lucide-react";
import { pctTextColor } from "@/lib/utils";
import { exportCsv } from "@/lib/csv";
import { useToast } from "@/hooks/use-toast";

interface QuizRecoveryStudent {
  studentId: string;
  studentName: string;
  sectionName: string | null;
  attendancePct: number;
  presentCount: number;
  totalCount: number;
  classroomAvg: number | null;
  classroomCompleted: number;
  classroomTotal: number;
  moduleAvg: number | null;
  moduleCompleted: number;
  moduleTotal: number;
  spiPath: string;
}

function safeDecode(val: string | undefined): string | null {
  if (!val) return null;
  try {
    return decodeURIComponent(val);
  } catch {
    return null;
  }
}

function quizTypeFails(completed: number, total: number, avg: number | null): boolean {
  return total > 0 && (completed < total || (avg ?? 0) < 100);
}

function formatQuiz(completed: number, total: number, avg: number | null): string {
  if (total <= 0) return "—";
  const avgText = avg === null ? "—" : `${avg.toFixed(1)}%`;
  return `${completed}/${total} · ${avgText}`;
}

export default function RecoveryQuizSubjectDetail() {
  const { toast } = useToast();
  const params = useParams();
  const [, setLocation] = useLocation();

  const rawCampus = params.campus;
  const rawSubject = params.subject;
  const query = useQueryParams();
  const campus = useMemo(() => safeDecode(rawCampus), [rawCampus]);
  const subject = useMemo(() => safeDecode(rawSubject), [rawSubject]);
  const semester = query.get("semester") ?? "";

  const [students, setStudents] = useState<QuizRecoveryStudent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchFilter, setSearchFilter] = useState("");

  const backHref = recoveryListPath("quiz", campus ?? "", semester);

  useEffect(() => {
    if (!campus || !subject || !semester) {
      setLoading(false);
      if (!semester) setError("Semester is required.");
      return;
    }

    const controller = new AbortController();
    let active = true;

    async function fetchStudents() {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(
          `/api/attendance/recovery/quiz-students?${new URLSearchParams({
            campus: campus!,
            semester,
            subject: subject!,
          })}`,
          { signal: controller.signal },
        );
        if (!response.ok) throw new Error("Failed to fetch quiz recovery students");
        const data = (await response.json()) as QuizRecoveryStudent[];
        if (active && !controller.signal.aborted) setStudents(data);
      } catch (err) {
        if (!active || (err instanceof DOMException && err.name === "AbortError")) return;
        const message = err instanceof Error ? err.message : "Failed to fetch data";
        setError(message);
        toast({ variant: "destructive", title: "Error", description: message });
      } finally {
        if (active && !controller.signal.aborted) setLoading(false);
      }
    }

    fetchStudents();
    return () => {
      active = false;
      controller.abort();
    };
  }, [campus, semester, subject, toast]);

  const filteredStudents = useMemo(() => {
    const lowerSearch = searchFilter.trim().toLowerCase();
    if (!lowerSearch) return students;
    return students.filter(
      (student) =>
        student.studentName.toLowerCase().includes(lowerSearch) ||
        student.studentId.toLowerCase().includes(lowerSearch),
    );
  }, [students, searchFilter]);

  const handleExport = () => {
    if (!campus || !subject) {
      toast({ variant: "destructive", title: "No subject data available" });
      return;
    }
    exportCsv(
      `quiz-recovery-${campus}-${subject}-${new Date().toISOString().split("T")[0]}.csv`,
      [
        "Campus",
        "Subject",
        "Student ID",
        "Student Name",
        "Section",
        "Attendance",
        "Present/Total",
        "C.Q completed",
        "C.Q total",
        "C.Q avg",
        "M.Q completed",
        "M.Q total",
        "M.Q avg",
      ],
      students.map((student) => [
        campus,
        subject,
        student.studentId,
        student.studentName,
        student.sectionName || "-",
        `${student.attendancePct.toFixed(1)}%`,
        `${student.presentCount}/${student.totalCount}`,
        student.classroomCompleted,
        student.classroomTotal,
        student.classroomAvg ?? "",
        student.moduleCompleted,
        student.moduleTotal,
        student.moduleAvg ?? "",
      ]),
    );
  };

  const isMalformedUrl = (rawCampus && !campus) || (rawSubject && !subject);
  if (isMalformedUrl) {
    return (
      <div className="p-6">
        <ErrorState message="Invalid link. The campus or subject in the URL is malformed." />
        <Button className="mt-4" onClick={() => setLocation(backHref)}>
          Back to Recovery
        </Button>
      </div>
    );
  }

  if (loading) {
    return <PageLoader />;
  }

  if (error) {
    return (
      <div className="p-6">
        <ErrorState message={error} onRetry={() => window.location.reload()} />
        <Button className="mt-4" variant="outline" onClick={() => setLocation(backHref)}>
          Back to Recovery
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6 animate-in fade-in duration-300">
      <div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setLocation(backHref)}
          className="mb-4 -ml-3 text-slate-500 hover:text-slate-900 hover:bg-slate-100"
        >
          <ChevronLeft className="h-4 w-4 mr-1" />
          Back to Quizzes
        </Button>
        <PageHeader
          title={subject ?? "Quizzes"}
          subtitle={`Campus: ${campus}${semester ? ` · ${semester}` : ""} · Lecture attendance ≥ 80%`}
          right={
            <Button onClick={handleExport} variant="outline" size="sm">
              <Download className="mr-2 h-4 w-4" />
              Export CSV
            </Button>
          }
        />
      </div>

      <p className="text-sm text-slate-600">
        These students already meet the 80% lecture bar. Follow up on classroom
        and module quizzes — lecture recovery is not scheduled from this list.
      </p>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <label htmlFor="quiz-student-search" className="sr-only">
          Search by student name or ID
        </label>
        <input
          id="quiz-student-search"
          type="text"
          placeholder="Search by student name or ID..."
          value={searchFilter}
          onChange={(e) => setSearchFilter(e.target.value)}
          className="w-full sm:max-w-md rounded-lg border border-slate-300 pl-10 pr-4 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 transition-shadow"
        />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
        {filteredStudents.length === 0 ? (
          <div className="p-12 text-center text-slate-500 bg-slate-50/50">
            {students.length === 0
              ? "No students in this subject need quiz follow-up."
              : "No students match your search."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">
                Students in {subject} with 80%+ attendance who are not at 100% on classroom or module quizzes.
              </caption>
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-600">
                    Student Name
                  </th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-600">
                    Student ID
                  </th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-600">
                    Section
                  </th>
                  <th className="px-5 py-3 text-center text-xs font-semibold uppercase tracking-wider text-slate-600">
                    Attendance
                  </th>
                  <th className="px-5 py-3 text-center text-xs font-semibold uppercase tracking-wider text-slate-600">
                    C.Q
                  </th>
                  <th className="px-5 py-3 text-center text-xs font-semibold uppercase tracking-wider text-slate-600">
                    M.Q
                  </th>
                  <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-600">
                    SPI
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredStudents.map((student) => {
                  const cqFail = quizTypeFails(
                    student.classroomCompleted,
                    student.classroomTotal,
                    student.classroomAvg,
                  );
                  const mqFail = quizTypeFails(
                    student.moduleCompleted,
                    student.moduleTotal,
                    student.moduleAvg,
                  );
                  return (
                    <tr key={student.studentId} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-5 py-3.5 font-medium text-slate-900">{student.studentName}</td>
                      <td className="px-5 py-3.5 font-mono text-xs text-slate-600">{student.studentId}</td>
                      <td className="px-5 py-3.5 text-slate-600">{student.sectionName || "-"}</td>
                      <td className="px-5 py-3.5">
                        <div className="flex justify-center">
                          <span
                            className={`inline-flex items-center px-2.5 py-0.5 rounded text-xs font-semibold ${pctTextColor(student.attendancePct)} bg-white border border-slate-200 shadow-xs`}
                          >
                            {student.attendancePct.toFixed(1)}%
                          </span>
                        </div>
                      </td>
                      <td
                        className={`px-5 py-3.5 text-center tabular-nums ${cqFail ? "font-semibold text-amber-700" : "text-slate-600"}`}
                      >
                        {formatQuiz(
                          student.classroomCompleted,
                          student.classroomTotal,
                          student.classroomAvg,
                        )}
                      </td>
                      <td
                        className={`px-5 py-3.5 text-center tabular-nums ${mqFail ? "font-semibold text-amber-700" : "text-slate-600"}`}
                      >
                        {formatQuiz(
                          student.moduleCompleted,
                          student.moduleTotal,
                          student.moduleAvg,
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <a
                          href={student.spiPath}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:text-brand-700 hover:underline"
                        >
                          Open <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
