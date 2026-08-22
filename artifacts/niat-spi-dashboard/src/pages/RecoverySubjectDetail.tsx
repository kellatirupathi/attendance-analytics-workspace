import { useEffect, useMemo, useState } from "react";
import { useParams, useLocation } from "wouter";
import { PageHeader } from "@/components/PageHeader";
import { PageLoader } from "@/components/PageLoader";
import { ErrorState } from "@/components/PageStates";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  CalendarDays,
  CheckCircle2,
  Clock3,
  Download,
  Loader2,
  ChevronLeft,
  Search,
} from "lucide-react";
import { pctTextColor } from "@/lib/utils";
import { exportCsv } from "@/lib/csv";
import { useToast } from "@/hooks/use-toast";

interface RecoveryStudent {
  studentId: string;
  studentName: string;
  sectionName: string | null;
  attendancePct: number;
  presentCount: number;
  totalCount: number;
}

interface RecoverySubjectCard {
  subjectTitle: string;
  attendancePct: number;
  studentsBelow80Count: number;
  students: RecoveryStudent[];
}

interface RecoveryCampusData {
  campus: string;
  subjects: RecoverySubjectCard[];
  totalSubjectsInRecovery: number;
  totalStudentsInRecovery: number;
}

interface RecoveryProgress {
  campus: string;
  subject: string;
  totalTopics: number;
  topicsBelowThreshold: number;
  topicsRecovered: number;
  topicsRemaining: number;
  recoveryCompletionPct: number;
  sessionsHeld: number;
  sessionsCancelled: number;
  lastSession: { date: string; topics: string[] } | null;
  nextScheduled: { date: string; topics: string[] } | null;
}

function safeDecode(val: string | undefined): string | null {
  if (!val) return null;
  try {
    return decodeURIComponent(val);
  } catch {
    return null;
  }
}

function formatRecoveryDate(date: string): string {
  try {
    const d = new Date(`${date}T00:00:00`);
    if (isNaN(d.getTime())) return "Invalid date";
    return new Intl.DateTimeFormat(undefined, {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(d);
  } catch {
    return "Invalid date";
  }
}

export default function RecoverySubjectDetail() {
  const { toast } = useToast();
  const params = useParams();
  const [, setLocation] = useLocation();

  const rawCampus = params.campus;
  const rawSubject = params.subject;

  const campus = useMemo(() => safeDecode(rawCampus), [rawCampus]);
  const subject = useMemo(() => safeDecode(rawSubject), [rawSubject]);

  const [recoveryData, setRecoveryData] = useState<RecoveryCampusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [searchFilter, setSearchFilter] = useState("");
  
  const [recoveryProgress, setRecoveryProgress] = useState<RecoveryProgress | null>(null);
  const [progressLoading, setProgressLoading] = useState(false);
  const [progressError, setProgressError] = useState("");

  useEffect(() => {
    if (!campus) return;

    const controller = new AbortController();
    let active = true;
    
    async function fetchRecovery() {
      if (!active) return;
      setLoading(true);
      setError("");
      try {
        const response = await fetch(
          `/api/attendance/recovery/subjects?campus=${encodeURIComponent(campus!)}`,
          { signal: controller.signal }
        );
        if (!response.ok) {
          throw new Error("Failed to fetch recovery data");
        }
        const data = await response.json();
        if (active && !controller.signal.aborted) setRecoveryData(data);
      } catch (err) {
        if (!active || (err instanceof DOMException && err.name === "AbortError")) return;
        const message = err instanceof Error ? err.message : "Failed to fetch data";
        setError(message);
        toast({ variant: "destructive", title: "Error", description: message });
      } finally {
        if (active && !controller.signal.aborted) setLoading(false);
      }
    }

    fetchRecovery();
    return () => {
      active = false;
      controller.abort();
    };
  }, [campus, toast]);

  const selectedSubjectData = useMemo(() => {
    if (!recoveryData || !subject) return null;
    return (
      recoveryData.subjects.find((s) => s.subjectTitle === subject) ?? null
    );
  }, [recoveryData, subject]);

  useEffect(() => {
    if (!campus || !subject) return;

    const controller = new AbortController();
    let active = true;

    async function fetchProgress() {
      if (!active) return;
      setProgressLoading(true);
      setProgressError("");
      try {
        const queryParams = new URLSearchParams({
          campus: campus!,
          subject: subject!,
        });
        const response = await fetch(`/api/dashboard/recovery-progress?${queryParams}`, {
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error("Failed to load recovery progress");
        }
        const data = (await response.json()) as RecoveryProgress;
        if (active && !controller.signal.aborted) setRecoveryProgress(data);
      } catch (err) {
        if (!active || (err instanceof DOMException && err.name === "AbortError")) return;
        setProgressError(
          err instanceof Error ? err.message : "Failed to load recovery progress",
        );
      } finally {
        if (active && !controller.signal.aborted) setProgressLoading(false);
      }
    }

    fetchProgress();
    return () => {
      active = false;
      controller.abort();
    };
  }, [campus, subject]);

  const filteredStudents = useMemo(() => {
    if (!selectedSubjectData) return [];

    const lowerSearch = searchFilter.trim().toLowerCase();
    if (!lowerSearch) return selectedSubjectData.students;

    return selectedSubjectData.students.filter(
      (student) =>
        student.studentName.toLowerCase().includes(lowerSearch) ||
        student.studentId.toLowerCase().includes(lowerSearch),
    );
  }, [selectedSubjectData, searchFilter]);

  const handleExport = () => {
    if (!selectedSubjectData || !campus) {
      toast({ variant: "destructive", title: "No subject data available" });
      return;
    }

    const headers = [
      "Campus",
      "Subject",
      "Student ID",
      "Student Name",
      "Section",
      "Attendance",
      "Present/Total",
    ];
    const rows = selectedSubjectData.students.map(
      (student) => [
        campus,
        selectedSubjectData.subjectTitle,
        student.studentId,
        student.studentName,
        student.sectionName || "-",
        `${student.attendancePct.toFixed(1)}%`,
        `${student.presentCount}/${student.totalCount}`,
      ],
    );

    exportCsv(
      `recovery-${campus}-${selectedSubjectData.subjectTitle}-${new Date()
        .toISOString()
        .split("T")[0]}.csv`,
      headers,
      rows,
    );
  };

  const isMalformedUrl = (rawCampus && !campus) || (rawSubject && !subject);
  if (isMalformedUrl) {
    return (
      <div className="p-6">
        <ErrorState message="Invalid link. The campus or subject in the URL is malformed." />
        <Button className="mt-4" onClick={() => setLocation("/dashboard/recovery")}>
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
      </div>
    );
  }

  if (!selectedSubjectData) {
    return (
      <div className="p-6">
        <ErrorState message="Subject not found in recovery data." />
        <Button className="mt-4" onClick={() => setLocation("/dashboard/recovery")}>
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
          onClick={() => setLocation("/dashboard/recovery")}
          className="mb-4 -ml-3 text-slate-500 hover:text-slate-900 hover:bg-slate-100"
        >
          <ChevronLeft className="h-4 w-4 mr-1" />
          Back to Campus Subjects
        </Button>
        <PageHeader
          title={selectedSubjectData.subjectTitle}
          subtitle={`Campus: ${campus}`}
          right={
            <div className="flex items-center gap-3">
              <span className={`rounded-full px-3 py-1 text-sm font-semibold bg-white border ${pctTextColor(selectedSubjectData.attendancePct)}`}>
                {selectedSubjectData.attendancePct.toFixed(1)}% overall
              </span>
              <Button onClick={handleExport} variant="outline" size="sm">
                <Download className="mr-2 h-4 w-4" />
                Export CSV
              </Button>
            </div>
          }
        />
      </div>

      {progressLoading && (
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          <Loader2 className="h-4 w-4 animate-spin text-brand-600" />
          Loading recovery progress…
        </div>
      )}

      {progressError && !progressLoading && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Recovery progress is temporarily unavailable.
        </div>
      )}

      {recoveryProgress && !progressLoading && (
        <section
          aria-label="Recovery progress summary"
          className="rounded-xl border border-slate-200 bg-white shadow-sm p-5"
        >
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4 lg:gap-6 divide-y lg:divide-y-0 lg:divide-x divide-slate-100">
            <div className="flex items-center gap-3 pt-4 lg:pt-0">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600">
                <CalendarDays className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Sessions held</p>
                <p className="text-2xl font-bold text-slate-900 tabular-nums">
                  {recoveryProgress.sessionsHeld}
                </p>
              </div>
            </div>

            <div className="lg:pl-6 pt-4 lg:pt-0 min-w-0 flex flex-col justify-center">
              <div className="flex items-center justify-between gap-2 mb-1">
                <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                  Topics recovered
                </p>
                <span className="text-xs font-bold text-slate-700">
                  {recoveryProgress.recoveryCompletionPct}%
                </span>
              </div>
              <p className="text-sm font-semibold text-slate-900 mb-2">
                {recoveryProgress.topicsRecovered}{" "}
                <span className="font-normal text-slate-500">
                  of {recoveryProgress.topicsBelowThreshold} total
                </span>
              </p>
              <Progress
                value={Math.min(
                  Math.max(recoveryProgress.recoveryCompletionPct, 0),
                  100,
                )}
                className="h-2 bg-slate-100 [&>div]:bg-emerald-500"
              />
            </div>

            <div className="flex items-center gap-3 lg:pl-6 pt-4 lg:pt-0">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-600">
                <Clock3 className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Topics remaining</p>
                <p className="text-2xl font-bold text-slate-900 tabular-nums">
                  {recoveryProgress.topicsRemaining}
                </p>
              </div>
            </div>

            <div className="lg:pl-6 pt-4 lg:pt-0 min-w-0 flex flex-col justify-center">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Last session</p>
              {recoveryProgress.lastSession ? (
                <>
                  <p className="text-sm font-semibold text-slate-900">
                    {formatRecoveryDate(recoveryProgress.lastSession.date)}
                  </p>
                  <p
                    className="truncate text-xs text-slate-500 mt-0.5"
                    title={recoveryProgress.lastSession.topics.join(", ")}
                  >
                    {recoveryProgress.lastSession.topics.join(", ")}
                  </p>
                </>
              ) : (
                <p className="text-sm text-slate-500 mt-1">No session recorded</p>
              )}
            </div>
          </div>
        </section>
      )}

      <Tabs defaultValue="students" className="mt-2">
        <TabsList className="mb-4">
          <TabsTrigger value="students">Student List</TabsTrigger>
          <TabsTrigger value="sessions">Session Tracker</TabsTrigger>
        </TabsList>
        
        <TabsContent value="students" className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <label htmlFor="student-search" className="sr-only">
              Search by student name or ID
            </label>
            <input
              id="student-search"
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
                No students match your search.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">
                    List of students in {selectedSubjectData.subjectTitle} needing attendance recovery.
                  </caption>
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50">
                      <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-600">Student Name</th>
                      <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-600">Student ID</th>
                      <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-600">Section</th>
                      <th className="px-5 py-3 text-center text-xs font-semibold uppercase tracking-wider text-slate-600">Attendance</th>
                      <th className="px-5 py-3 text-center text-xs font-semibold uppercase tracking-wider text-slate-600">Sessions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredStudents.map((student) => (
                      <tr key={student.studentId} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-5 py-3.5 font-medium text-slate-900">{student.studentName}</td>
                        <td className="px-5 py-3.5 font-mono text-xs text-slate-600">{student.studentId}</td>
                        <td className="px-5 py-3.5 text-slate-600">{student.sectionName || "-"}</td>
                        <td className="px-5 py-3.5">
                          <div className="flex justify-center">
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded text-xs font-semibold ${pctTextColor(student.attendancePct)} bg-white border border-slate-200 shadow-xs`}>
                              {student.attendancePct.toFixed(1)}%
                            </span>
                          </div>
                        </td>
                        <td className="px-5 py-3.5 text-center text-slate-600 tabular-nums font-medium">
                          {student.presentCount}/{student.totalCount}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </TabsContent>
        
        <TabsContent value="sessions">
          <div className="rounded-xl border border-slate-200 bg-white p-12 text-center flex flex-col items-center justify-center min-h-[300px]">
            <CalendarDays className="h-12 w-12 text-slate-300 mb-4" />
            <h3 className="text-lg font-medium text-slate-900 mb-1">Session Tracker</h3>
            <p className="text-slate-500 max-w-sm">
              Detailed tracking of recovery sessions and topic completion will be available in Phase 2.
            </p>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}