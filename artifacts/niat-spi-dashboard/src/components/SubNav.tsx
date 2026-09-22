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
            key={item.label}
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

export function attendanceStatsNav(
  statsHref: string,
  campusesHref: string,
): SubNavItem[] {
  return [
    { label: "Attendance Stats", href: statsHref },
    { label: "Campus-wise Stats", href: campusesHref },
  ];
}

export function assessmentsPath(campus?: string, semester?: string): string {
  const params = new URLSearchParams();
  if (campus && campus !== "all") params.set("campus", campus);
  if (semester) params.set("semester", semester);
  const query = params.toString();
  return query ? `/dashboard/assessments?${query}` : "/dashboard/assessments";
}

export function assessmentSubjectsPath(
  campus: string,
  semester?: string,
): string {
  const params = new URLSearchParams({ campus });
  if (semester) params.set("semester", semester);
  return `/dashboard/assessments/subjects?${params.toString()}`;
}

export function assessmentStudentsPath(
  campus: string,
  subject: string,
  semester?: string,
): string {
  const params = new URLSearchParams({ campus, subject });
  if (semester) params.set("semester", semester);
  return `/dashboard/assessments/students?${params.toString()}`;
}

export function recoveryListPath(
  tab: "attendance" | "quiz",
  campus?: string,
  semester?: string,
): string {
  const path = tab === "quiz" ? "/dashboard/recovery/quiz" : "/dashboard/recovery";
  const params = new URLSearchParams();
  if (campus) params.set("campus", campus);
  if (semester) params.set("semester", semester);
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

export const RECOVERY_INCENTIVES_PATH = "/dashboard/recovery/incentives";

/**
 * When `campus` is given, the Incentive Tracker opens scoped to just that
 * campus (matching the Attendance/Quizzes tabs' own campus-scoping) --
 * omit it to see every campus the signed-in session has access to.
 */
export function incentivesPath(campus?: string): string {
  if (!campus || campus === "all") return RECOVERY_INCENTIVES_PATH;
  const params = new URLSearchParams({ campus });
  return `${RECOVERY_INCENTIVES_PATH}?${params.toString()}`;
}

export function recoveryNav(
  campus?: string,
  semester?: string,
  showIncentives?: boolean,
): SubNavItem[] {
  const items: SubNavItem[] = [
    { label: "Attendance", href: recoveryListPath("attendance", campus, semester) },
    { label: "Quizzes", href: recoveryListPath("quiz", campus, semester) },
  ];
  if (showIncentives) {
    items.push({
      label: "Incentives",
      href: incentivesPath(campus),
      matchPrefix: RECOVERY_INCENTIVES_PATH,
    });
  }
  return items;
}

export function reportsPath(
  tab: "spi-record" | "skill-debt" | "insights" = "spi-record",
): string {
  if (tab === "skill-debt") return "/dashboard/reports/skill-debt";
  if (tab === "insights") return "/dashboard/reports/insights";
  return "/dashboard/reports";
}

export function reportsNav(): SubNavItem[] {
  return [
    { label: "SPI Record", href: reportsPath("spi-record") },
    { label: "Skill Debt", href: reportsPath("skill-debt") },
    { label: "Insights", href: reportsPath("insights") },
  ];
}
