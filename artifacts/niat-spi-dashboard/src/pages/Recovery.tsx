import { useEffect, useMemo, useState } from "react";
import {
  useGetDashboardFilters,
  getGetDashboardFiltersQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/PageHeader";
import { PageLoader, ErrorState } from "@/components/PageStates";
import { AlertCircle, Loader2, Download } from "lucide-react";
import { pctTextColor } from "@/lib/utils";
import { exportCsv } from "@/lib/csv";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

interface RecoveryStudent {
  studentId: string;
  studentName: string;
  sectionName: string | null;
  attendancePct: number;
  presentCount: number;
  totalCount: number;
}

interface RecoverySubject {
  subjectTitle: string;
  studentCount: number;
  students: RecoveryStudent[];
}

interface RecoveryData {
  campus: string;
  subjects: RecoverySubject[];
  totalStudentsInRecovery: number;
}

export default function Recovery() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [selectedCampus, setSelectedCampus] = useState("");
  const [recoveryData, setRecoveryData] = useState<RecoveryData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [searchFilter, setSearchFilter] = useState("");

  const { data: filterOptions, isLoading: filtersLoading } =
    useGetDashboardFilters({});

  // Fetch recovery data when campus is selected
  useEffect(() => {
    if (!selectedCampus) {
      setRecoveryData(null);
      return;
    }

    async function fetchRecovery() {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(`/api/attendance/recovery?campus=${encodeURIComponent(selectedCampus)}`);
        if (!response.ok) {
          throw new Error("Failed to fetch recovery data");
        }
        const data = await response.json();
        setRecoveryData(data);
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

  // Filter students by search term
  const filteredData = useMemo(() => {
    if (!recoveryData || !searchFilter.trim()) return recoveryData;

    const lowerSearch = searchFilter.toLowerCase();
    const filteredSubjects = recoveryData.subjects
      .map((subject) => ({
        ...subject,
        students: subject.students.filter(
          (s) =>
            s.studentName.toLowerCase().includes(lowerSearch) ||
            s.studentId.toLowerCase().includes(lowerSearch),
        ),
      }))
      .filter((subject) => subject.students.length > 0);

    return {
      ...recoveryData,
      subjects: filteredSubjects,
      totalStudentsInRecovery: new Set(
        filteredSubjects.flatMap((s) => s.students.map((st) => st.studentId)),
      ).size,
    };
  }, [recoveryData, searchFilter]);

  const handleExport = () => {
    if (!filteredData || filteredData.subjects.length === 0) {
      toast({ variant: "destructive", title: "No data to export" });
      return;
    }

    const rows: Record<string, string>[] = [];
    for (const subject of filteredData.subjects) {
      for (const student of subject.students) {
        rows.push({
          Campus: filteredData.campus,
          Subject: subject.subjectTitle,
          "Student ID": student.studentId,
          "Student Name": student.studentName,
          Section: student.sectionName || "-",
          Attendance: `${student.attendancePct.toFixed(1)}%`,
          "Present/Total": `${student.presentCount}/${student.totalCount}`,
        });
      }
    }

    exportCsv(
      rows,
      `recovery-${filteredData.campus}-${new Date().toISOString().split("T")[0]}.csv`,
    );
  };

  if (filtersLoading) {
    return <PageLoader />;
  }

  const campusOptions =
    filterOptions?.campuses.map((c) => ({ value: c, label: c })) || [];

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title="Recovery Dashboard"
        description="Students with attendance below 75% by subject"
      />

      {/* Campus Selector */}
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
        {selectedCampus && filteredData && filteredData.totalStudentsInRecovery > 0 && (
          <Button onClick={handleExport} variant="outline" size="sm">
            <Download className="mr-2 h-4 w-4" />
            Export
          </Button>
        )}
      </div>

      {/* Loading State */}
      {loading && (
        <div className="flex items-center justify-center gap-2 py-12">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-gray-600">Loading recovery data...</span>
        </div>
      )}

      {/* Error State */}
      {error && !loading && (
        <ErrorState
          title="Failed to load data"
          message={error}
          action={
            selectedCampus
              ? () => setSelectedCampus(selectedCampus)
              : undefined
          }
        />
      )}

      {/* No Selection */}
      {!selectedCampus && !loading && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-8 text-center">
          <AlertCircle className="mx-auto mb-3 h-10 w-10 text-gray-400" />
          <p className="text-gray-600">Select a campus to view recovery data</p>
        </div>
      )}

      {/* Results */}
      {selectedCampus && !loading && filteredData && (
        <div className="flex flex-col gap-4">
          {/* Summary Card */}
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="flex items-baseline justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">
                  Students in Recovery
                </p>
                <p className="text-3xl font-bold text-gray-900">
                  {filteredData.totalStudentsInRecovery}
                </p>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-600">
                  Subjects with Low Attendance
                </p>
                <p className="text-3xl font-bold text-gray-900">
                  {filteredData.subjects.length}
                </p>
              </div>
            </div>
          </div>

          {/* Search Filter */}
          {filteredData.subjects.length > 0 && (
            <div>
              <input
                type="text"
                placeholder="Search by student name or ID..."
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-brand-500 focus:outline-none"
              />
            </div>
          )}

          {/* No Results */}
          {filteredData.subjects.length === 0 && (
            <div className="rounded-lg border border-green-200 bg-green-50 p-8 text-center">
              <p className="text-green-700">
                ✓ Great! No students with attendance below 75% in{" "}
                <strong>{filteredData.campus}</strong>
              </p>
            </div>
          )}

          {/* Subjects with Low Attendance Students */}
          {filteredData.subjects.map((subject) => (
            <div key={subject.subjectTitle} className="space-y-3">
              <div className="flex items-center justify-between border-b border-gray-200 pb-2">
                <h3 className="font-semibold text-gray-900">
                  {subject.subjectTitle}
                </h3>
                <span className="rounded-full bg-red-100 px-3 py-1 text-sm font-medium text-red-700">
                  {subject.studentCount} students
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50">
                      <th className="px-4 py-2 text-left font-medium text-gray-700">
                        Student Name
                      </th>
                      <th className="px-4 py-2 text-left font-medium text-gray-700">
                        Student ID
                      </th>
                      <th className="px-4 py-2 text-left font-medium text-gray-700">
                        Section
                      </th>
                      <th className="px-4 py-2 text-center font-medium text-gray-700">
                        Attendance
                      </th>
                      <th className="px-4 py-2 text-center font-medium text-gray-700">
                        Sessions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {subject.students.map((student) => (
                      <tr
                        key={student.studentId}
                        className="border-b border-gray-100 hover:bg-gray-50"
                      >
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-900">
                            {student.studentName}
                          </div>
                        </td>
                        <td className="px-4 py-3 font-mono text-gray-600">
                          {student.studentId.substring(0, 8)}...
                        </td>
                        <td className="px-4 py-3 text-gray-600">
                          {student.sectionName || "-"}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-center">
                            <span
                              className={`font-semibold ${pctTextColor(student.attendancePct)}`}
                            >
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
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
