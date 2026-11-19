import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

/** One Skill Assessment course → report course row (api-server saCourseMapAdminModel.ts MappingRow). */
export interface SaCourseMapRow {
  college: string;
  batch: string;
  semester: string;
  saCourse: string;
  reportCourse: string | null;
  status: string;
  mainSaCount: number;
  students: number;
  lastSaDate: string | null;
  /** This semester is on the batch's live reports. */
  current: boolean;
  /** Courses on the saved reports of this college, batch and semester. */
  options: string[];
  editable: boolean;
}

export const SA_MAP_KEY = ["admin-sa-course-map"];
export const SA_MAP_SUMMARY_KEY = ["admin-sa-course-map-summary"];

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error || `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

export function useSaCourseMap() {
  return useQuery({
    queryKey: SA_MAP_KEY,
    queryFn: async () => json<{ rows: SaCourseMapRow[]; toConfirm: number }>(await fetch("/api/admin/sa-course-map", { credentials: "include" })),
  });
}

/** Admin / Super Admin only (`enabled` false for other roles): rows waiting to be confirmed, for the menu badge. */
export function useSaCourseMapSummary(enabled: boolean) {
  return useQuery({
    queryKey: SA_MAP_SUMMARY_KEY,
    enabled,
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: true,
    queryFn: async () => json<{ toConfirm: number }>(await fetch("/api/admin/sa-course-map/summary", { credentials: "include" })),
  });
}

export function useSaveSaCourseMapping() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { college: string; batch: string; saCourse: string; reportCourse: string | null }) =>
      json<SaCourseMapRow>(
        await fetch("/api/admin/sa-course-map", {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: SA_MAP_KEY });
      void queryClient.invalidateQueries({ queryKey: SA_MAP_SUMMARY_KEY });
    },
  });
}
