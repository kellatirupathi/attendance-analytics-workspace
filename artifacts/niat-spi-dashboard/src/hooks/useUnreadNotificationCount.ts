import { useEffect, useState } from "react";

export function useUnreadNotificationCount(enabled: boolean): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const fetchCount = async () => {
      try {
        const res = await fetch("/api/notifications/count", {
          credentials: "include",
        });
        if (res.ok && alive) {
          const data = (await res.json()) as { unread?: number };
          setCount(data.unread ?? 0);
        }
      } catch {
        /* ignore */
      }
    };
    fetchCount();
    const onRead = () => fetchCount();
    window.addEventListener("notifications-read", onRead);
    const id = setInterval(fetchCount, 30_000);
    return () => {
      alive = false;
      clearInterval(id);
      window.removeEventListener("notifications-read", onRead);
    };
  }, [enabled]);

  return count;
}
