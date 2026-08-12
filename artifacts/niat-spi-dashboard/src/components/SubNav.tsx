import { useLocation } from "wouter";
import { cn } from "@/lib/utils";

export interface SubNavItem {
  label: string;
  href: string;
  /** Also mark active when the current location sits under this href. */
  matchPrefix?: string;
}

/**
 * Horizontal tab strip for sibling views inside one sidebar section
 * (e.g. Attendance Stats vs Campus-wise Stats).
 */
export function SubNav({ items }: { items: SubNavItem[] }) {
  const [location, setLocation] = useLocation();
  const path = location.split("?")[0] ?? location;

  const isActive = (item: SubNavItem) => {
    const base = item.href.split("?")[0]!;
    if (path === base) return true;
    if (item.matchPrefix && path.startsWith(item.matchPrefix)) return true;
    return false;
  };

  return (
    <div className="mb-4 flex items-center gap-1 border-b border-gray-200">
      {items.map((item) => {
        const active = isActive(item);
        return (
          <button
            key={item.href}
            type="button"
            onClick={() => setLocation(item.href)}
            className={cn(
              "-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors",
              active
                ? "border-brand-600 text-brand-700"
                : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-800",
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

export const ATTENDANCE_STATS_NAV: SubNavItem[] = [
  {
    label: "Attendance Stats",
    href: "/dashboard/attendance-stats",
    matchPrefix: "/dashboard/attendance-stats/students",
  },
  {
    label: "Campus-wise Stats",
    href: "/dashboard/attendance-stats/campuses",
    matchPrefix: "/dashboard/attendance-stats/campuses",
  },
];
