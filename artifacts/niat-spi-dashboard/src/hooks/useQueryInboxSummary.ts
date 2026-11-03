import { useQuery } from "@tanstack/react-query";

export interface QueryInboxSummary {
  /** Queries waiting for the SPI team's reply (the menu badge). */
  needsReply: number;
  /** New queries and student replies since this admin last opened the bell. */
  unread: number;
}

/** Admin / Super Admin only: `enabled` must be false for every other role (the server answers 403 to them). */
export function useQueryInboxSummary(enabled: boolean) {
  return useQuery({
    queryKey: ["query-inbox-summary"],
    enabled,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<QueryInboxSummary> => {
      const res = await fetch("/api/query-inbox/summary", { credentials: "include" });
      if (!res.ok) throw new Error("summary");
      return (await res.json()) as QueryInboxSummary;
    },
  });
}
