import { useLocation } from "wouter";
import { cn } from "@/lib/utils";

export interface SubNavItem {
  label: string;
  href: string;
  /** Also mark active when the current location sits under one of these. */
  matchPrefix?: string | string[];
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
    const prefixes = item.matchPrefix
      ? Array.isArray(item.matchPrefix)
        ? item.matchPrefix
        : [item.matchPrefix]
      : [];
    return prefixes.some((p) => path.startsWith(p));
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

// Only the two top-level views render this strip; the drill-down pages use
// breadcrumbs instead, so no prefix matching is needed here.
export const ATTENDANCE_STATS_NAV: SubNavItem[] = [
  { label: "Attendance Stats", href: "/dashboard/attendance-stats" },
  { label: "Campus-wise Stats", href: "/dashboard/attendance-stats/campuses" },
];
