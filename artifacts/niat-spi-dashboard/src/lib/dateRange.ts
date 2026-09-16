import { format, parseISO, startOfMonth, subDays } from "date-fns";

export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type DateRange = {
  dateFrom?: string;
  dateTo?: string;
};

export type DatePreset = "all" | "7d" | "30d" | "month" | "custom";

export function toIsoDate(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

export function readDateRange(params: URLSearchParams): DateRange {
  const dateFrom = params.get("dateFrom")?.trim() || undefined;
  const dateTo = params.get("dateTo")?.trim() || undefined;
  return {
    dateFrom: dateFrom && ISO_DATE_RE.test(dateFrom) ? dateFrom : undefined,
    dateTo: dateTo && ISO_DATE_RE.test(dateTo) ? dateTo : undefined,
  };
}

export function applyDateRange(params: URLSearchParams, range: DateRange): void {
  if (range.dateFrom) params.set("dateFrom", range.dateFrom);
  else params.delete("dateFrom");
  if (range.dateTo) params.set("dateTo", range.dateTo);
  else params.delete("dateTo");
}

export function withDateRange(
  path: string,
  range: DateRange,
  extra?: Record<string, string | undefined>,
): string {
  const qIndex = path.indexOf("?");
  const pathname = qIndex >= 0 ? path.slice(0, qIndex) : path;
  const params = new URLSearchParams(qIndex >= 0 ? path.slice(qIndex + 1) : "");
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
  }
  applyDateRange(params, range);
  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

export function dateRangeLabel(range: DateRange): string {
  if (!range.dateFrom && !range.dateTo) return "Current semester";
  const fmt = (iso: string) => format(parseISO(iso), "d MMM yyyy");
  if (range.dateFrom && range.dateTo) {
    if (range.dateFrom === range.dateTo) return fmt(range.dateFrom);
    return `${fmt(range.dateFrom)} – ${fmt(range.dateTo)}`;
  }
  if (range.dateFrom) return `From ${fmt(range.dateFrom)}`;
  return `Until ${fmt(range.dateTo!)}`;
}

export function rangeForPreset(
  preset: Exclude<DatePreset, "all" | "custom">,
): DateRange {
  const today = new Date();
  const to = toIsoDate(today);
  if (preset === "7d") {
    return { dateFrom: toIsoDate(subDays(today, 6)), dateTo: to };
  }
  if (preset === "30d") {
    return { dateFrom: toIsoDate(subDays(today, 29)), dateTo: to };
  }
  return { dateFrom: toIsoDate(startOfMonth(today)), dateTo: to };
}

export function matchPreset(range: DateRange): DatePreset {
  if (!range.dateFrom && !range.dateTo) return "all";
  for (const preset of ["7d", "30d", "month"] as const) {
    const expected = rangeForPreset(preset);
    if (
      range.dateFrom === expected.dateFrom &&
      range.dateTo === expected.dateTo
    ) {
      return preset;
    }
  }
  return "custom";
}

export function attendanceStatsPath(
  range: DateRange,
  campus?: string,
): string {
  return withDateRange("/dashboard/attendance-stats", range, {
    campus: campus && campus !== "all" ? campus : undefined,
  });
}

export function campusWisePath(range: DateRange, campus?: string): string {
  return withDateRange("/dashboard/attendance-stats/campuses", range, {
    campus: campus || undefined,
  });
}

export function campusAnalyticsPath(range: DateRange): string {
  return withDateRange("/dashboard/campuses", range);
}
