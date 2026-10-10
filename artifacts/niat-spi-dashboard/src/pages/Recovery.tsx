import { useEffect, useRef, useState } from "react";
import { useGetDashboardFilters } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/PageHeader";
import { PageLoader } from "@/components/PageLoader";
import { ErrorState } from "@/components/PageStates";
import { SubNav, recoveryListPath, recoveryNav } from "@/components/SubNav";
import { omitExcludedInstitutes } from "@/lib/excludedInstitutes";
import { useQueryParams } from "@/hooks/useQueryParams";
import {
  AlertCircle,
  Loader2,
  ChevronRight,
} from "lucide-react";
import { tierTextColor } from "@/lib/attendanceTiers";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";

const INCENTIVE_TRACKER_ROLES = ["superadmin", "admin", "boa", "hod"];

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

interface QuizRecoverySubjectCard {
  subjectTitle: string;
  studentsNotAt100Count: number;
}

interface QuizRecoveryCampusData {
  campus: string;
  subjects: QuizRecoverySubjectCard[];
  totalSubjectsInRecovery: number;
  totalStudentsInRecovery: number;
}

export default function Recovery() {
  const { toast } = useToast();
  const { user } = useAuth();
  const showIncentives = Boolean(user && INCENTIVE_TRACKER_ROLES.includes(user.role));
  const [location, setLocation] = useLocation();
  const query = useQueryParams();
  const path = location.split("?")[0] ?? location;
  const isQuizTab = path === "/dashboard/recovery/quiz";
  const selectedCampus = query.get("campus") ?? "";
  const selectedSemester = query.get("semester") ?? "";

  const [semesters, setSemesters] = useState<string[]>([]);
  const [semestersLoading, setSemestersLoading] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [attendanceData, setAttendanceData] = useState<RecoveryCampusData | null>(null);
  const [quizData, setQuizData] = useState<QuizRecoveryCampusData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const selectedSemesterRef = useRef(selectedSemester);
  selectedSemesterRef.current = selectedSemester;
  const tabRef = useRef<"attendance" | "quiz">(isQuizTab ? "quiz" : "attendance");
  tabRef.current = isQuizTab ? "quiz" : "attendance";

  const { data: filterOptions, isLoading: filtersLoading } =
    useGetDashboardFilters({});

  function setFilters(campus: string, semester: string) {
    setLocation(
      recoveryListPath(isQuizTab ? "quiz" : "attendance", campus, semester),
    );
  }

  useEffect(() => {
    setSemesters([]);
    if (!selectedCampus) return;

    const controller = new AbortController();
    let active = true;
    const tab = tabRef.current;
    const semesterAtFetch = selectedSemesterRef.current;
    async function fetchSemesters() {
      setSemestersLoading(true);
      setError("");
      try {
        const response = await fetch(
          `/api/attendance/recovery/semesters?campus=${encodeURIComponent(selectedCampus)}`,
          { signal: controller.signal },
        );
        if (!response.ok) throw new Error("Failed to fetch semesters");
        const data = (await response.json()) as string[];
        if (!active) return;
        setSemesters(data);
        const nextSemester =
          !semesterAtFetch || !data.includes(semesterAtFetch)
            ? (data[0] ?? "")
            : semesterAtFetch;
        if (nextSemester !== semesterAtFetch) {
          setLocation(recoveryListPath(tab, selectedCampus, nextSemester));
        }
      } catch (err) {
        if (!active || (err instanceof DOMException && err.name === "AbortError")) return;
        setError(err instanceof Error ? err.message : "Failed to fetch semesters");
      } finally {
        if (active) setSemestersLoading(false);
      }
    }
    fetchSemesters();
    return () => {
      active = false;
      controller.abort();
    };
  }, [selectedCampus, retryCount, setLocation]);

  useEffect(() => {
    if (!selectedCampus || !selectedSemester) {
      setAttendanceData(null);
      setQuizData(null);
      return;
    }

    const controller = new AbortController();
    let active = true;
    const endpoint = isQuizTab
      ? `/api/attendance/recovery/quiz-subjects?campus=${encodeURIComponent(selectedCampus)}&semester=${encodeURIComponent(selectedSemester)}`
      : `/api/attendance/recovery/subjects?campus=${encodeURIComponent(selectedCampus)}&semester=${encodeURIComponent(selectedSemester)}`;

    async function fetchRecovery() {
      if (!active) return;
      setLoading(true);
      setError("");
      try {
        const response = await fetch(endpoint, { signal: controller.signal });
        if (!response.ok) {
          throw new Error("Failed to fetch recovery data");
        }
        const data = await response.json();
        if (!active || controller.signal.aborted) return;
        if (isQuizTab) {
          setQuizData(data as QuizRecoveryCampusData);
          setAttendanceData(null);
        } else {
          setAttendanceData(data as RecoveryCampusData);
          setQuizData(null);
        }
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
  }, [selectedCampus, selectedSemester, isQuizTab, retryCount, toast]);

  if (filtersLoading) {
    return <PageLoader />;
  }

  const campusOptions =
    omitExcludedInstitutes(filterOptions?.campuses ?? []).map((campus) => ({ value: campus, label: campus }));
  const recoveryData = isQuizTab ? quizData : attendanceData;

  return (
    <div className="flex flex-col">
      <SubNav items={recoveryNav(selectedCampus, selectedSemester, showIncentives)} />
      <div className="flex flex-col gap-6 p-6 animate-in fade-in duration-300">
        <PageHeader
          title="Recovery Dashboard"
          subtitle={
            isQuizTab
              ? "Students whose classroom or module quizzes are not fully completed at 100%. This tab is for follow-up only — it does not schedule lecture recovery."
              : "Campus subject recovery when course attendance is below 80%. Lecture, MCQ practice, and module quiz sessions all count."
          }
        />

        <div className="flex flex-wrap items-end gap-4">
          <div className="flex-1 max-w-sm">
            <label id="campus-select-label" className="mb-2 block text-sm font-medium text-slate-700">
              Select Campus
            </label>
            <Select
              value={selectedCampus}
              onValueChange={(campus) => setFilters(campus, "")}
            >
              <SelectTrigger aria-labelledby="campus-select-label" className="bg-white">
                <SelectValue placeholder="Choose a campus..." />
              </SelectTrigger>
              <SelectContent>
                {campusOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1 max-w-sm">
            <label id="semester-select-label" className="mb-2 block text-sm font-medium text-slate-700">
              Select Semester
            </label>
            <Select
              value={selectedSemester}
              onValueChange={(semester) => setFilters(selectedCampus, semester)}
              disabled={!selectedCampus || semestersLoading || semesters.length === 0}
            >
              <SelectTrigger aria-labelledby="semester-select-label" className="bg-white">
                <SelectValue placeholder={semestersLoading ? "Loading semesters..." : "Choose a semester..."} />
              </SelectTrigger>
              <SelectContent>
                {semesters.map((semester) => (
                  <SelectItem key={semester} value={semester}>
                    {semester}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {loading && (
          <div className="flex items-center justify-center gap-2 py-12">
            <Loader2 className="h-5 w-5 animate-spin text-brand-600" />
            <span className="text-slate-600 font-medium">
              {isQuizTab ? "Loading quiz recovery data..." : "Loading subject recovery data..."}
            </span>
          </div>
        )}

        {error && !loading && (
          <ErrorState message={error} onRetry={() => setRetryCount((c) => c + 1)} />
        )}

        {!selectedCampus && !loading && (
          <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-12 text-center">
            <AlertCircle className="mx-auto mb-4 h-12 w-12 text-slate-400" />
            <p className="text-slate-600 font-medium">Select a campus to view recovery subjects</p>
          </div>
        )}

        {selectedCampus && !semestersLoading && semesters.length === 0 && !error && (
          <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-12 text-center">
            <AlertCircle className="mx-auto mb-4 h-12 w-12 text-slate-400" />
            <p className="text-slate-600 font-medium">No semesters are available for this campus</p>
          </div>
        )}

        {selectedCampus && selectedSemester && !loading && recoveryData && (
          <div className="flex flex-col gap-8 animate-in slide-in-from-bottom-2 duration-500">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  {isQuizTab ? "Subjects with quiz gaps" : "Subjects in Recovery"}
                </p>
                <p className="mt-2 text-3xl font-bold text-slate-900 tabular-nums">
                  {recoveryData.totalSubjectsInRecovery}
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  {isQuizTab ? "Students not at 100%" : "Students Affected"}
                </p>
                <p className="mt-2 text-3xl font-bold text-slate-900 tabular-nums">
                  {recoveryData.totalStudentsInRecovery}
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Campus</p>
                <p className="mt-2 text-xl font-bold text-slate-900">
                  {recoveryData.campus}
                </p>
              </div>
            </div>

            {recoveryData.subjects.length === 0 && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-12 text-center">
                <p className="text-emerald-700 font-medium text-lg">
                  {isQuizTab
                    ? `Great! No students are below 100% on classroom or module quizzes in ${recoveryData.campus}.`
                    : `Great! No subject is below 80% attendance in ${recoveryData.campus}.`}
                </p>
              </div>
            )}

            {recoveryData.subjects.length > 0 && !isQuizTab && attendanceData && (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-slate-900">Subjects Requiring Recovery</h3>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {attendanceData.subjects.map((subject) => (
                    <button
                      key={subject.subjectTitle}
                      type="button"
                      onClick={() =>
                        setLocation(
                          `/dashboard/recovery/${encodeURIComponent(selectedCampus)}/${encodeURIComponent(subject.subjectTitle)}?semester=${encodeURIComponent(selectedSemester)}`,
                        )
                      }
                      className="group flex flex-col rounded-xl border border-slate-200 bg-white p-5 text-left transition-all hover:border-brand-300 hover:shadow-md hover:ring-1 hover:ring-brand-500/20"
                    >
                      <div className="flex w-full items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <h4 className="text-base font-semibold text-slate-900 truncate" title={subject.subjectTitle}>
                            {subject.subjectTitle}
                          </h4>
                        </div>
                        <span className={`shrink-0 rounded bg-white shadow-sm border border-slate-100 px-2.5 py-0.5 text-xs font-bold`} style={{ color: tierTextColor(subject.attendancePct) }}>
                          {subject.attendancePct.toFixed(1)}%
                        </span>
                      </div>

                      <div className="mt-6 flex w-full items-center justify-between">
                        <div className="flex flex-col">
                          <span className="text-xs font-medium uppercase tracking-wider text-slate-500">Below 80%</span>
                          <span className="text-lg font-bold text-red-600 mt-0.5 tabular-nums">
                            {subject.studentsBelow80Count} <span className="text-sm font-medium text-slate-500">students</span>
                          </span>
                        </div>
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-50 text-slate-400 group-hover:bg-brand-50 group-hover:text-brand-600 transition-colors">
                          <ChevronRight className="h-4 w-4" />
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {recoveryData.subjects.length > 0 && isQuizTab && quizData && (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-slate-900">Subjects with quizzes below 100%</h3>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {quizData.subjects.map((subject) => (
                    <button
                      key={subject.subjectTitle}
                      type="button"
                      onClick={() =>
                        setLocation(
                          `/dashboard/recovery/quiz/${encodeURIComponent(selectedCampus)}/${encodeURIComponent(subject.subjectTitle)}?semester=${encodeURIComponent(selectedSemester)}`,
                        )
                      }
                      className="group flex flex-col rounded-xl border border-slate-200 bg-white p-5 text-left transition-all hover:border-brand-300 hover:shadow-md hover:ring-1 hover:ring-brand-500/20"
                    >
                      <div className="flex w-full items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <h4 className="text-base font-semibold text-slate-900 truncate" title={subject.subjectTitle}>
                            {subject.subjectTitle}
                          </h4>
                        </div>
                        <span className="shrink-0 rounded bg-white shadow-sm border border-slate-100 px-2.5 py-0.5 text-xs font-bold text-slate-600">
                          Quiz follow-up
                        </span>
                      </div>

                      <div className="mt-6 flex w-full items-center justify-between">
                        <div className="flex flex-col">
                          <span className="text-xs font-medium uppercase tracking-wider text-slate-500">Not at 100%</span>
                          <span className="text-lg font-bold text-amber-600 mt-0.5 tabular-nums">
                            {subject.studentsNotAt100Count}{" "}
                            <span className="text-sm font-medium text-slate-500">students</span>
                          </span>
                        </div>
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-50 text-slate-400 group-hover:bg-brand-50 group-hover:text-brand-600 transition-colors">
                          <ChevronRight className="h-4 w-4" />
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
