import React, { useMemo } from "react";
import { Link, useLocation } from "wouter";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { addDays, differenceInCalendarDays, format, parseISO, subDays } from "date-fns";
import type { SubjectSummary } from "@workspace/api-client-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import { ErrorState } from "@/components/PageStates";
import { AttendanceBySubject } from "@/components/dashboard/blocks";
import {
  AttendanceTrend,
  CompletionBars,
  InsightsList,
  Leaderboard,
  OverviewFilterBar,
  Section,
  SectionError,
  SectionLink,
  SkillSplit,
  SourceNote,
  StatTile,
  TierBar,
  WatchList,
  type OverviewPeriod,
  type TrendPoint,
} from "@/components/dashboard/overview";
import { omitExcludedInstitutes } from "@/lib/excludedInstitutes";
import { pctReadableColor } from "@/lib/utils";
import { NO_SESSIONS_LABEL } from "@/lib/attendanceTiers";
import { exportCsv } from "@/lib/csv";
import { useQueryParams } from "@/hooks/useQueryParams";
import {
  ISO_DATE_RE,
  campusAnalyticsPath,
  type DateRange,
} from "@/lib/dateRange";
import { roleLabel } from "@/lib/roleLabels";
import { useUnreadNotificationCount } from "@/hooks/useUnreadNotificationCount";
import type { AttendanceClassRow, AttendanceDetailRow } from "@/lib/attendanceStatsAggregate";
import type { SpiDetailRow } from "@/lib/spiRecordAggregate";
import type { AssessmentRosterRow, AssessmentSlot } from "@/lib/assessmentAggregate";
import {
  assessmentOverview,
  attendanceOverview,
  attendancePctOnly,
  leaderboard,
  spiOverview,
  watchList,
  type LeaderGrain,
  type LeaderRow,
  type OverviewFilters,
} from "@/lib/overviewAggregate";
import { buildInsights } from "@/lib/overviewInsights";
import { readSubjects, subjectOptionList } from "@/lib/subjects";
import { FEATURES } from "@/lib/featureFlags";
import { Users, Building2, UserCog, Database, Bell, Inbox } from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type Role =
  | "superadmin"
  | "admin"
  | "hod"
  | "capability_manager"
  | "boa"
  | "instructor";

type KpiId = "students" | "attendance" | "eligible" | "belowSixty" | "avgSpi" | "skillDebt" | "completion";

interface QuickAction {
  label: string;
  href: string;
  icon: React.ElementType;
  primary?: boolean;
}

interface RoleTheme {
  title: string;
  subtitle: string;
}

interface RoleLayout {
  /** Leaderboard grouping when no single campus is picked. */
  leader: LeaderGrain;
  kpis: KpiId[];
}

interface AttendancePayload {
  students: AttendanceDetailRow[];
  classes: AttendanceClassRow[];
  spiPaths: Record<string, string>;
}

interface SpiPayload {
  rows: SpiDetailRow[];
  spiPaths: Record<string, string>;
}

interface AssessmentPayload {
  slots: AssessmentSlot[];
  roster: AssessmentRosterRow[];
}

/* ------------------------------------------------------------------ */
/*  Per-role copy, layout and quick actions                            */
/* ------------------------------------------------------------------ */

const ROLE_THEME: Record<Role, RoleTheme> = {
  superadmin: {
    title: "System Overview",
    subtitle: "Attendance, SPI and assessments across every campus.",
  },
  admin: {
    title: "Attendance & Access",
    subtitle: "Performance across all campuses and platform access.",
  },
  hod: {
    title: "Academic Overview",
    subtitle: "Attendance and academic performance across the department.",
  },
  capability_manager: {
    title: "Subject Performance",
    subtitle: "Attendance, SPI and quiz completion for the subjects you manage.",
  },
  boa: {
    title: "Campus Overview",
    subtitle: "Attendance health, skill levels and requests for your campuses.",
  },
  instructor: {
    title: "Class Overview",
    subtitle: "Attendance and performance for the students you teach.",
  },
};

const ALL_KPIS: KpiId[] = ["students", "attendance", "eligible", "belowSixty", "avgSpi", "skillDebt", "completion"];

const ROLE_LAYOUT: Record<Role, RoleLayout> = {
  superadmin: { leader: "campus", kpis: ALL_KPIS },
  admin: { leader: "campus", kpis: ALL_KPIS },
  hod: { leader: "campus", kpis: ALL_KPIS },
  capability_manager: { leader: "subject", kpis: ["attendance", "avgSpi", "completion", "skillDebt"] },
  boa: { leader: "section", kpis: ALL_KPIS },
  instructor: { leader: "section", kpis: ALL_KPIS },
};

/** Student Attendance Stats, carrying the Overview's closed date range when it has one. */
function attendanceStatsRangePath(range: DateRange): string {
  if (!range.dateFrom || !range.dateTo) return "/dashboard/attendance-stats";
  const p = new URLSearchParams({ scope: "range", dateFrom: range.dateFrom, dateTo: range.dateTo });
  return `/dashboard/attendance-stats?${p.toString()}`;
}

function quickActions(role: Role, range: DateRange, studentsHref: string): QuickAction[] {
  const students: QuickAction = { label: "Student Directory", href: studentsHref, icon: Users, primary: true };
  const campuses: QuickAction = FEATURES.campusAnalytics
    ? { label: "Campus Analytics", href: campusAnalyticsPath(range), icon: Building2 }
    : { label: "Attendance Stats", href: attendanceStatsRangePath(range), icon: Building2 };
  const requests: QuickAction = { label: "Request Inbox", href: "/dashboard/requests", icon: Bell };
  const manageUsers: QuickAction = { label: "Manage Users", href: "/admin/users", icon: UserCog };
  const manageCampuses: QuickAction = { label: "Manage Campuses", href: "/admin/campuses", icon: Building2 };
  const bigquery: QuickAction = { label: "Data Explorer", href: "/dashboard/bigquery", icon: Database };

  switch (role) {
    case "superadmin":
      return [students, manageUsers, campuses, bigquery];
    case "admin":
      return [students, manageUsers, manageCampuses, requests];
    case "hod":
      return [students, campuses, requests];
    case "capability_manager":
      return [students, campuses];
    case "boa":
      return [{ ...requests, primary: true }, students];
    default:
      return [students];
  }
}

/* ------------------------------------------------------------------ */
/*  URL + period helpers                                               */
/* ------------------------------------------------------------------ */

function splitList(value: string | null): string[] {
  return value ? value.split("||").map((item) => item.trim()).filter(Boolean) : [];
}

function iso(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

/** The closed date dateWindow for attendance-stats, or null for "current semester". */
function periodWindow(period: OverviewPeriod, from: string, to: string): { dateFrom: string; dateTo: string } | null {
  if (period === "last_30") {
    const today = new Date();
    return { dateFrom: iso(subDays(today, 30)), dateTo: iso(today) };
  }
  // A reversed range is not applied; the filter bar says so and offers to swap.
  if (period === "custom" && ISO_DATE_RE.test(from) && ISO_DATE_RE.test(to) && from <= to) {
    return { dateFrom: from, dateTo: to };
  }
  return null;
}

/** The same-length dateWindow just before the current one. */
function previousWindow(current: { dateFrom: string; dateTo: string }): { dateFrom: string; dateTo: string } {
  const start = parseISO(current.dateFrom);
  const days = differenceInCalendarDays(parseISO(current.dateTo), start) + 1;
  return { dateFrom: iso(subDays(start, days)), dateTo: iso(addDays(start, -1)) };
}

function periodLabel(period: OverviewPeriod, dateWindow: { dateFrom: string; dateTo: string } | null): string {
  if (period === "last_30") return "Last 30 days";
  if (dateWindow) return `${format(parseISO(dateWindow.dateFrom), "d MMM yyyy")} – ${format(parseISO(dateWindow.dateTo), "d MMM yyyy")}`;
  return "This semester so far";
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`Failed to load ${url}`);
  return res.json() as Promise<T>;
}

/* ------------------------------------------------------------------ */
/*  Header                                                             */
/* ------------------------------------------------------------------ */

function DashboardHeader({
  role,
  name,
  theme,
  meta,
  unreadRequests,
  range,
  studentsHref,
}: {
  role: Role;
  name: string;
  theme: RoleTheme;
  meta: string;
  unreadRequests: number;
  range: DateRange;
  studentsHref: string;
}) {
  return (
    <PageHeader
      badge={roleLabel(role)}
      title={theme.title}
      subtitle={`${theme.subtitle} Signed in as ${name} · ${meta}`}
      right={
        <div className="flex flex-wrap items-center gap-2">
          {quickActions(role, range, studentsHref).map((a) => (
            <Link key={a.label} href={a.href}>
              <Button variant={a.primary ? "default" : "outline"} size="sm" className="relative gap-2">
                <a.icon className="h-4 w-4" />
                {a.label}
                {a.href === "/dashboard/requests" && unreadRequests > 0 && (
                  <span className="ml-1 rounded-full bg-brand-800 px-1.5 py-0.5 text-xs font-bold text-white">
                    {unreadRequests > 99 ? "99+" : unreadRequests}
                  </span>
                )}
              </Button>
            </Link>
          ))}
        </div>
      }
    />
  );
}

function RequestsCta({ unread }: { unread: number }) {
  return (
    <div className="flex flex-col items-start justify-between gap-3 border-y border-slate-200 bg-white px-5 py-4 sm:flex-row sm:items-center">
      <div>
        <p className="text-sm font-medium text-slate-900">
          Attendance correction requests
          {unread > 0 && <span className="ml-2 rounded-full bg-brand-800 px-2 py-0.5 text-xs font-bold text-white">{unread} unread</span>}
        </p>
        <p className="text-xs text-slate-500">Review and action student-submitted corrections for your campuses.</p>
      </div>
      <Link href="/dashboard/requests">
        <Button size="sm" className="gap-2">
          <Inbox className="h-4 w-4" />
          Open inbox
        </Button>
      </Link>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function Dashboard() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const query = useQueryParams();
  const role = (user?.role as Role) ?? "instructor";
  const theme = ROLE_THEME[role] ?? ROLE_THEME.instructor;
  const layout = ROLE_LAYOUT[role] ?? ROLE_LAYOUT.instructor;
  const canSeeRequests = ["superadmin", "admin", "boa", "hod"].includes(role);
  const unreadRequests = useUnreadNotificationCount(canSeeRequests);
  const enabled = Boolean(user) && role !== "instructor";

  const lockedCampus = role === "boa" && user?.campuses?.length === 1 ? user.campuses[0]! : null;
  const campuses = lockedCampus ? [lockedCampus] : splitList(query.get("campuses"));
  const semesters = splitList(query.get("semesters"));
  const sections = splitList(query.get("sections")).filter((value) => value.includes("\t"));
  const subjects = readSubjects(query);
  const subjectKey = subjects.join("||");
  const rawPeriod = query.get("attRange");
  const period: OverviewPeriod = rawPeriod === "last_30" || rawPeriod === "custom" ? rawPeriod : "semester_to_date";
  const from = query.get("attFrom") || "";
  const to = query.get("attTo") || "";
  const dateWindow = periodWindow(period, from, to);
  // An incomplete or reversed custom range keeps showing "This semester so far" until it is valid.
  const customPending = period === "custom" && !dateWindow;
  const appliedPeriod: OverviewPeriod = customPending ? "semester_to_date" : period;
  const rangeReversed = customPending && ISO_DATE_RE.test(from) && ISO_DATE_RE.test(to);
  const range: DateRange = dateWindow ?? {};

  const writeQuery = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(query);
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    const qs = next.toString();
    setLocation(qs ? `/dashboard?${qs}` : "/dashboard");
  };

  /* ---- data: same endpoints + query keys as the detail pages ---- */

  const attParams = new URLSearchParams();
  if (dateWindow) {
    attParams.set("dateFrom", dateWindow.dateFrom);
    attParams.set("dateTo", dateWindow.dateTo);
  }
  const spiParams = new URLSearchParams();
  if (period === "custom" && dateWindow) {
    spiParams.set("attRange", "custom");
    spiParams.set("attFrom", dateWindow.dateFrom);
    spiParams.set("attTo", dateWindow.dateTo);
  } else if (appliedPeriod !== "custom") {
    spiParams.set("attRange", appliedPeriod);
  }
  // SPI detail sums attendance across subjects, so the server narrows it.
  if (subjects.length) spiParams.set("subjects", subjectKey);

  const attQuery = useQuery({
    queryKey: ["attendance-stats-detail", attParams.toString()],
    enabled,
    queryFn: () => getJson<AttendancePayload>(`/api/dashboard/attendance-stats/detail?${attParams.toString()}`),
    placeholderData: keepPreviousData,
    staleTime: 15 * 60_000,
  });
  const spiQuery = useQuery({
    queryKey: ["spi-record-detail", spiParams.toString()],
    enabled,
    queryFn: () => getJson<SpiPayload>(`/api/dashboard/spi-record/detail?${spiParams.toString()}`),
    placeholderData: keepPreviousData,
    staleTime: 15 * 60_000,
  });
  const asmQuery = useQuery({
    queryKey: ["assessment-detail"],
    enabled,
    queryFn: () => getJson<AssessmentPayload>("/api/dashboard/assessment-detail"),
    placeholderData: keepPreviousData,
    staleTime: 15 * 60_000,
  });

  const prevWindow = dateWindow ? previousWindow(dateWindow) : null;
  const prevParams = new URLSearchParams();
  if (prevWindow) {
    prevParams.set("dateFrom", prevWindow.dateFrom);
    prevParams.set("dateTo", prevWindow.dateTo);
  }
  const prevQuery = useQuery({
    queryKey: ["attendance-stats-detail", prevParams.toString()],
    enabled: enabled && Boolean(prevWindow),
    queryFn: () => getJson<AttendancePayload>(`/api/dashboard/attendance-stats/detail?${prevParams.toString()}`),
    staleTime: 15 * 60_000,
  });

  const trendParams = new URLSearchParams(attParams);
  if (campuses.length) trendParams.set("campuses", campuses.join("||"));
  if (semesters.length) trendParams.set("semesters", semesters.join("||"));
  if (sections.length) trendParams.set("sections", sections.join("||"));
  if (subjects.length) trendParams.set("subjects", subjectKey);
  const trendQuery = useQuery({
    queryKey: ["attendance-trend", trendParams.toString()],
    enabled,
    queryFn: () => getJson<{ points: TrendPoint[] }>(`/api/dashboard/attendance-stats/trend?${trendParams.toString()}`),
    placeholderData: keepPreviousData,
    staleTime: 15 * 60_000,
  });

  /* ---- filter options ---- */

  const attRows = attQuery.data?.students;
  const campusOptions = useMemo(() => {
    if (lockedCampus) return [lockedCampus];
    const names = new Set<string>();
    for (const row of attRows ?? []) names.add(row.university);
    for (const row of spiQuery.data?.rows ?? []) names.add(row.university);
    return omitExcludedInstitutes([...names].sort((a, b) => a.localeCompare(b)));
  }, [attRows, spiQuery.data, lockedCampus]);

  const campusKey = campuses.join("||");
  const semesterKey = semesters.join("||");
  const semesterOptions = useMemo(() => {
    const campusSet = new Set(campuses);
    const names = new Set<string>();
    for (const row of attRows ?? []) {
      if (campusSet.size && !campusSet.has(row.university)) continue;
      names.add(row.semester);
    }
    return [...names].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [attRows, campusKey]);

  const subjectOptions = useMemo(() => {
    const campusSet = new Set(campuses);
    const semesterSet = new Set(semesters);
    const names: string[] = [];
    for (const row of attRows ?? []) {
      if (campusSet.size && !campusSet.has(row.university)) continue;
      if (semesterSet.size && !semesterSet.has(row.semester)) continue;
      if (row.subject) names.push(row.subject);
    }
    return subjectOptionList(names);
  }, [attRows, campusKey, semesterKey]);

  const sectionChoices = useMemo(() => {
    if (!campuses.length) return [];
    const campusSet = new Set(campuses);
    const semesterSet = new Set(semesters);
    const seen = new Map<string, { campus: string; section: string }>();
    for (const row of attRows ?? []) {
      if (!campusSet.has(row.university)) continue;
      if (semesterSet.size && !semesterSet.has(row.semester)) continue;
      const key = `${row.university}\t${row.section}`;
      if (!seen.has(key)) seen.set(key, { campus: row.university, section: row.section });
    }
    return [...seen.values()].sort((a, b) => a.section.localeCompare(b.section, undefined, { numeric: true }));
  }, [attRows, campusKey, semesterKey]);

  /* ---- aggregates ---- */

  const filters: OverviewFilters = useMemo(
    () => ({ campuses, semesters, sections, subjects }),
    [campusKey, semesterKey, sections.join("||"), subjectKey],
  );
  const att = useMemo(
    () => (attQuery.data ? attendanceOverview(attQuery.data.students, attQuery.data.classes, filters) : null),
    [attQuery.data, filters],
  );
  const spi = useMemo(() => (spiQuery.data ? spiOverview(spiQuery.data.rows, filters) : null), [spiQuery.data, filters]);
  const asm = useMemo(
    () => (asmQuery.data ? assessmentOverview(asmQuery.data.slots, asmQuery.data.roster, filters) : null),
    [asmQuery.data, filters],
  );
  const prevPct = useMemo(
    () => (prevWindow && prevQuery.data ? attendancePctOnly(prevQuery.data.students, filters) : null),
    [prevQuery.data, filters, prevWindow?.dateFrom],
  );

  const grain: LeaderGrain = layout.leader === "subject" ? "subject" : campuses.length === 1 ? "section" : layout.leader;
  const leaders = useMemo(() => leaderboard(grain, att, spi, asm), [grain, att, spi, asm]);
  const watch = useMemo(() => watchList(att, spi), [att, spi]);
  const prevLabel = prevWindow ? (period === "last_30" ? "the 30 days before" : "the previous period of the same length") : null;
  const insights = useMemo(
    () =>
      buildInsights({
        attendance: att?.header ?? null,
        previousPct: prevPct,
        previousLabel: prevLabel,
        subjects: att?.subjects ?? [],
        leaders,
        grain,
        spi: spi?.summary ?? null,
        assessments: asm?.header ?? null,
      }),
    [att, prevPct, prevLabel, leaders, grain, spi, asm],
  );

  const subjectBars: SubjectSummary[] = useMemo(
    () =>
      (att?.subjects ?? []).map((s) => ({
        subjectTitle: s.subject,
        studentCount: s.students,
        presentCount: s.present,
        totalCount: s.scheduled,
        pct: s.pct,
        presentRecordCount: s.present,
        totalRecordCount: s.scheduled,
        recordPct: s.pct,
      })),
    [att],
  );

  /* ---- deep links carry the same filters ---- */

  const scopeParams = (over: { campuses?: string[]; sections?: string[] } = {}) => {
    const p = new URLSearchParams();
    const c = over.campuses ?? campuses;
    const s = over.sections ?? sections;
    if (c.length) p.set("campuses", c.join("||"));
    if (semesters.length) p.set("semesters", semesters.join("||"));
    if (s.length) p.set("sections", s.join("||"));
    if (subjects.length) p.set("subjects", subjectKey);
    return p;
  };
  const attendanceHref = (group?: string, over?: { campuses?: string[]; sections?: string[] }) => {
    const p = scopeParams(over);
    if (group) p.set("group", group);
    if (dateWindow) {
      p.set("scope", "range");
      p.set("dateFrom", dateWindow.dateFrom);
      p.set("dateTo", dateWindow.dateTo);
    }
    return `/dashboard/attendance-stats?${p.toString()}`;
  };
  const spiHref = (group?: string) => {
    const p = scopeParams();
    if (group) p.set("group", group);
    for (const [k, v] of spiParams) p.set(k, v);
    return `/dashboard/spi-record?${p.toString()}`;
  };
  const studentsHref = () => {
    const p = scopeParams();
    for (const [k, v] of spiParams) if (k !== "attRange" || v !== "semester_to_date") p.set(k, v);
    const qs = p.toString();
    return qs ? `/dashboard/students?${qs}` : "/dashboard/students";
  };
  const assessmentsHref = () => `/dashboard/assessments?${scopeParams().toString()}`;

  const leaderLink = (row: LeaderRow) => {
    if (grain === "subject") return attendanceHref("university_subject");
    if (grain === "section" && row.campus && row.section) {
      return attendanceHref("university_student", { campuses: [row.campus], sections: [`${row.campus}\t${row.section}`] });
    }
    return attendanceHref("university_section", { campuses: row.campus ? [row.campus] : [] });
  };

  const exportLeaders = (rows: LeaderRow[]) => {
    const heading = grain === "campus" ? "Campus" : grain === "section" ? "Section" : "Subject";
    const headers = grain === "section"
      ? ["Campus", heading, "Students", "Attendance %", "Below 60%", "Avg SPI", "Skill debt", "Quiz completion %"]
      : grain === "campus"
        ? [heading, "Students", "Attendance %", "Below 60%", "Avg SPI", "Skill debt", "Quiz completion %"]
        : [heading, "Students", "Attendance %", "Quiz completion %"];
    const body = rows.map((r) => {
      const attendance = r.noSessions ? NO_SESSIONS_LABEL : r.attendancePct ?? "";
      const common = [r.students, attendance, r.belowSixty, r.avgSpi ?? "", r.skillDebt ?? "", r.completionPct ?? ""];
      if (grain === "section") return [r.campus ?? "", r.label, ...common];
      if (grain === "campus") return [r.label, ...common];
      return [r.label, r.students, attendance, r.completionPct ?? ""];
    });
    exportCsv(`overview-${grain}-${iso(new Date())}.csv`, headers, body);
  };

  /* ---- per-source load state: stale while refetching, or failed ---- */

  const attUpdating = attQuery.isPlaceholderData;
  const spiUpdating = spiQuery.isPlaceholderData;
  const trendUpdating = trendQuery.isPlaceholderData;
  const retryAtt = attQuery.isError ? () => void attQuery.refetch() : undefined;
  const retrySpi = spiQuery.isError ? () => void spiQuery.refetch() : undefined;
  const retryAsm = asmQuery.isError ? () => void asmQuery.refetch() : undefined;
  const attTile = { updating: attUpdating, onRetry: retryAtt };
  const spiTile = { updating: spiUpdating, onRetry: retrySpi };

  /* ---- KPI tiles ---- */

  const header = att?.header ?? null;
  const belowSixty = header ? header.atRisk + header.ineligible : null;
  const attDelta = header?.overallPct != null && prevPct != null
    ? { value: Math.round((header.overallPct - prevPct) * 10) / 10, label: prevLabel ?? "previous period" }
    : null;
  const share = (n: number | null, total: number | undefined) =>
    n == null || !total ? "" : ` · ${Math.round((n / total) * 100)}%`;

  const tiles: Record<KpiId, React.ReactNode> = {
    students: (
      <StatTile
        key="students"
        {...attTile}
        label="Students"
        value={header ? header.students.toLocaleString("en-IN") : null}
        hint={header ? `${new Set(att!.byCampus.map((r) => r.university)).size} campuses` : undefined}
        href={attendanceHref()}
      />
    ),
    attendance: (
      <StatTile
        key="attendance"
        {...attTile}
        label="Attendance"
        value={header ? (header.overallPct == null ? "—" : `${header.overallPct.toFixed(1)}%`) : null}
        valueColor={header?.overallPct != null ? pctReadableColor(header.overallPct) : undefined}
        delta={attDelta}
        hint="Present ÷ scheduled · target 80%"
        href={attendanceHref()}
      />
    ),
    eligible: (
      <StatTile
        key="eligible"
        {...attTile}
        label="Eligible ≥80%"
        value={header ? header.eligible.toLocaleString("en-IN") : null}
        hint={header ? `of ${header.students.toLocaleString("en-IN")} students${share(header.eligible, header.students)}` : undefined}
        href={attendanceHref("university_student")}
      />
    ),
    belowSixty: (
      <StatTile
        key="belowSixty"
        {...attTile}
        label="Below 60%"
        value={belowSixty == null ? null : belowSixty.toLocaleString("en-IN")}
        valueColor={belowSixty ? "#b91c1c" : undefined}
        hint={header ? `At risk or ineligible${share(belowSixty, header.students)}` : undefined}
        href={attendanceHref("university_student")}
      />
    ),
    avgSpi: (
      <StatTile
        key="avgSpi"
        {...spiTile}
        label="Avg SPI"
        value={spi ? (spi.summary.avgSpi == null ? "—" : spi.summary.avgSpi.toFixed(1)) : null}
        hint={spi ? `0–10 · ${spi.summary.students.toLocaleString("en-IN")} evaluated` : undefined}
        href={spiHref()}
      />
    ),
    skillDebt: (
      <StatTile
        key="skillDebt"
        {...spiTile}
        label="Skill debt"
        value={spi ? spi.summary.skillDebt.toLocaleString("en-IN") : null}
        valueColor={spi?.summary.skillDebt ? "#b91c1c" : undefined}
        hint={spi ? `students${share(spi.summary.skillDebt, spi.summary.students)}` : undefined}
        href={spiHref("student")}
      />
    ),
    completion: (
      <StatTile
        key="completion"
        onRetry={retryAsm}
        label="Quiz completion"
        value={asm ? `${asm.header.completionPct.toFixed(1)}%` : null}
        hint="Classroom + module · all dates, not period-filtered"
        href={assessmentsHref()}
      />
    ),
  };

  const failed = attQuery.isError && spiQuery.isError && asmQuery.isError;
  const loadingAtt = attQuery.isLoading || attQuery.isFetching;
  const tileCols = layout.kpis.length >= 7 ? "md:grid-cols-4 xl:grid-cols-7" : "md:grid-cols-4";
  const pLabel = periodLabel(period, dateWindow);
  const headerHasRequests = quickActions(role, range, "").some((a) => a.href === "/dashboard/requests");
  const rangeMessage = customPending
    ? rangeReversed
      ? {
          tone: "error" as const,
          text: "Start date is after end date. Showing this semester so far.",
          onSwap: () => writeQuery({ attFrom: to, attTo: from }),
        }
      : { tone: "hint" as const, text: "Pick both dates to apply the range. Showing this semester so far." }
    : null;
  const scopeText = campuses.length === 0 ? "All campuses in your scope" : campuses.length === 1 ? campuses[0] : `${campuses.length} campuses`;

  return (
    <div className="flex min-w-0 flex-col">
      <DashboardHeader
        role={role}
        name={user?.name ?? "—"}
        theme={theme}
        meta={pLabel}
        unreadRequests={unreadRequests}
        range={range}
        studentsHref={studentsHref()}
      />

      <OverviewFilterBar
        showCampus={!lockedCampus}
        campuses={campuses}
        campusOptions={campusOptions}
        onCampuses={(next) => writeQuery({ campuses: next.join("||") || undefined, sections: undefined })}
        semesters={semesters}
        semesterOptions={semesterOptions}
        onSemesters={(next) => writeQuery({ semesters: next.join("||") || undefined, sections: undefined })}
        sections={sections}
        sectionChoices={sectionChoices}
        onSections={(next) => writeQuery({ sections: next.join("||") || undefined })}
        subjects={subjects}
        subjectOptions={subjectOptions}
        onSubjects={(next) => writeQuery({ subjects: next.join("||") || undefined })}
        period={period}
        from={from}
        to={to}
        onPeriod={(patch) =>
          writeQuery({
            attRange: patch.period !== undefined ? (patch.period === "semester_to_date" ? undefined : patch.period) : query.get("attRange") || undefined,
            attFrom: patch.from !== undefined ? patch.from : from || undefined,
            attTo: patch.to !== undefined ? patch.to : to || undefined,
          })
        }
        onClear={() => setLocation("/dashboard")}
        updating={attUpdating || spiUpdating || trendUpdating}
        rangeMessage={rangeMessage}
      />

      {failed ? (
        <ErrorState
          message="Failed to load the overview."
          onRetry={() => {
            attQuery.refetch();
            spiQuery.refetch();
            asmQuery.refetch();
          }}
        />
      ) : (
        <div className="space-y-6 pt-4">
          <div className={`grid grid-cols-2 gap-px border-y border-slate-200 bg-slate-200 ${tileCols}`}>
            {layout.kpis.map((id) => tiles[id])}
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            <Section title="Key insights" subtitle={`${scopeText} · ${pLabel}`} updating={attUpdating || spiUpdating}>
              {retryAtt ? (
                <SectionError what="attendance insights" onRetry={retryAtt} />
              ) : (
                <InsightsList insights={insights} loading={loadingAtt || spiQuery.isLoading} />
              )}
            </Section>
            <Section
              title="Attendance trend"
              subtitle="Weekly present ÷ scheduled"
              className="lg:col-span-2"
              action={<SectionLink href={attendanceHref()} />}
              updating={trendUpdating}
            >
              {trendQuery.isError ? (
                <SectionError what="the attendance trend" onRetry={() => void trendQuery.refetch()} />
              ) : (
                <div className="p-5">
                  <AttendanceTrend points={trendQuery.data?.points ?? null} loading={trendQuery.isLoading} />
                </div>
              )}
            </Section>
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            <Section
              title="Attendance tiers"
              subtitle="Students by overall attendance"
              action={<SectionLink href={attendanceHref("university_student")} />}
              updating={attUpdating}
            >
              {retryAtt ? <SectionError what="attendance" onRetry={retryAtt} /> : <div className="p-5"><TierBar header={header} /></div>}
            </Section>
            <Section title="Skill levels" subtitle="SPI skill level split" action={<SectionLink href={spiHref()} />} updating={spiUpdating}>
              {retrySpi ? <SectionError what="SPI data" onRetry={retrySpi} /> : <div className="p-5"><SkillSplit summary={spi?.summary ?? null} /></div>}
            </Section>
            <Section title="Quiz completion" subtitle="Classroom vs module" action={<SectionLink href={assessmentsHref()} />}>
              {retryAsm ? <SectionError what="quiz data" onRetry={retryAsm} /> : <div className="p-5"><CompletionBars counts={asm?.header ?? null} /></div>}
            </Section>
          </div>

          <Section
            title={grain === "campus" ? "Campus comparison" : grain === "section" ? "Section comparison" : "Subject comparison"}
            subtitle="Sorted by attendance, lowest first · click a column to sort, a name to drill in"
            updating={attUpdating || spiUpdating}
          >
            {retryAtt ? (
              <SectionError what="attendance" onRetry={retryAtt} />
            ) : (
              <>
                {retrySpi && grain !== "subject" && (
                  <SourceNote text="SPI data couldn't load, so the SPI and skill debt columns show —." onRetry={retrySpi} />
                )}
                {retryAsm && <SourceNote text="Quiz data couldn't load, so quiz completion shows —." onRetry={retryAsm} />}
                <Leaderboard rows={leaders} grain={grain} loading={loadingAtt} linkFor={leaderLink} onExport={exportLeaders} />
              </>
            )}
          </Section>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
            <Section
              title="Attendance by subject"
              subtitle="Lowest first"
              className="lg:col-span-3"
              action={<SectionLink href={attendanceHref("university_subject")} />}
              updating={attUpdating}
            >
              {retryAtt ? (
                <SectionError what="attendance by subject" onRetry={retryAtt} />
              ) : (
                <div className="p-5">
                  {att ? <AttendanceBySubject subjects={subjectBars} height={300} /> : <div className="h-[300px]" />}
                </div>
              )}
            </Section>
            <Section
              title="Students needing attention"
              subtitle="Below 60% attendance or in skill debt"
              className="lg:col-span-2"
              action={<SectionLink href={attendanceHref("university_student")} label="All students" />}
              updating={attUpdating || spiUpdating}
            >
              {retryAtt ? (
                <SectionError what="attendance" onRetry={retryAtt} />
              ) : (
                <>
                  {retrySpi && <SourceNote text="SPI data couldn't load, so students in skill debt are not flagged." onRetry={retrySpi} />}
                  <WatchList
                    rows={watch.rows}
                    total={watch.total}
                    loading={loadingAtt}
                    spiPaths={{ ...(attQuery.data?.spiPaths ?? {}), ...(spiQuery.data?.spiPaths ?? {}) }}
                  />
                </>
              )}
            </Section>
          </div>

          {/* Only when the header has no Request Inbox button (superadmin), so the prompt is not shown twice. */}
          {canSeeRequests && !headerHasRequests && <RequestsCta unread={unreadRequests} />}
        </div>
      )}
    </div>
  );
}
