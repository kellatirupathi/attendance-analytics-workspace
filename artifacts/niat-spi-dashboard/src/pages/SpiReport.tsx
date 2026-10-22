import { useEffect } from "react";
import { useLocation, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useQueryParams } from "@/hooks/useQueryParams";
import StudentReportView, { type StudentScorecard } from "@/pages/StudentReportView";

class ScorecardError extends Error {
  constructor(public status: number) {
    super(`Scorecard request failed (${status})`);
  }
}

async function fetchScorecard(studentId: string, token: string | undefined): Promise<StudentScorecard> {
  const qs = token ? `?t=${encodeURIComponent(token)}` : "";
  const res = await fetch(`/api/attendance/students/${encodeURIComponent(studentId)}/scorecard${qs}`, {
    credentials: "include",
  });
  if (!res.ok) throw new ScorecardError(res.status);
  return (await res.json()) as StudentScorecard;
}

export default function SpiReport() {
  const { studentId = "" } = useParams<{ studentId: string }>();
  const token = useQueryParams().get("t") ?? undefined;

  const { data, isLoading, error, refetch } = useQuery({
    // The token is part of the key so tokened and staff-session responses stay separate.
    queryKey: ["spi-scorecard", studentId, token ?? null],
    queryFn: () => fetchScorecard(studentId, token),
    enabled: !!studentId,
    // A bad link or a missing student will not fix itself on retry.
    retry: (count, err) => !(err instanceof ScorecardError && [400, 401, 403, 404].includes(err.status)) && count < 2,
  });

  // Not signed in (no staff session, no student login): go to the student login, which comes back here.
  const [, setLocation] = useLocation();
  const needsLogin = error instanceof ScorecardError && error.status === 401;
  useEffect(() => {
    if (needsLogin) setLocation(`/student-login?next=${encodeURIComponent(`/spi/${studentId}`)}`);
  }, [needsLogin, studentId, setLocation]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#EEF3F9] px-4 py-6 sm:px-6">
        <div className="mx-auto max-w-[1536px] space-y-3.5">
          <Skeleton className="h-20 w-full rounded-2xl" />
          <div className="grid gap-3.5 md:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-60 rounded-2xl" />
            ))}
          </div>
          <Skeleton className="h-96 w-full rounded-2xl" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    const status = error instanceof ScorecardError ? error.status : 0;
    const message =
      status === 403
        ? "You don't have access to this student's report."
        : status === 404
          ? "We couldn't find attendance records for this student in the current semester."
          : "Something went wrong while loading the report.";
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#EEF3F9] p-4">
        <div className="w-full max-w-md text-center">
          <AlertCircle className="mx-auto mb-4 h-10 w-10 text-red-500" />
          <h2 className="mb-2 text-xl font-bold text-gray-900">We couldn't load this report</h2>
          <p className="mb-4 text-sm text-gray-600">{message}</p>
          {status !== 403 && status !== 404 && (
            <button
              type="button"
              onClick={() => void refetch()}
              className="min-h-11 rounded-xl bg-[#0F2A5C] px-4 text-sm font-semibold text-white"
            >
              Try again
            </button>
          )}
        </div>
      </div>
    );
  }

  return <StudentReportView data={data} />;
}
