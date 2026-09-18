import { useEffect, useMemo, useState } from "react";
import { useParams, useLocation } from "wouter";
import { PageHeader } from "@/components/PageHeader";
import { PageLoader } from "@/components/PageLoader";
import { ErrorState } from "@/components/PageStates";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SearchableSelect } from "@/components/SearchableSelect";
import {
  CalendarPlus,
  CheckCircle2,
  Clock3,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  ChevronLeft,
  RotateCcw,
  Search,
  Trash2,
  Wallet,
} from "lucide-react";
import { cn, pctTextColor } from "@/lib/utils";
import { exportCsv } from "@/lib/csv";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";

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

interface CampusInstructor {
  instructorUserId: string;
  employeeId: string;
  name: string;
  category: string;
  role: string;
  /** Which campus this instructor is normally on staff at. */
  institute: string;
}

interface SubjectProdSequenceItem {
  sessionId: string;
  order: number;
  week: number | null;
  topicTitle: string;
  sessionType: string | null;
  completed: boolean;
  completedAt: string | null;
  completedSections: number;
  totalSections: number;
}

/*
interface SessionTrackerRow {
  sequenceNo: number;
  weekNo: number | null;
  topicTitle: string;
  unitId: string | null;
  attendancePct: number | null;
  presentCount: number;
  totalCount: number;
  status: 'not_taught' | 'ok' | 'needs_recovery' | 'recovery_scheduled' | 'recovered';
  recoverySession: {
    date: string;
    instructorName: string;
    instructorType: 'campus' | 'backup' | 'unknown';
    wasCovered: boolean | null;
  } | null;
}
*/
interface SessionTrackerRow {
  sequenceNo: number;
  weekNo: number | null;
  topicTitle: string;
  unitId: string | null;
  attendancePct: number | null;
  presentCount: number | null;
  totalCount: number | null;
  status: "not_taught" | "completed" | "ok" | "needs_recovery" | "recovery_scheduled" | "recovered";
  prodStatus: "pending" | "completed";
  completedAt: string | null;
  recoverySession: {
    id: string;
    date: string;
    instructorName: string;
    instructorType: "campus" | "backup" | "unknown";
    wasCovered: boolean | null;
    instructorId: string | null;
    remarks: string;
    qaReportUrls: string[];
  } | null;
}

interface MarkCompleteTopic {
  id: string;
  sequenceNo: number;
  title: string;
}

type SessionOutcomeStatus = "conducted" | "partial" | "no_show";

const SESSION_STATUS_OPTIONS: { value: SessionOutcomeStatus; label: string }[] = [
  { value: "conducted", label: "Completed" },
  { value: "partial", label: "Partially Completed" },
  { value: "no_show", label: "Not Completed" },
];

function SessionStatusBadge({ status }: { status: SessionTrackerRow['status'] }) {
  switch (status) {
    case 'completed':
      return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700">Completed</span>;
    case 'not_taught':
      return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-600">Not taught</span>;
    case 'ok':
      return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-100 text-emerald-700">OK</span>;
    case 'needs_recovery':
      return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">Need Recovery</span>;
    case 'recovery_scheduled':
      return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700">Scheduled</span>;
    case 'recovered':
      return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700">Recovered</span>;
    default:
      return null;
  }
}

function InstructorTypeBadge({ type }: { type: 'campus' | 'backup' | 'unknown' }) {
  if (!type || type === 'unknown') return <span className="text-slate-400">-</span>;
  if (type === 'campus') return <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600 border border-slate-200 uppercase tracking-wider">Campus</span>;
  if (type === 'backup') return <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-purple-100 text-purple-700 border border-purple-200 uppercase tracking-wider">Backup</span>;
  return null;
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

function getStatusDisplay(status: SessionTrackerRow["status"]) {
  switch (status) {
    case "not_taught":
      return { label: "Not Taught", className: "bg-slate-50 text-slate-600 border-slate-200" };
    case "completed":
      return { label: "Completed", className: "bg-blue-50 text-blue-700 border-blue-200" };
    case "ok":
      return { label: "OK", className: "bg-emerald-50 text-emerald-700 border-emerald-200" };
    case "needs_recovery":
      return { label: "Need Recovery", className: "bg-rose-50 text-rose-700 border-rose-200" };
    case "recovery_scheduled":
      return { label: "Scheduled", className: "bg-amber-50 text-amber-700 border-amber-200" };
    case "recovered":
      return { label: "Recovered", className: "bg-brand-50 text-brand-700 border-brand-200" };
    default:
      return { label: status, className: "bg-slate-50 text-slate-600 border-slate-200" };
  }
}
/*
export default function RecoverySubjectDetail() {
  const { toast } = useToast();
  const params = useParams();
  const [, setLocation] = useLocation();

  const rawCampus = params.campus;
  const rawSubject = params.subject;

  const campus = useMemo(() => safeDecode(rawCampus), [rawCampus]);
  const subject = useMemo(() => safeDecode(rawSubject), [rawSubject]);
  const semester = useMemo(
    () => new URLSearchParams(window.location.search).get("semester") ?? "",
    [],
  );
  const semester = useMemo(
    () => new URLSearchParams(window.location.search).get("semester") ?? "",
    [],
  );

  const [recoveryData, setRecoveryData] = useState<RecoveryCampusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [searchFilter, setSearchFilter] = useState("");

  const [recoveryProgress, setRecoveryProgress] = useState<RecoveryProgress | null>(null);
  const [progressLoading, setProgressLoading] = useState(false);
  const [progressError, setProgressError] = useState("");

  const [sessions, setSessions] = useState<SessionTrackerRow[] | null>(null);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState("");
  const [sessionRetryTrigger, setSessionRetryTrigger] = useState(0);

  useEffect(() => {
    if (!campus) return;

    const controller = new AbortController();
    let active = true;
    
    async function fetchRecovery() {
      if (!active) return;
      setLoading(true);
      setError("");
      try {
        const subjectParams = new URLSearchParams({ campus: campus! });
        if (semester) subjectParams.set("semester", semester);
        const requests: Promise<Response>[] = [
          fetch(`/api/attendance/recovery/subjects?${subjectParams}`, {
            signal: controller.signal,
          }),
        ];
        if (semester && subject) {
          requests.push(
            fetch(
              `/api/attendance/recovery/students?${new URLSearchParams({
                campus: campus!,
                semester,
                subject,
              })}`,
              { signal: controller.signal },
            ),
          );
        }
        const [response, studentsResponse] = await Promise.all(requests);
        if (!response.ok || (studentsResponse && !studentsResponse.ok)) {
          throw new Error("Failed to fetch recovery data");
        }
        const data = (await response.json()) as RecoveryCampusData;
        if (studentsResponse && subject) {
          const students = (await studentsResponse.json()) as RecoveryStudent[];
          data.subjects = data.subjects.map((item) =>
            item.subjectTitle === subject ? { ...item, students } : item,
          );
        }
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
  }, [campus, semester, subject, toast]);

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

  useEffect(() => {
    if (!campus || !subject) return;

    const controller = new AbortController();
    let active = true;

    async function fetchTracker() {
      if (!active) return;
      setSessionsLoading(true);
      setSessionsError("");
      try {
        const queryParams = new URLSearchParams({
          campus: campus!,
          subject: subject!,
        });
        const response = await fetch(`/api/dashboard/session-tracker?${queryParams}`, {
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error("Failed to load session tracker");
        }
        const data = (await response.json()) as SessionTrackerRow[];
        if (active && !controller.signal.aborted) setSessions(data);
      } catch (err) {
        if (!active || (err instanceof DOMException && err.name === "AbortError")) return;
        setSessionsError(
          err instanceof Error ? err.message : "Failed to load session tracker",
        );
      } finally {
        if (active && !controller.signal.aborted) setSessionsLoading(false);
      }
    }

    fetchTracker();
    return () => {
      active = false;
      controller.abort();
    };
  }, [campus, subject, sessionRetryTrigger]);

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
          subtitle={`Campus: ${campus}${semester ? ` · ${semester}` : ""}`}
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
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:gap-6 divide-y lg:divide-y-0 lg:divide-x divide-slate-100">
            <div className="pt-4 lg:pt-0 min-w-0 flex flex-col justify-center">
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
        
        <TabsContent value="sessions" className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
            {sessionsLoading && !sessions ? (
              <div className="p-12 text-center flex flex-col items-center justify-center min-h-[300px]">
                <Loader2 className="h-8 w-8 animate-spin text-brand-600 mb-4" />
                <p className="text-slate-500">Loading session tracker...</p>
              </div>
            ) : sessionsError ? (
              <div className="p-12 text-center flex flex-col items-center justify-center min-h-[300px]">
                <ErrorState message={sessionsError} onRetry={() => setSessionRetryTrigger(t => t + 1)} />
              </div>
            ) : sessions?.length === 0 ? (
              <div className="p-12 text-center text-slate-500 bg-slate-50/50 min-h-[300px] flex items-center justify-center">
                No session data found for this subject.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">
                    Session Tracker for {selectedSubjectData.subjectTitle}.
                  </caption>
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50">
                      <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-600 w-16">#</th>
                      <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-600 w-20">Week</th>
                      <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-600 min-w-[200px]">Topic</th>
                      <th className="px-5 py-3 text-center text-xs font-semibold uppercase tracking-wider text-slate-600 w-32">Regular Att. %</th>
                      <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-600 w-36">Status</th>
                      <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-600 w-32">Recovery Date</th>
                      <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-600 min-w-[160px]">Recovery Instructor</th>
                      <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-600 w-28">Type</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {sessions?.map((session) => (
                      <tr key={session.sequenceNo} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-5 py-3.5 text-slate-600 tabular-nums">{session.sequenceNo}</td>
                        <td className="px-5 py-3.5 text-slate-600 tabular-nums">{session.weekNo ?? "-"}</td>
                        <td className="px-5 py-3.5 font-medium text-slate-900">{session.topicTitle}</td>
                        <td className="px-5 py-3.5 text-center">
                          {session.status === 'not_taught' ? (
                            <span className="text-slate-500 text-xs font-medium uppercase tracking-wider">Not taught</span>
                          ) : session.attendancePct !== null ? (
                            <div className="flex flex-col items-center justify-center">
                              <span className={`inline-flex items-center px-2.5 py-0.5 rounded text-xs font-semibold ${pctTextColor(session.attendancePct)} bg-white border border-slate-200 shadow-xs mb-0.5`}>
                                {session.attendancePct.toFixed(1)}%
                              </span>
                              <span className="text-[10px] text-slate-400 font-medium tabular-nums">{session.presentCount}/{session.totalCount}</span>
                            </div>
                          ) : (
                            <span className="text-slate-400">-</span>
                          )}
                        </td>
                        <td className="px-5 py-3.5">
                          <SessionStatusBadge status={session.status} />
                        </td>
                        <td className="px-5 py-3.5 text-slate-600 whitespace-nowrap">
                          {session.recoverySession ? formatRecoveryDate(session.recoverySession.date) : ""}
                        </td>
                        <td className="px-5 py-3.5 text-slate-900">
                          {session.recoverySession?.instructorName ?? ""}
                        </td>
                        <td className="px-5 py-3.5">
                          {session.recoverySession ? (
                            <InstructorTypeBadge type={session.recoverySession.instructorType} />
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
*/
export default function RecoverySubjectDetail() {
  const { toast } = useToast();
  const { user } = useAuth();
  const params = useParams();
  const [, setLocation] = useLocation();
  // Instructors get a read-only view of this page: they can browse prod
  // sequence + session tracker for their own campus/subject, but scheduling
  // and cancelling sessions stay admin/capability-manager actions, and the
  // below-80% student list stays out of scope too (its API route is still
  // blocked for instructors), so we skip fetching it and hide its tab/controls.
  const isInstructor = user?.role === "instructor";
  // The Incentive Tracker lives on its own page (it spans every subject, not
  // just this one) -- this banner is the "beside the session tracker" link
  // to it, for the same roles that can see it there.
  const canSeeIncentives =
    user?.role === "superadmin" ||
    user?.role === "admin" ||
    user?.role === "boa" ||
    user?.role === "hod";

  const rawCampus = params.campus;
  const rawSubject = params.subject;

  const campus = useMemo(() => safeDecode(rawCampus), [rawCampus]);
  const subject = useMemo(() => safeDecode(rawSubject), [rawSubject]);
  const semester = useMemo(
    () => new URLSearchParams(window.location.search).get("semester") ?? "",
    [],
  );

  const [recoveryData, setRecoveryData] = useState<RecoveryCampusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [searchFilter, setSearchFilter] = useState("");

  const [recoveryProgress, setRecoveryProgress] = useState<RecoveryProgress | null>(null);
  const [progressLoading, setProgressLoading] = useState(false);
  const [progressError, setProgressError] = useState("");

  const [trackerData, setTrackerData] = useState<SessionTrackerRow[] | null>(null);
  const [trackerLoading, setTrackerLoading] = useState(false);
  const [trackerError, setTrackerError] = useState("");
  const [updatingInstructorType, setUpdatingInstructorType] = useState<string | null>(null);
  const [cancellingSessionId, setCancellingSessionId] = useState<string | null>(null);
  const [revertingSessionId, setRevertingSessionId] = useState<string | null>(null);

  // "Mark complete" -- lets an instructor report on their own assigned
  // session right from the Session Tracker row, instead of only from the
  // separate /instructor page. Reuses the same report endpoint that page
  // uses; the only difference is where the form lives.
  const [markCompleteSessionId, setMarkCompleteSessionId] = useState<string | null>(null);
  const [markCompleteLoading, setMarkCompleteLoading] = useState(false);
  const [markCompleteError, setMarkCompleteError] = useState("");
  const [markCompleteMeta, setMarkCompleteMeta] = useState<{
    subject: string;
    campus: string;
    scheduledDate: string;
    startTime: string;
    endTime: string;
    studentsExpected: number | null;
  } | null>(null);
  const [markCompleteTopics, setMarkCompleteTopics] = useState<MarkCompleteTopic[]>([]);
  const [markCoveredTopicIds, setMarkCoveredTopicIds] = useState<Set<string>>(new Set());
  const [markStudentsAttended, setMarkStudentsAttended] = useState("");
  const [markStatus, setMarkStatus] = useState<SessionOutcomeStatus | "">("");
  const [markRemarks, setMarkRemarks] = useState("");
  const [markQaReportUrl, setMarkQaReportUrl] = useState("");
  const [markSubmitting, setMarkSubmitting] = useState(false);

  const [prodSequence, setProdSequence] = useState<SubjectProdSequenceItem[] | null>(null);
  const [prodSequenceLoading, setProdSequenceLoading] = useState(false);
  const [prodSequenceError, setProdSequenceError] = useState("");

  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleStartTime, setScheduleStartTime] = useState("");
  const [scheduleEndTime, setScheduleEndTime] = useState("");
  const [scheduleInstructorUserId, setScheduleInstructorUserId] = useState("");
  const [scheduleStudentsExpected, setScheduleStudentsExpected] = useState("");
  const [scheduleTopics, setScheduleTopics] = useState<Set<string>>(new Set());
  const [scheduleSubmitting, setScheduleSubmitting] = useState(false);

  const [useBackupInstructor, setUseBackupInstructor] = useState(false);
  const [instructorRoster, setInstructorRoster] = useState<CampusInstructor[] | null>(null);
  const [instructorRosterLoading, setInstructorRosterLoading] = useState(false);
  const [instructorRosterError, setInstructorRosterError] = useState("");

  useEffect(() => {
    if (!campus) return;
    const controller = new AbortController();
    let active = true;

    async function fetchInstructors() {
      setInstructorRosterLoading(true);
      setInstructorRosterError("");
      try {
        const params = useBackupInstructor
          ? new URLSearchParams({ all: "true" })
          : new URLSearchParams({ campus: campus! });
        const response = await fetch(
          `/api/dashboard/recovery-instructors?${params}`,
          { signal: controller.signal },
        );
        if (!response.ok) throw new Error("Failed to load instructor list");
        const data = (await response.json()) as CampusInstructor[];
        if (active) setInstructorRoster(data);
      } catch (err) {
        if (!active || (err instanceof DOMException && err.name === "AbortError")) return;
        setInstructorRosterError(
          err instanceof Error ? err.message : "Failed to load instructor list",
        );
      } finally {
        if (active) setInstructorRosterLoading(false);
      }
    }

    fetchInstructors();
    return () => {
      active = false;
      controller.abort();
    };
  }, [campus, useBackupInstructor]);

  const instructorOptions = useMemo(
    () =>
      (instructorRoster ?? []).map((i) => {
        const idSuffix = i.employeeId ? ` — ${i.employeeId}` : "";
        // In backup mode the list spans every campus, so show where each
        // instructor is normally based; in normal mode it's redundant since
        // every option is already this campus's own roster.
        const campusSuffix = useBackupInstructor && i.institute ? ` (${i.institute})` : "";
        return {
          value: i.instructorUserId,
          label: `${i.name}${idSuffix}${campusSuffix}`,
        };
      }),
    [instructorRoster, useBackupInstructor],
  );

  function toggleBackupInstructor(checked: boolean) {
    setUseBackupInstructor(checked);
    // The previously selected instructor may not exist in the new list.
    setScheduleInstructorUserId("");
  }

  useEffect(() => {
    if (!campus) return;

    const controller = new AbortController();
    let active = true;

    async function fetchRecovery() {
      if (!active) return;
      setLoading(true);
      setError("");
      try {
        const subjectParams = new URLSearchParams({ campus: campus! });
        if (semester) subjectParams.set("semester", semester);
        const requests: Promise<Response>[] = [
          fetch(`/api/attendance/recovery/subjects?${subjectParams}`, {
            signal: controller.signal,
          }),
        ];
        // Instructors don't have access to the below-80% student list API,
        // and that tab is hidden for them anyway -- skip fetching it so a
        // blocked 403 there doesn't fail the whole subject-page load.
        if (semester && subject && !isInstructor) {
          requests.push(
            fetch(
              `/api/attendance/recovery/students?${new URLSearchParams({
                campus: campus!,
                semester,
                subject,
              })}`,
              { signal: controller.signal },
            ),
          );
        }
        const [response, studentsResponse] = await Promise.all(requests);
        if (!response.ok || (studentsResponse && !studentsResponse.ok)) {
          throw new Error("Failed to fetch recovery data");
        }
        const data = (await response.json()) as RecoveryCampusData;
        if (studentsResponse && subject) {
          const students = (await studentsResponse.json()) as RecoveryStudent[];
          data.subjects = data.subjects.map((item) =>
            item.subjectTitle === subject ? { ...item, students } : item,
          );
        }
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
  }, [campus, semester, subject, toast]);

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
        if (semester) queryParams.set("semester", semester);
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

  useEffect(() => {
    if (!campus || !subject) return;
    const controller = new AbortController();
    let active = true;

    async function fetchProdSequence() {
      setProdSequenceLoading(true);
      setProdSequenceError("");
      try {
        const queryParams = new URLSearchParams({
          campus: campus!,
          subject: subject!,
        });
        if (semester) queryParams.set("semester", semester);
        const response = await fetch(`/api/dashboard/prod-sequence?${queryParams}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Failed to load prod sequence");
        const data = (await response.json()) as SubjectProdSequenceItem[];
        if (active) setProdSequence(data);
      } catch (err) {
        if (!active || (err instanceof DOMException && err.name === "AbortError")) return;
        setProdSequenceError(
          err instanceof Error ? err.message : "Failed to load prod sequence",
        );
      } finally {
        if (active) setProdSequenceLoading(false);
      }
    }

    fetchProdSequence();
    return () => {
      active = false;
      controller.abort();
    };
  }, [campus, semester, subject]);

  useEffect(() => {
    if (!campus || !subject) return;

    const controller = new AbortController();
    let active = true;

    async function fetchTracker() {
      if (!active) return;
      setTrackerLoading(true);
      setTrackerError("");
      try {
        const queryParams = new URLSearchParams({
          campus: campus!,
          subject: subject!,
        });
        if (semester) queryParams.set("semester", semester);
        const response = await fetch(`/api/dashboard/session-tracker?${queryParams}`, {
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error("Failed to load session tracker");
        }
        const data = (await response.json()) as SessionTrackerRow[];
        if (active && !controller.signal.aborted) setTrackerData(data);
      } catch (err) {
        if (!active || (err instanceof DOMException && err.name === "AbortError")) return;
        setTrackerError(
          err instanceof Error ? err.message : "Failed to load session tracker",
        );
      } finally {
        if (active && !controller.signal.aborted) setTrackerLoading(false);
      }
    }

    fetchTracker();
    return () => {
      active = false;
      controller.abort();
    };
  }, [campus, semester, subject]);

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

  const needsRecoveryTopics = useMemo(
    () => (trackerData ?? []).filter((row) => row.status === "needs_recovery"),
    [trackerData],
  );

  function resetScheduleForm() {
    setScheduleDate("");
    setScheduleStartTime("");
    setScheduleEndTime("");
    setScheduleInstructorUserId("");
    setScheduleStudentsExpected("");
    setScheduleTopics(new Set());
    setUseBackupInstructor(false);
  }

  function openScheduleDialog() {
    resetScheduleForm();
    setScheduleOpen(true);
  }

  function toggleScheduleTopic(title: string) {
    setScheduleTopics((current) => {
      const next = new Set(current);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });
  }

  async function submitSchedule() {
    if (!campus || !subject) return;
    if (!scheduleDate) {
      toast({ variant: "destructive", title: "Pick a date for the session" });
      return;
    }
    const selectedInstructor = (instructorRoster ?? []).find(
      (i) => i.instructorUserId === scheduleInstructorUserId,
    );
    if (!selectedInstructor) {
      toast({ variant: "destructive", title: "Select an instructor" });
      return;
    }
    if (scheduleTopics.size === 0) {
      toast({ variant: "destructive", title: "Select at least one topic to cover" });
      return;
    }
    setScheduleSubmitting(true);
    try {
      const response = await fetch("/api/dashboard/recovery-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campus,
          subject,
          scheduledDate: scheduleDate,
          startTime: scheduleStartTime || undefined,
          endTime: scheduleEndTime || undefined,
          instructorName: selectedInstructor.name,
          instructorUserId: selectedInstructor.instructorUserId,
          employeeId: selectedInstructor.employeeId || undefined,
          isBackupInstructor: useBackupInstructor,
          studentsExpected: scheduleStudentsExpected
            ? Number(scheduleStudentsExpected)
            : undefined,
          topicTitles: [...scheduleTopics],
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result?.error ?? "Failed to schedule session");
      }
      toast({
        title: "Recovery session scheduled",
        description: `${formatRecoveryDate(scheduleDate)} · ${scheduleTopics.size} topic${scheduleTopics.size === 1 ? "" : "s"}`,
      });
      setScheduleOpen(false);
      resetScheduleForm();

      const queryParams = new URLSearchParams({ campus, subject });
      if (semester) queryParams.set("semester", semester);
      const [trackerResponse, progressResponse] = await Promise.all([
        fetch(`/api/dashboard/session-tracker?${queryParams}`),
        fetch(`/api/dashboard/recovery-progress?${queryParams}`),
      ]);
      if (trackerResponse.ok) {
        setTrackerData((await trackerResponse.json()) as SessionTrackerRow[]);
      }
      if (progressResponse.ok) {
        setRecoveryProgress((await progressResponse.json()) as RecoveryProgress);
      }
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Could not schedule session",
        description: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setScheduleSubmitting(false);
    }
  }

  const canEditInstructorType =
    user?.role === "admin" || user?.role === "superadmin";

  async function updateInstructorType(
    sessionId: string,
    instructorType: "campus" | "backup" | "unknown",
  ) {
    setUpdatingInstructorType(sessionId);
    try {
      const response = await fetch(
        `/api/admin/recovery-sessions/${encodeURIComponent(sessionId)}/instructor-type`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ instructorType }),
        },
      );
      if (!response.ok) {
        throw new Error("Failed to update instructor type");
      }
      setTrackerData((current) =>
        current?.map((row) =>
          row.recoverySession?.id === sessionId
            ? {
                ...row,
                recoverySession: {
                  ...row.recoverySession,
                  instructorType,
                },
              }
            : row,
        ) ?? null,
      );
      toast({
        title: "Instructor type updated",
        description: "The stored classification is now used by the tracker.",
      });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Update failed",
        description:
          err instanceof Error ? err.message : "Failed to update instructor type",
      });
    } finally {
      setUpdatingInstructorType(null);
    }
  }

  async function cancelSession(sessionId: string) {
    if (
      !confirm(
        "Delete this recovery session? Its topic(s) will return to the queue so you can reschedule them.",
      )
    ) {
      return;
    }
    setCancellingSessionId(sessionId);
    try {
      const response = await fetch(
        `/api/dashboard/recovery-sessions/${encodeURIComponent(sessionId)}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        throw new Error(result?.error ?? "Failed to delete session");
      }
      toast({
        title: "Session deleted",
        description: "Its topics are back in the queue to reschedule.",
      });
      if (campus && subject) {
        const queryParams = new URLSearchParams({ campus, subject });
        if (semester) queryParams.set("semester", semester);
        const [trackerResponse, progressResponse] = await Promise.all([
          fetch(`/api/dashboard/session-tracker?${queryParams}`),
          fetch(`/api/dashboard/recovery-progress?${queryParams}`),
        ]);
        if (trackerResponse.ok) {
          setTrackerData((await trackerResponse.json()) as SessionTrackerRow[]);
        }
        if (progressResponse.ok) {
          setRecoveryProgress((await progressResponse.json()) as RecoveryProgress);
        }
      }
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Could not delete session",
        description: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setCancellingSessionId(null);
    }
  }

  // Admin-only: undoes a session that was wrongly marked Completed/Partially
  // Completed (e.g. a test entry, or an instructor mistake) -- puts its
  // topic(s) back to "needs recovery" rather than deleting the session
  // outright. Clears the stored remarks/QA report link, since they no longer
  // describe anything that actually happened.
  async function revertToNeedsRecovery(sessionId: string) {
    if (
      !confirm(
        'Revert this session to "needs recovery"? Its remarks and QA report link will be cleared, and the topic will show as not yet recovered.',
      )
    ) {
      return;
    }
    setRevertingSessionId(sessionId);
    try {
      const response = await fetch(
        `/api/admin/recovery-sessions/${encodeURIComponent(sessionId)}/revert`,
        { method: "POST", credentials: "include" },
      );
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error ?? "Failed to revert session");
      toast({
        title: "Session reverted",
        description: "The topic now shows as needing recovery.",
      });
      await refetchTrackerAndProgress();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Could not revert session",
        description: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setRevertingSessionId(null);
    }
  }

  async function refetchTrackerAndProgress() {
    if (!campus || !subject) return;
    const queryParams = new URLSearchParams({ campus, subject });
    if (semester) queryParams.set("semester", semester);
    const [trackerResponse, progressResponse] = await Promise.all([
      fetch(`/api/dashboard/session-tracker?${queryParams}`),
      fetch(`/api/dashboard/recovery-progress?${queryParams}`),
    ]);
    if (trackerResponse.ok) {
      setTrackerData((await trackerResponse.json()) as SessionTrackerRow[]);
    }
    if (progressResponse.ok) {
      setRecoveryProgress((await progressResponse.json()) as RecoveryProgress);
    }
  }

  function closeMarkComplete() {
    setMarkCompleteSessionId(null);
    setMarkCompleteMeta(null);
    setMarkCompleteTopics([]);
    setMarkCoveredTopicIds(new Set());
    setMarkStudentsAttended("");
    setMarkStatus("");
    setMarkRemarks("");
    setMarkQaReportUrl("");
    setMarkCompleteError("");
  }

  async function openMarkComplete(sessionId: string) {
    setMarkCompleteSessionId(sessionId);
    setMarkCompleteLoading(true);
    setMarkCompleteError("");
    try {
      const response = await fetch(
        `/api/recovery/instructor/sessions/${encodeURIComponent(sessionId)}`,
        { credentials: "include" },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error ?? "Could not load this session");
      setMarkCompleteMeta({
        subject: result.subject,
        campus: result.campus,
        scheduledDate: result.scheduledDate,
        startTime: result.startTime,
        endTime: result.endTime,
        studentsExpected: result.studentsExpected,
      });
      setMarkCompleteTopics(result.topics ?? []);
    } catch (err) {
      setMarkCompleteError(err instanceof Error ? err.message : "Could not load this session");
    } finally {
      setMarkCompleteLoading(false);
    }
  }

  function toggleMarkTopic(topicId: string, checked: boolean) {
    setMarkCoveredTopicIds((current) => {
      const next = new Set(current);
      if (checked) next.add(topicId);
      else next.delete(topicId);
      return next;
    });
  }

  async function submitMarkComplete() {
    if (!markCompleteSessionId) return;
    if (!markStatus) {
      toast({ variant: "destructive", title: "Select a session status before submitting" });
      return;
    }
    const rawAttendance = markStudentsAttended.trim();
    const studentsAttended = rawAttendance === "" ? undefined : Number(rawAttendance);
    if (studentsAttended != null && (!Number.isInteger(studentsAttended) || studentsAttended < 0)) {
      toast({ variant: "destructive", title: "Enter a valid attendance count" });
      return;
    }
    const remarks = markRemarks.trim();
    const qaReportUrl = markQaReportUrl.trim();
    if ((markStatus === "conducted" || markStatus === "partial") && !qaReportUrl) {
      toast({ variant: "destructive", title: "Upload the QA report link before submitting" });
      return;
    }
    setMarkSubmitting(true);
    try {
      const response = await fetch(
        `/api/recovery/sessions/${encodeURIComponent(markCompleteSessionId)}/report`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            coveredTopicIds: [...markCoveredTopicIds],
            status: markStatus,
            ...(studentsAttended == null ? {} : { studentsAttended }),
            ...(remarks ? { remarks } : {}),
            ...(qaReportUrl ? { qaReportUrl } : {}),
          }),
        },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error ?? "Could not submit report");
      toast({ title: "Report submitted", description: "The session tracker has been updated." });
      closeMarkComplete();
      await refetchTrackerAndProgress();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Report not submitted",
        description: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setMarkSubmitting(false);
    }
  }

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
          subtitle={`Campus: ${campus}${semester ? ` · ${semester}` : ""}`}
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
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:gap-6 divide-y lg:divide-y-0 lg:divide-x divide-slate-100">
            <div className="pt-4 lg:pt-0 min-w-0 flex flex-col justify-center">
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

      {canSeeIncentives && (
        <button
          type="button"
          onClick={() => setLocation("/dashboard/recovery/incentives")}
          className="flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-3 text-left transition-colors hover:bg-emerald-50"
        >
          <span className="flex items-center gap-2 text-sm font-medium text-emerald-800">
            <Wallet className="h-4 w-4" />
            Incentive Tracker — see what every recovery instructor is owed for sessions marked Completed or Partially Completed below
          </span>
          <span className="text-xs font-semibold uppercase tracking-wider text-emerald-700">Open →</span>
        </button>
      )}

      <Tabs defaultValue="prod-sequence" className="mt-2">
        <TabsList className="mb-4">
          <TabsTrigger value="prod-sequence">Prod Sequence</TabsTrigger>
          {!isInstructor && (
            <TabsTrigger value="students">Student List</TabsTrigger>
          )}
          <TabsTrigger value="sessions">Session Tracker</TabsTrigger>
        </TabsList>

        <TabsContent value="prod-sequence" className="space-y-4">
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            {prodSequenceLoading ? (
              <div className="flex min-h-[300px] flex-col items-center justify-center p-12 text-center">
                <Loader2 className="mb-4 h-8 w-8 animate-spin text-brand-600" />
                <p className="text-sm text-slate-500">Loading curriculum sequence...</p>
              </div>
            ) : prodSequenceError ? (
              <div className="flex min-h-[300px] flex-col items-center justify-center p-12 text-center">
                <Clock3 className="mb-4 h-7 w-7 text-rose-600" />
                <p className="mb-1 text-sm font-medium text-slate-900">Failed to load curriculum</p>
                <p className="text-sm text-slate-500">{prodSequenceError}</p>
              </div>
            ) : prodSequence?.length === 0 ? (
              <div className="flex min-h-[300px] items-center justify-center bg-slate-50/50 p-12 text-center text-slate-500">
                No prod sequence is available for this subject and semester.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">
                    Ordered production curriculum for {selectedSubjectData.subjectTitle}.
                  </caption>
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50">
                      <th className="w-20 px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-600">Order</th>
                      <th className="w-20 px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-600">Week</th>
                      <th className="min-w-[300px] px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-600">Topic</th>
                      <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-600">Type</th>
                      <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-600">Progress</th>
                      <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-600">Completed</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {prodSequence?.map((item) => (
                      <tr key={item.sessionId} className="transition-colors hover:bg-brand-50/30">
                        <td className="px-5 py-4 font-medium tabular-nums text-slate-600">{item.order}</td>
                        <td className="px-5 py-4 tabular-nums text-slate-600">{item.week ?? "-"}</td>
                        <td className="px-5 py-4 font-medium text-slate-900">{item.topicTitle}</td>
                        <td className="px-5 py-4 text-slate-600">{item.sessionType || "-"}</td>
                        <td className="px-5 py-4">
                          <span className={`inline-flex rounded-md border px-2.5 py-1 text-xs font-semibold ${
                            item.completed
                              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                              : "border-slate-200 bg-slate-50 text-slate-600"
                          }`}>
                            {item.completed ? "Completed" : "Pending"}
                          </span>
                          {item.totalSections > 0 && (
                            <span className="ml-2 text-xs text-slate-500">
                              {item.completedSections}/{item.totalSections} sections
                            </span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-5 py-4 text-slate-700">
                          {item.completedAt ? formatRecoveryDate(item.completedAt) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </TabsContent>

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

        <TabsContent value="sessions" className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-slate-500">
              {needsRecoveryTopics.length > 0
                ? `${needsRecoveryTopics.length} topic${needsRecoveryTopics.length === 1 ? "" : "s"} still need${needsRecoveryTopics.length === 1 ? "s" : ""} a recovery session.`
                : "No topics currently need a recovery session."}
            </p>
            {!isInstructor && (
              <Button
                size="sm"
                className="gap-2"
                onClick={openScheduleDialog}
                disabled={needsRecoveryTopics.length === 0}
              >
                <CalendarPlus className="h-4 w-4" />
                Schedule recovery session
              </Button>
            )}
          </div>
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
            {trackerLoading ? (
              <div className="p-12 text-center flex flex-col items-center justify-center min-h-[300px]">
                <Loader2 className="h-8 w-8 animate-spin text-brand-600 mb-4" />
                <p className="text-sm text-slate-500">Loading session tracker...</p>
              </div>
            ) : trackerError ? (
              <div className="p-12 text-center flex flex-col items-center justify-center min-h-[300px]">
                <div className="rounded-full bg-rose-50 p-3 mb-4">
                  <Clock3 className="h-6 w-6 text-rose-600" />
                </div>
                <p className="text-sm font-medium text-slate-900 mb-1">Failed to load sessions</p>
                <p className="text-sm text-slate-500 mb-4">{trackerError}</p>
                <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
                  Retry
                </Button>
              </div>
            ) : trackerData?.length === 0 ? (
              <div className="p-12 text-center text-slate-500 bg-slate-50/50 min-h-[300px] flex items-center justify-center">
                No session data available for this subject.
              </div>
            ) : (
              <div className="overflow-x-auto scrollbar-thin">
                <table className="w-full text-sm">
                  <caption className="sr-only">
                    Session tracking for {selectedSubjectData.subjectTitle}.
                  </caption>
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50">
                      <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-600 w-16">Seq</th>
                      <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-600 w-16">Week</th>
                      <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-600 min-w-[250px]">Topic</th>
                      <th className="px-5 py-3 text-center text-xs font-semibold uppercase tracking-wider text-slate-600">Attendance</th>
                      <th className="px-5 py-3 text-center text-xs font-semibold uppercase tracking-wider text-slate-600">Status</th>
                      <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-600">Recovery Date</th>
                      <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-600">Recovery Instructor</th>
                      <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-600">Instructor Type</th>
                      <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-600 min-w-[180px]">Remarks</th>
                      <th className="px-5 py-3 text-center text-xs font-semibold uppercase tracking-wider text-slate-600 w-28">QA Report</th>
                      <th className="px-5 py-3 text-center text-xs font-semibold uppercase tracking-wider text-slate-600 w-16">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {trackerData?.map((row) => {
                      const statusDisplay = getStatusDisplay(row.status);
                      return (
                        <tr key={`${row.sequenceNo}-${row.topicTitle}`} className="hover:bg-brand-50/30 transition-colors">
                          <td className="px-5 py-4 text-slate-600 tabular-nums font-medium">{row.sequenceNo}</td>
                          <td className="px-5 py-4 text-slate-600 tabular-nums">{row.weekNo || "-"}</td>
                          <td className="px-5 py-4 font-medium text-slate-900">
                            {row.topicTitle}
                          </td>
                          <td className="px-5 py-4 text-center align-middle">
                            {row.attendancePct === null ? (
                              <span className="text-slate-400 text-[11px] font-bold uppercase tracking-wider">Not Taught</span>
                            ) : (
                              <div className="flex flex-col items-center justify-center">
                                <span className={`inline-flex items-center px-2.5 py-0.5 rounded text-xs font-semibold ${pctTextColor(row.attendancePct)} bg-white border border-slate-200 shadow-xs`}>
                                  {row.attendancePct.toFixed(1)}%
                                </span>
                                <span className="text-xs text-slate-500 mt-1 tabular-nums font-medium">
                                  {row.presentCount}/{row.totalCount}
                                </span>
                              </div>
                            )}
                          </td>
                          <td className="px-5 py-4 text-center align-middle">
                            <span className={`inline-flex items-center px-2 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider border ${statusDisplay.className}`}>
                              {statusDisplay.label}
                            </span>
                          </td>
                          <td className="px-5 py-4 whitespace-nowrap">
                            {row.recoverySession ? (
                              <span className="text-slate-700 font-medium">{formatRecoveryDate(row.recoverySession.date)}</span>
                            ) : (
                              <span className="sr-only">No recovery session</span>
                            )}
                          </td>
                          <td className="px-5 py-4">
                            {row.recoverySession ? (
                              <span className="text-slate-900 font-medium">{row.recoverySession.instructorName}</span>
                            ) : (
                              <span className="sr-only">No recovery instructor</span>
                            )}
                          </td>
                          <td className="px-5 py-4">
                            {row.recoverySession ? (
                              canEditInstructorType ? (
                                <select
                                  aria-label={`Instructor type for ${row.recoverySession.instructorName}`}
                                  value={row.recoverySession.instructorType}
                                  disabled={updatingInstructorType === row.recoverySession.id}
                                  onChange={(event) =>
                                    updateInstructorType(
                                      row.recoverySession!.id,
                                      event.target.value as "campus" | "backup" | "unknown",
                                    )
                                  }
                                  className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold capitalize text-slate-700 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:cursor-wait disabled:opacity-60"
                                >
                                  <option value="campus">Campus</option>
                                  <option value="backup">Backup</option>
                                  <option value="unknown">Unknown</option>
                                </select>
                              ) : (
                                <span
                                  className={`inline-flex rounded-md border px-2 py-1 text-[11px] font-bold uppercase tracking-wider ${
                                    row.recoverySession.instructorType === "campus"
                                      ? "border-sky-200 bg-sky-50 text-sky-700"
                                      : row.recoverySession.instructorType === "backup"
                                        ? "border-violet-200 bg-violet-50 text-violet-700"
                                        : "border-slate-200 bg-slate-50 text-slate-600"
                                  }`}
                                >
                                  {row.recoverySession.instructorType}
                                </span>
                              )
                            ) : (
                              <span className="sr-only">No instructor type</span>
                            )}
                          </td>
                          <td className="px-5 py-4 max-w-[220px]">
                            {row.recoverySession?.remarks ? (
                              <span
                                className="block truncate text-slate-600"
                                title={row.recoverySession.remarks}
                              >
                                {row.recoverySession.remarks}
                              </span>
                            ) : (
                              <span className="text-slate-300">-</span>
                            )}
                          </td>
                          <td className="px-5 py-4 text-center align-middle">
                            {row.recoverySession?.qaReportUrls?.length ? (
                              <div className="flex flex-col items-center gap-1">
                                {row.recoverySession.qaReportUrls.map((url, i) => (
                                  <a
                                    key={url}
                                    href={url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-700 hover:underline"
                                  >
                                    <ExternalLink className="h-3 w-3" />
                                    {row.recoverySession!.qaReportUrls.length > 1 ? `Report ${i + 1}` : "Report"}
                                  </a>
                                ))}
                              </div>
                            ) : (
                              <span className="text-slate-300">-</span>
                            )}
                          </td>
                          <td className="px-5 py-4 text-center align-middle">
                            {isInstructor ? (
                              // Access to this page is already scoped by campus/subject on
                              // the server (a shared campus login such as
                              // cdu.instructor@nxtwave.co.in covers every subject at that
                              // campus), so any instructor who can see this row is allowed
                              // to mark it complete -- not just one whose name happens to
                              // match the session's stored instructorId.
                              row.status === "recovery_scheduled" &&
                              row.recoverySession ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-8 gap-1.5 px-2.5 text-xs"
                                  onClick={() => void openMarkComplete(row.recoverySession!.id)}
                                >
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                  Mark complete
                                </Button>
                              ) : (
                                <span className="sr-only">No action</span>
                              )
                            ) : canEditInstructorType && row.status === "recovered" && row.recoverySession ? (
                              <button
                                type="button"
                                title="Revert to needs recovery"
                                aria-label={`Revert recovery session for ${row.topicTitle} to needs recovery`}
                                disabled={revertingSessionId === row.recoverySession.id}
                                onClick={() => void revertToNeedsRecovery(row.recoverySession!.id)}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-amber-50 hover:text-amber-600 disabled:cursor-wait disabled:opacity-60"
                              >
                                {revertingSessionId === row.recoverySession.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <RotateCcw className="h-4 w-4" />
                                )}
                              </button>
                            ) : row.status === "recovery_scheduled" && row.recoverySession ? (
                              <button
                                type="button"
                                title="Delete this session and reschedule"
                                aria-label={`Delete recovery session for ${row.topicTitle}`}
                                disabled={cancellingSessionId === row.recoverySession.id}
                                onClick={() => cancelSession(row.recoverySession!.id)}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:cursor-wait disabled:opacity-60"
                              >
                                {cancellingSessionId === row.recoverySession.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Trash2 className="h-4 w-4" />
                                )}
                              </button>
                            ) : (
                              <span className="sr-only">No action</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      <Dialog
        open={scheduleOpen}
        onOpenChange={(open) => {
          if (scheduleSubmitting) return;
          setScheduleOpen(open);
          if (!open) resetScheduleForm();
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Schedule recovery session</DialogTitle>
            <DialogDescription>
              {selectedSubjectData.subjectTitle} · {campus}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="schedule-date">Date</Label>
                <Input
                  id="schedule-date"
                  type="date"
                  value={scheduleDate}
                  onChange={(e) => setScheduleDate(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="schedule-instructor">Instructor</Label>
                  <label className="flex items-center gap-1.5 text-xs text-slate-500 cursor-pointer select-none">
                    <Checkbox
                      checked={useBackupInstructor}
                      onCheckedChange={(checked) => toggleBackupInstructor(checked === true)}
                    />
                    Backup instructor
                  </label>
                </div>
                <SearchableSelect
                  value={scheduleInstructorUserId}
                  onValueChange={setScheduleInstructorUserId}
                  options={instructorOptions}
                  placeholder={
                    instructorRosterLoading
                      ? "Loading instructors…"
                      : instructorRosterError
                        ? "Couldn't load instructors"
                        : useBackupInstructor
                          ? "Select instructor from any campus…"
                          : "Select instructor…"
                  }
                  searchPlaceholder="Search by name or employee ID…"
                  emptyText={
                    useBackupInstructor
                      ? "No active instructors found."
                      : "No active instructors found for this campus."
                  }
                  disabled={instructorRosterLoading || !!instructorRosterError}
                  className="w-full"
                />
                {useBackupInstructor && (
                  <p className="text-xs text-slate-500">
                    Showing active instructors from all campuses.
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="schedule-start">Start time</Label>
                <Input
                  id="schedule-start"
                  type="time"
                  value={scheduleStartTime}
                  onChange={(e) => setScheduleStartTime(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="schedule-end">End time</Label>
                <Input
                  id="schedule-end"
                  type="time"
                  value={scheduleEndTime}
                  onChange={(e) => setScheduleEndTime(e.target.value)}
                />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="schedule-students">Students expected (optional)</Label>
                <Input
                  id="schedule-students"
                  type="number"
                  min="0"
                  placeholder="e.g. 25"
                  value={scheduleStudentsExpected}
                  onChange={(e) => setScheduleStudentsExpected(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Topics to cover ({scheduleTopics.size} selected)</Label>
              <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
                {needsRecoveryTopics.length === 0 ? (
                  <p className="p-4 text-sm text-slate-500">
                    No topics currently need a recovery session.
                  </p>
                ) : (
                  needsRecoveryTopics.map((row) => (
                    <label
                      key={row.topicTitle}
                      className="flex items-start gap-2.5 px-3 py-2.5 text-sm hover:bg-slate-50 cursor-pointer"
                    >
                      <Checkbox
                        checked={scheduleTopics.has(row.topicTitle)}
                        onCheckedChange={() => toggleScheduleTopic(row.topicTitle)}
                        className="mt-0.5"
                      />
                      <span>
                        <span className="text-slate-400 tabular-nums mr-1.5">
                          #{row.sequenceNo}
                        </span>
                        <span className="text-slate-900">{row.topicTitle}</span>
                      </span>
                    </label>
                  ))
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setScheduleOpen(false);
                resetScheduleForm();
              }}
              disabled={scheduleSubmitting}
            >
              Cancel
            </Button>
            <Button onClick={submitSchedule} disabled={scheduleSubmitting} className="gap-2">
              {scheduleSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Schedule session
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={markCompleteSessionId !== null}
        onOpenChange={(open) => {
          if (!open) closeMarkComplete();
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Mark recovery session</DialogTitle>
            <DialogDescription>
              {markCompleteMeta
                ? `${markCompleteMeta.subject} · ${markCompleteMeta.campus} · ${formatRecoveryDate(markCompleteMeta.scheduledDate)}`
                : "Report what happened in this session."}
            </DialogDescription>
          </DialogHeader>

          {markCompleteLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-brand-600" />
            </div>
          ) : markCompleteError ? (
            <div className="py-6 text-center text-sm text-rose-600">{markCompleteError}</div>
          ) : (
            <div className="space-y-6 py-2">
              <div>
                <div className="mb-3 flex items-center justify-between">
                  <Label className="text-sm font-semibold">Topics covered</Label>
                  <span className="text-xs text-slate-500">
                    {markCoveredTopicIds.size} of {markCompleteTopics.length}
                  </span>
                </div>
                <div className="space-y-2">
                  {markCompleteTopics.map((topic) => (
                    <label
                      key={topic.id}
                      className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border border-slate-200 p-3 hover:border-brand-300"
                    >
                      <Checkbox
                        checked={markCoveredTopicIds.has(topic.id)}
                        onCheckedChange={(checked) => toggleMarkTopic(topic.id, checked === true)}
                        className="h-5 w-5"
                      />
                      <span className="flex-1 text-sm font-medium leading-snug text-slate-800">
                        <span className="mr-2 text-slate-400">#{topic.sequenceNo}</span>
                        {topic.title}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <Label htmlFor="mark-students-attended" className="mb-2">
                  Students attended
                </Label>
                <Input
                  id="mark-students-attended"
                  type="number"
                  min={0}
                  inputMode="numeric"
                  placeholder={
                    markCompleteMeta?.studentsExpected
                      ? `Expected ${markCompleteMeta.studentsExpected}`
                      : "Enter total"
                  }
                  value={markStudentsAttended}
                  onChange={(event) => setMarkStudentsAttended(event.target.value)}
                />
              </div>

              <div>
                <Label className="mb-2 flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4" /> Session status
                </Label>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {SESSION_STATUS_OPTIONS.map((option) => {
                    const selected = markStatus === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setMarkStatus(option.value)}
                        className={cn(
                          "min-h-11 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                          selected
                            ? "border-brand-600 bg-brand-50 text-brand-700"
                            : "border-slate-200 text-slate-600 hover:border-brand-300",
                        )}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <Label htmlFor="mark-remarks" className="mb-2">
                  Remarks
                </Label>
                <Textarea
                  id="mark-remarks"
                  placeholder="Anything worth noting about this session (optional)"
                  value={markRemarks}
                  onChange={(event) => setMarkRemarks(event.target.value)}
                  className="min-h-20"
                />
              </div>

              <div>
                <Label htmlFor="mark-qa-report" className="mb-2 flex items-center gap-2">
                  <FileText className="h-4 w-4" /> QA report link
                  {(markStatus === "conducted" || markStatus === "partial") && (
                    <span className="text-red-600">*</span>
                  )}
                </Label>
                <Input
                  id="mark-qa-report"
                  type="url"
                  placeholder="Paste a link to your QA report"
                  value={markQaReportUrl}
                  onChange={(event) => setMarkQaReportUrl(event.target.value)}
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={closeMarkComplete} disabled={markSubmitting}>
              Cancel
            </Button>
            <Button
              onClick={() => void submitMarkComplete()}
              disabled={
                markSubmitting ||
                markCompleteLoading ||
                !!markCompleteError ||
                !markStatus ||
                ((markStatus === "conducted" || markStatus === "partial") && !markQaReportUrl.trim())
              }
              className="gap-2"
            >
              {markSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Submit report
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
