import { useEffect, useMemo, useState } from "react";
import { useGetDashboardFilters } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
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
import { AlertCircle, Download, Loader2 } from "lucide-react";
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

export default function Recovery() {
  const { toast } = useToast();
  const [selectedCampus, setSelectedCampus] = useState("");
  const [selectedSubject, setSelectedSubject] = useState<string | null>(null);
  const [recoveryData, setRecoveryData] = useState<RecoveryCampusData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [searchFilter, setSearchFilter] = useState("");

  const { data: filterOptions, isLoading: filtersLoading } =
    useGetDashboardFilters({});

  useEffect(() => {
    if (!selectedCampus) {
      setRecoveryData(null);
      setSelectedSubject(null);
      return;
    }

    async function fetchRecovery() {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(
          `/api/attendance/recovery/subjects?campus=${encodeURIComponent(selectedCampus)}`,
        );
        if (!response.ok) {
          throw new Error("Failed to fetch recovery data");
        }
        const data = await response.json();
        setRecoveryData(data);
        setSelectedSubject(
          data.subjects.length > 0 ? data.subjects[0].subjectTitle : null,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to fetch data";
        setError(message);
        toast({ variant: "destructive", title: "Error", description: message });
      } finally {
        setLoading(false);
      }
    }

    fetchRecovery();
  }, [selectedCampus, toast]);

  const selectedSubjectData = useMemo(() => {
    if (!recoveryData || !selectedSubject) return null;
    return (
      recoveryData.subjects.find((subject) => subject.subjectTitle === selectedSubject) ??
      null
    );
  }, [recoveryData, selectedSubject]);

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
    if (!selectedSubjectData) {
      toast({ variant: "destructive", title: "No subject selected" });
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
    const rows: (string | number)[][] = selectedSubjectData.students.map(
      (student) => [
        selectedCampus,
        selectedSubjectData.subjectTitle,
        student.studentId,
        student.studentName,
        student.sectionName || "-",
        `${student.attendancePct.toFixed(1)}%`,
        `${student.presentCount}/${student.totalCount}`,
      ],
    );

    exportCsv(
      `recovery-${selectedCampus}-${selectedSubjectData.subjectTitle}-${new Date()
        .toISOString()
        .split("T")[0]}.csv`,
      headers,
      rows,
    );
  };

  if (filtersLoading) {
    return <PageLoader />;
  }

  const campusOptions =
    filterOptions?.campuses.map((campus) => ({ value: campus, label: campus })) || [];

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title="Recovery Dashboard"
        subtitle="Campus subject recovery based on subject-level attendance below 80%"
      />

      <div className="flex items-end gap-4">
        <div className="flex-1">
          <label className="mb-2 block text-sm font-medium text-gray-700">
            Select Campus
          </label>
          <Select value={selectedCampus} onValueChange={setSelectedCampus}>
            <SelectTrigger>
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
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-gray-600">Loading subject recovery data...</span>
        </div>
      )}

      {error && !loading && (
        <ErrorState message={error} />
      )}

      {!selectedCampus && !loading && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-8 text-center">
          <AlertCircle className="mx-auto mb-3 h-10 w-10 text-gray-400" />
          <p className="text-gray-600">Select a campus to view recovery subjects</p>
        </div>
      )}

      {selectedCampus && !loading && recoveryData && (
        <div className="flex flex-col gap-6">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <p className="text-sm font-medium text-gray-600">Subjects in Recovery</p>
              <p className="mt-2 text-3xl font-bold text-gray-900">
                {recoveryData.totalSubjectsInRecovery}
              </p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <p className="text-sm font-medium text-gray-600">Students Affected</p>
              <p className="mt-2 text-3xl font-bold text-gray-900">
                {recoveryData.totalStudentsInRecovery}
              </p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <p className="text-sm font-medium text-gray-600">Campus</p>
              <p className="mt-2 text-lg font-bold text-gray-900">
                {recoveryData.campus}
              </p>
            </div>
          </div>

          {recoveryData.subjects.length === 0 && (
            <div className="rounded-lg border border-green-200 bg-green-50 p-8 text-center">
              <p className="text-green-700">
                ✓ Great! No subject is below 80% attendance in <strong>{recoveryData.campus}</strong>.
              </p>
            </div>
          )}

          {recoveryData.subjects.length > 0 && (
            <div className="space-y-6">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {recoveryData.subjects.map((subject) => (
                  <button
                    key={subject.subjectTitle}
                    type="button"
                    onClick={() => setSelectedSubject(subject.subjectTitle)}
                    className={`rounded-xl border p-4 text-left transition ${
                      selectedSubject === subject.subjectTitle
                        ? "border-red-300 bg-red-50 shadow-sm"
                        : "border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                          Subject
                        </p>
                        <h3 className="mt-1 text-lg font-semibold text-gray-900">
                          {subject.subjectTitle}
                        </h3>
                      </div>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${pctTextColor(subject.attendancePct)}`}>
                        {subject.attendancePct.toFixed(1)}%
                      </span>
                    </div>
                    <div className="mt-4 flex items-center justify-between">
                      <span className="text-sm text-gray-600">Below 80%</span>
                      <span className="text-lg font-bold text-red-600">
                        {subject.studentsBelow80Count}
                      </span>
                    </div>
                  </button>
                ))}
              </div>

              {selectedSubjectData && (
                <div className="rounded-xl border border-gray-200 bg-white p-4">
                  <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-500">Selected subject</p>
                      <h3 className="text-2xl font-bold text-gray-900">
                        {selectedSubjectData.subjectTitle}
                      </h3>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`rounded-full px-3 py-1 text-sm font-semibold ${pctTextColor(selectedSubjectData.attendancePct)}`}>
                        {selectedSubjectData.attendancePct.toFixed(1)}% attendance
                      </span>
                      <Button onClick={handleExport} variant="outline" size="sm">
                        <Download className="mr-2 h-4 w-4" />
                        Export
                      </Button>
                    </div>
                  </div>

                  <div className="mb-4">
                    <input
                      type="text"
                      placeholder="Search by student name or ID..."
                      value={searchFilter}
                      onChange={(e) => setSearchFilter(e.target.value)}
                      className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-brand-500 focus:outline-none"
                    />
                  </div>

                  {filteredStudents.length === 0 ? (
                    <div className="rounded-lg border border-gray-200 bg-gray-50 p-6 text-center text-gray-600">
                      No students match this search in {selectedSubjectData.subjectTitle}.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-200 bg-gray-50">
                            <th className="px-4 py-2 text-left font-medium text-gray-700">Student Name</th>
                            <th className="px-4 py-2 text-left font-medium text-gray-700">Student ID</th>
                            <th className="px-4 py-2 text-left font-medium text-gray-700">Section</th>
                            <th className="px-4 py-2 text-center font-medium text-gray-700">Attendance</th>
                            <th className="px-4 py-2 text-center font-medium text-gray-700">Sessions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredStudents.map((student) => (
                            <tr key={student.studentId} className="border-b border-gray-100 hover:bg-gray-50">
                              <td className="px-4 py-3 font-medium text-gray-900">{student.studentName}</td>
                              <td className="px-4 py-3 font-mono text-gray-600">{student.studentId}</td>
                              <td className="px-4 py-3 text-gray-600">{student.sectionName || "-"}</td>
                              <td className="px-4 py-3">
                                <div className="flex justify-center">
                                  <span className={`font-semibold ${pctTextColor(student.attendancePct)}`}>
                                    {student.attendancePct.toFixed(1)}%
                                  </span>
                                </div>
                              </td>
                              <td className="px-4 py-3 text-center text-gray-600">
                                {student.presentCount}/{student.totalCount}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
