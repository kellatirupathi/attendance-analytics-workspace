import { useEffect, useState } from "react";

export function useAttendanceSemesters(campus?: string, opts?: { currentOnly?: boolean }) {
  const [semesters, setSemesters] = useState<string[]>([]);
  const campusKey = campus && campus !== "all" ? campus : "";
  const currentOnly = opts?.currentOnly === true;

  useEffect(() => {
    let alive = true;
    const params = new URLSearchParams();
    if (campusKey) params.set("campus", campusKey);
    if (currentOnly) params.set("current", "1");
    const qs = params.toString();
    fetch(`/api/dashboard/semesters${qs ? `?${qs}` : ""}`, {
      credentials: "include",
    })
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: string[]) => {
        if (alive) setSemesters(data ?? []);
      })
      .catch(() => {
        if (alive) setSemesters([]);
      });
    return () => {
      alive = false;
    };
  }, [campusKey, currentOnly]);

  return semesters;
}
