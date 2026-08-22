import { useEffect, useState } from "react";
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
import {
  AlertCircle,
  Loader2,
  ChevronRight,
} from "lucide-react";
import { pctTextColor } from "@/lib/utils";
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

export default function Recovery() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [selectedCampus, setSelectedCampus] = useState("");
  const [retryCount, setRetryCount] = useState(0);
  const [recoveryData, setRecoveryData] = useState<RecoveryCampusData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const { data: filterOptions, isLoading: filtersLoading } =
    useGetDashboardFilters({});

  useEffect(() => {
    if (!selectedCampus) {
      setRecoveryData(null);
      return;
    }

    const controller = new AbortController();
    let active = true;

    async function fetchRecovery() {
      if (!active) return;
      setLoading(true);
      setError("");
      try {
        const response = await fetch(
          `/api/attendance/recovery/subjects?campus=${encodeURIComponent(selectedCampus)}`,
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
  }, [selectedCampus, retryCount, toast]);

  if (filtersLoading) {
    return <PageLoader />;
  }

  const campusOptions =
    filterOptions?.campuses.map((campus) => ({ value: campus, label: campus })) || [];

  return (
    <div className="flex flex-col gap-6 p-6 animate-in fade-in duration-300">
      <PageHeader
        title="Recovery Dashboard"
        subtitle="Campus subject recovery based on subject-level attendance below 80%"
      />

      <div className="flex items-end gap-4">
        <div className="flex-1 max-w-sm">
          <label id="campus-select-label" className="mb-2 block text-sm font-medium text-slate-700">
            Select Campus
          </label>
          <Select value={selectedCampus} onValueChange={setSelectedCampus}>
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
      </div>

      {loading && (
        <div className="flex items-center justify-center gap-2 py-12">
          <Loader2 className="h-5 w-5 animate-spin text-brand-600" />
          <span className="text-slate-600 font-medium">Loading subject recovery data...</span>
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

      {selectedCampus && !loading && recoveryData && (
        <div className="flex flex-col gap-8 animate-in slide-in-from-bottom-2 duration-500">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Subjects in Recovery</p>
              <p className="mt-2 text-3xl font-bold text-slate-900 tabular-nums">
                {recoveryData.totalSubjectsInRecovery}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Students Affected</p>
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
                Great! No subject is below 80% attendance in {recoveryData.campus}.
              </p>
            </div>
          )}

          {recoveryData.subjects.length > 0 && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-slate-900">Subjects Requiring Recovery</h3>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {recoveryData.subjects.map((subject) => (
                  <button
                    key={subject.subjectTitle}
                    type="button"
                    onClick={() => setLocation(`/dashboard/recovery/${encodeURIComponent(selectedCampus)}/${encodeURIComponent(subject.subjectTitle)}`)}
                    className="group flex flex-col rounded-xl border border-slate-200 bg-white p-5 text-left transition-all hover:border-brand-300 hover:shadow-md hover:ring-1 hover:ring-brand-500/20"
                  >
                    <div className="flex w-full items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <h4 className="text-base font-semibold text-slate-900 truncate" title={subject.subjectTitle}>
                          {subject.subjectTitle}
                        </h4>
                      </div>
                      <span className={`shrink-0 rounded bg-white shadow-sm border border-slate-100 px-2.5 py-0.5 text-xs font-bold ${pctTextColor(subject.attendancePct)}`}>
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
        </div>
      )}
    </div>
  );
}