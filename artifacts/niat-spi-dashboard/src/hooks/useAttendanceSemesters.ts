import { useEffect, useState } from "react";

export function useAttendanceSemesters(campus?: string) {
  const [semesters, setSemesters] = useState<string[]>([]);
  const campusKey = campus && campus !== "all" ? campus : "";

  useEffect(() => {
    let alive = true;
    const params = new URLSearchParams();
    if (campusKey) params.set("campus", campusKey);
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
  }, [campusKey]);

  return semesters;
}
