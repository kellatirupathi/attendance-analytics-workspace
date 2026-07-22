import React from "react";
import { Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import {
  useGetDashboardSummary,
  getGetDashboardSummaryQueryKey,
  useGetDashboardStudents,
  getGetDashboardStudentsQueryKey,
} from "@workspace/api-client-react";
import type { DashboardSummary } from "@workspace/api-client-react";
import { CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { pctColor, pctTextColor } from "@/lib/utils";
import { roleLabel } from "@/lib/roleLabels";
import {
  Panel,
  PanelHead,
  ViewAllLink,
  KpiCard,
  AttendanceBySubject,
  SubjectHealthDonut,
  NeedsAttentionList,
  CampusLeaderboard,
  SectionsToWatch,
  SubjectPerformanceList,
  AcademicPerformance,
  aggregateAcademics,
  healthMeta,
  type AcademicAggregate,
} from "@/components/dashboard/blocks";
import {
  Users,
  Building2,
  UserCog,
  Database,
  Bell,
  GraduationCap,
  BookOpenCheck,
  Layers,
  AlertTriangle,
  ShieldCheck,
  TrendingUp,
  ArrowRight,
  Sparkles,
  ClipboardCheck,
  Compass,
} from "lucide-react";

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

interface QuickAction {
  label: string;
  href: string;
  icon: React.ElementType;
  primary?: boolean;
}

interface RoleTheme {
  eyebrow: string;
  title: string;
  subtitle: string;
  /** hero gradient endpoints */
  from: string;
  to: string;
  /** roles that show classroom/module academic data */
  academics: boolean;
}

interface DashCtx {
  summary: DashboardSummary;
  academics: AcademicAggregate | null;
  academicsLoading: boolean;
  updated: string | null;
}

/* ------------------------------------------------------------------ */
/*  Per-role identity (hero copy + accent + quick actions)             */
/* ------------------------------------------------------------------ */

const ROLE_THEME: Record<Role, RoleTheme> = {
  superadmin: {
    eyebrow: "Command Center",
    title: "System Overview",
    subtitle:
      "Full visibility across every campus, subject, and assessment on the platform.",
    from: "#0f172a",
    to: "#4338ca",
    academics: true,
  },
  admin: {
    eyebrow: "Operations Console",
    title: "Attendance & Access",
    subtitle:
      "Monitor performance across all campuses and manage platform access.",
    from: "#1e293b",
    to: "#0e7490",
    academics: true,
  },
  hod: {
    eyebrow: "Department Health",
    title: "Academic Overview",
    subtitle:
      "Attendance and academic performance across every subject in the department.",
    from: "#312e81",
    to: "#6d28d9",
    academics: true,
  },
  capability_manager: {
    eyebrow: "Subject Command",
    title: "Subject Performance",
    subtitle: "Attendance and quiz performance for the subjects you manage.",
    from: "#134e4a",
    to: "#0f766e",
    academics: true,
  },
  boa: {
    eyebrow: "Campus Operations",
    title: "Campus Overview",
    subtitle:
      "Attendance health and correction requests for your assigned campuses.",
    from: "#7c2d12",
    to: "#ea580c",
    academics: false,
  },
  instructor: {
    eyebrow: "My Classes",
    title: "Class Overview",
    subtitle: "Attendance and performance for the students you teach.",
    from: "#14532d",
    to: "#16a34a",
    academics: true,
  },
};

function quickActions(role: Role): QuickAction[] {
  const students: QuickAction = {
    label: "Students",
    href: "/dashboard/students",
    icon: Users,
    primary: true,
  };
  const campuses: QuickAction = {
    label: "Campuses",
    href: "/dashboard/campuses",
    icon: Building2,
  };
  const requests: QuickAction = {
    label: "Attendance Requests",
    href: "/dashboard/requests",
    icon: Bell,
  };
  const manageUsers: QuickAction = {
    label: "Manage Users",
    href: "/admin/users",
    icon: UserCog,
  };
  const manageCampuses: QuickAction = {
    label: "Manage Campuses",
    href: "/admin/campuses",
    icon: Building2,
  };
  const bigquery: QuickAction = {
    label: "BigQuery",
    href: "/dashboard/bigquery",
    icon: Database,
  };

  switch (role) {
    case "superadmin":
      return [students, manageUsers, campuses, bigquery];
    case "admin":
      return [students, manageUsers, manageCampuses, requests];
    case "hod":
      return [students, campuses];
    case "capability_manager":
      return [students, campuses];
    case "boa":
      return [{ ...requests, primary: true }, students, campuses];
    case "instructor":
      return [students];
    default:
      return [students];
  }
}

/* ------------------------------------------------------------------ */
/*  Hero band                                                          */
/* ------------------------------------------------------------------ */

function Hero({
  role,
  name,
  theme,
  updated,
}: {
  role: Role;
  name: string;
  theme: RoleTheme;
  updated: string | null;
}) {
  const actions = quickActions(role);
  return (
    <div
      className="relative overflow-hidden rounded-xl border border-black/10 px-6 py-6 text-white shadow-[0_4px_14px_rgba(15,23,42,0.18)] sm:px-8 sm:py-7"
      style={{
        backgroundImage: `linear-gradient(135deg, ${theme.from} 0%, ${theme.to} 100%)`,
      }}
    >
      <div className="pointer-events-none absolute -right-20 -top-20 h-48 w-48 rounded-full bg-white/[0.07]" />
      <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide">
              <ShieldCheck className="h-3 w-3" />
              {roleLabel(role)}
            </span>
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/80">
              {theme.eyebrow}
            </span>
          </div>
          <h1 className="mt-2.5 truncate font-serif text-2xl font-semibold tracking-tight sm:text-[28px]">
            {theme.title}
          </h1>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-white/85">
            {theme.subtitle}
          </p>
          <p className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-white/75">
            <span className="inline-flex items-center gap-1.5">
              <Compass className="h-3.5 w-3.5" />
              Signed in as {name}
            </span>
            {updated && (
              <span className="inline-flex items-center gap-1.5">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-300 opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-300" />
                </span>
                Updated {updated}
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {actions.map((a) => (
            <Link key={a.href} href={a.href}>
              <div
                className={
                  a.primary
                    ? "inline-flex cursor-pointer items-center gap-2 rounded-lg bg-white px-3.5 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-black/5 transition-colors hover:bg-gray-50"
                    : "inline-flex cursor-pointer items-center gap-2 rounded-lg border border-white/30 bg-white/10 px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/20"
                }
              >
                <a.icon className="h-4 w-4" />
                {a.label}
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  KPI presets                                                        */
/* ------------------------------------------------------------------ */

function AttendanceKpi({ pct }: { pct: number }) {
  const h = healthMeta(pct);
  return (
    <KpiCard
      label="Avg Attendance"
      value={
        <span className="flex items-baseline gap-2">
          <span style={{ color: pctTextColor(pct) }}>{pct}%</span>
          <span
            className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
            style={{ background: `${h.color}14`, color: h.color }}
          >
            <TrendingUp className="h-2.5 w-2.5" />
            {h.label}
          </span>
        </span>
      }
      icon={BookOpenCheck}
      tint={`${h.color}14`}
      accent={h.color}
      footer={
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span>Target ≥ 80%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.min(100, pct)}%`,
                background: pctColor(pct),
              }}
            />
          </div>
        </div>
      }
    />
  );
}

function ScoreKpi({
  label,
  avg,
  icon: Icon,
  tint,
  accent,
}: {
  label: string;
  avg: number | null;
  icon: React.ElementType;
  tint: string;
  accent: string;
}) {
  return (
    <KpiCard
      label={label}
      value={
        avg !== null ? (
          <span style={{ color: pctTextColor(avg) }}>{avg}%</span>
        ) : (
          <span className="text-gray-300">—</span>
        )
      }
      icon={Icon}
      tint={tint}
      accent={accent}
      footer={<span>Average best-attempt score</span>}
    />
  );
}

function StudentsKpi({ summary }: { summary: DashboardSummary }) {
  return (
    <KpiCard
      label="Total Students"
      value={summary.totalStudents.toLocaleString()}
      icon={GraduationCap}
      tint="#eff6ff"
      accent="#2563eb"
      footer={
        <span className="inline-flex items-center gap-1.5">
          <Building2 className="h-3.5 w-3.5 text-gray-400" />
          Across {summary.totalCampuses} campuses
        </span>
      }
    />
  );
}

function CampusesKpi({ summary }: { summary: DashboardSummary }) {
  return (
    <KpiCard
      label="Campuses"
      value={summary.totalCampuses}
      icon={Building2}
      tint="#f5f3ff"
      accent="#7c3aed"
      footer={
        <span className="inline-flex items-center gap-1.5">
          <Layers className="h-3.5 w-3.5 text-gray-400" />
          {summary.sectionBreakdown.length} sections tracked
        </span>
      }
    />
  );
}

function BelowTargetKpi({ summary }: { summary: DashboardSummary }) {
  const bad = summary.subjectsBelow80 > 0;
  const total = summary.subjectBreakdown.length || 1;
  return (
    <KpiCard
      label="Subjects Below 80%"
      value={
        <span style={{ color: bad ? "#dc2626" : "#16a34a" }}>
          {summary.subjectsBelow80}
        </span>
      }
      icon={AlertTriangle}
      tint={bad ? "#fef2f2" : "#f0fdf4"}
      accent={bad ? "#dc2626" : "#16a34a"}
      footer={<span>of {total} subjects need recovery</span>}
    />
  );
}

function SectionsKpi({ summary }: { summary: DashboardSummary }) {
  return (
    <KpiCard
      label="Sections Tracked"
      value={summary.sectionBreakdown.length}
      icon={Layers}
      tint="#fffbeb"
      accent="#d97706"
      footer={
        <span className="inline-flex items-center gap-1.5">
          <GraduationCap className="h-3.5 w-3.5 text-gray-400" />
          {summary.totalStudents.toLocaleString()} students
        </span>
      }
    />
  );
}

function SubjectsKpi({ summary }: { summary: DashboardSummary }) {
  return (
    <KpiCard
      label="Subjects Tracked"
      value={summary.subjectBreakdown.length}
      icon={BookOpenCheck}
      tint="#eef2ff"
      accent="#4f46e5"
      footer={
        <span className="inline-flex items-center gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5 text-gray-400" />
          {summary.subjectsBelow80} below target
        </span>
      }
    />
  );
}

/* ------------------------------------------------------------------ */
/*  Shared full-width panels                                           */
/* ------------------------------------------------------------------ */

function AcademicPanel({ ctx }: { ctx: DashCtx }) {
  return (
    <Panel>
      <PanelHead
        title="Academic Performance"
        subtitle="Classroom & module quiz averages across your scope"
        icon={Sparkles}
        tint="#eff6ff"
        accent="#2563eb"
        action={<ViewAllLink href="/dashboard/students" label="By student" />}
      />
      <AcademicPerformance
        data={ctx.academics}
        loading={ctx.academicsLoading}
      />
    </Panel>
  );
}

function SubjectChartPanel({
  summary,
  span,
}: {
  summary: DashboardSummary;
  span?: boolean;
}) {
  return (
    <Panel className={span ? "lg:col-span-2" : undefined}>
      <PanelHead
        title="Attendance by Subject"
        subtitle="Sorted from lowest to highest attendance"
        icon={BookOpenCheck}
        tint="#fff3ea"
        accent="#F25C05"
      />
      <CardContent className="p-5">
        <AttendanceBySubject subjects={summary.subjectBreakdown} />
      </CardContent>
    </Panel>
  );
}

function HealthPanel({ summary }: { summary: DashboardSummary }) {
  return (
    <Panel>
      <PanelHead
        title="Subject Health"
        subtitle="Distribution overview"
        icon={Layers}
        tint="#f0fdf4"
        accent="#16a34a"
      />
      <CardContent className="p-5">
        <SubjectHealthDonut subjects={summary.subjectBreakdown} />
      </CardContent>
    </Panel>
  );
}

function NeedsAttentionPanel({ summary }: { summary: DashboardSummary }) {
  return (
    <Panel>
      <PanelHead
        title="Needs Attention"
        subtitle="Students with the lowest attendance"
        icon={AlertTriangle}
        tint="#fef2f2"
        accent="#dc2626"
        action={<ViewAllLink href="/dashboard/students" />}
      />
      <CardContent className="p-0">
        <NeedsAttentionList students={summary.needsAttention} />
      </CardContent>
    </Panel>
  );
}

function CampusPanel({ summary }: { summary: DashboardSummary }) {
  return (
    <Panel>
      <PanelHead
        title="Campus Breakdown"
        subtitle="Ranked by attendance performance"
        icon={Building2}
        tint="#f5f3ff"
        accent="#7c3aed"
        action={<ViewAllLink href="/dashboard/campuses" label="Details" />}
      />
      <CardContent className="p-0">
        <CampusLeaderboard campuses={summary.campusBreakdown} />
      </CardContent>
    </Panel>
  );
}

function SubjectListPanel({ summary }: { summary: DashboardSummary }) {
  return (
    <Panel>
      <PanelHead
        title="Subject Performance"
        subtitle="Attendance per subject, lowest first"
        icon={BookOpenCheck}
        tint="#eef2ff"
        accent="#4f46e5"
      />
      <CardContent className="p-0">
        <SubjectPerformanceList subjects={summary.subjectBreakdown} />
      </CardContent>
    </Panel>
  );
}

function SectionsPanel({ summary }: { summary: DashboardSummary }) {
  if (summary.sectionBreakdown.length === 0) return null;
  return (
    <Panel>
      <PanelHead
        title="Sections to Watch"
        subtitle="Lowest attendance sections across your scope"
        icon={Layers}
        tint="#fffbeb"
        accent="#d97706"
        action={
          <Link
            href="/dashboard/campuses"
            className="hidden items-center gap-0.5 text-sm font-semibold text-brand-600 hover:text-brand-700 sm:inline-flex"
          >
            All sections <ArrowRight className="h-4 w-4" />
          </Link>
        }
      />
      <CardContent className="p-5">
        <SectionsToWatch sections={summary.sectionBreakdown} />
      </CardContent>
    </Panel>
  );
}

/* Requests call-to-action (BOA / admin) */
function RequestsCta() {
  return (
    <Panel>
      <CardContent className="flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-brand-50 text-brand-600 ring-1 ring-brand-100">
            <ClipboardCheck className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-semibold text-gray-900">
              Attendance correction requests
            </p>
            <p className="text-xs text-gray-600">
              Review and action student-submitted corrections for your campuses.
            </p>
          </div>
        </div>
        <Link href="/dashboard/requests">
          <div className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700">
            <Bell className="h-4 w-4" />
            Open requests
          </div>
        </Link>
      </CardContent>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/*  Role compositions                                                  */
/* ------------------------------------------------------------------ */

function SuperAdminBody({ ctx }: { ctx: DashCtx }) {
  const s = ctx.summary;
  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StudentsKpi summary={s} />
        <CampusesKpi summary={s} />
        <AttendanceKpi pct={s.avgAttendancePct} />
        <BelowTargetKpi summary={s} />
      </div>
      <AcademicPanel ctx={ctx} />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <SubjectChartPanel summary={s} span />
        <HealthPanel summary={s} />
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <NeedsAttentionPanel summary={s} />
        <CampusPanel summary={s} />
      </div>
      <SectionsPanel summary={s} />
    </>
  );
}

function AdminBody({ ctx }: { ctx: DashCtx }) {
  const s = ctx.summary;
  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StudentsKpi summary={s} />
        <CampusesKpi summary={s} />
        <AttendanceKpi pct={s.avgAttendancePct} />
        <BelowTargetKpi summary={s} />
      </div>
      <RequestsCta />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <CampusPanel summary={s} />
        <HealthPanel summary={s} />
        <NeedsAttentionPanel summary={s} />
      </div>
      <AcademicPanel ctx={ctx} />
      <SectionsPanel summary={s} />
    </>
  );
}

function HodBody({ ctx }: { ctx: DashCtx }) {
  const s = ctx.summary;
  const a = ctx.academics;
  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <AttendanceKpi pct={s.avgAttendancePct} />
        <ScoreKpi
          label="Classroom Avg"
          avg={a?.classroomAvg ?? null}
          icon={BookOpenCheck}
          tint="#eff6ff"
          accent="#2563eb"
        />
        <ScoreKpi
          label="Module Avg"
          avg={a?.moduleAvg ?? null}
          icon={Layers}
          tint="#f5f3ff"
          accent="#7c3aed"
        />
        <BelowTargetKpi summary={s} />
      </div>
      <AcademicPanel ctx={ctx} />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <SubjectChartPanel summary={s} span />
        <HealthPanel summary={s} />
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <SubjectListPanel summary={s} />
        <NeedsAttentionPanel summary={s} />
      </div>
    </>
  );
}

function CapabilityManagerBody({ ctx }: { ctx: DashCtx }) {
  const s = ctx.summary;
  const a = ctx.academics;
  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SubjectsKpi summary={s} />
        <AttendanceKpi pct={s.avgAttendancePct} />
        <ScoreKpi
          label="Classroom Avg"
          avg={a?.classroomAvg ?? null}
          icon={BookOpenCheck}
          tint="#eff6ff"
          accent="#2563eb"
        />
        <ScoreKpi
          label="Module Avg"
          avg={a?.moduleAvg ?? null}
          icon={Layers}
          tint="#f5f3ff"
          accent="#7c3aed"
        />
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <SubjectChartPanel summary={s} span />
        <HealthPanel summary={s} />
      </div>
      <AcademicPanel ctx={ctx} />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <SubjectListPanel summary={s} />
        <NeedsAttentionPanel summary={s} />
      </div>
      <SectionsPanel summary={s} />
    </>
  );
}

function BoaBody({ ctx }: { ctx: DashCtx }) {
  const s = ctx.summary;
  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StudentsKpi summary={s} />
        <SectionsKpi summary={s} />
        <AttendanceKpi pct={s.avgAttendancePct} />
        <BelowTargetKpi summary={s} />
      </div>
      <RequestsCta />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <CampusPanel summary={s} />
        <HealthPanel summary={s} />
        <NeedsAttentionPanel summary={s} />
      </div>
      <SectionsPanel summary={s} />
    </>
  );
}

function InstructorBody({ ctx }: { ctx: DashCtx }) {
  const s = ctx.summary;
  const a = ctx.academics;
  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StudentsKpi summary={s} />
        <AttendanceKpi pct={s.avgAttendancePct} />
        <ScoreKpi
          label="Class Quiz Avg"
          avg={a?.classroomAvg ?? null}
          icon={BookOpenCheck}
          tint="#eff6ff"
          accent="#2563eb"
        />
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <NeedsAttentionPanel summary={s} />
        </div>
        <div className="lg:col-span-2">
          <HealthPanel summary={s} />
        </div>
      </div>
      <SubjectListPanel summary={s} />
    </>
  );
}

function renderBody(role: Role, ctx: DashCtx): React.ReactNode {
  switch (role) {
    case "superadmin":
      return <SuperAdminBody ctx={ctx} />;
    case "admin":
      return <AdminBody ctx={ctx} />;
    case "hod":
      return <HodBody ctx={ctx} />;
    case "capability_manager":
      return <CapabilityManagerBody ctx={ctx} />;
    case "boa":
      return <BoaBody ctx={ctx} />;
    case "instructor":
      return <InstructorBody ctx={ctx} />;
    default:
      return <SuperAdminBody ctx={ctx} />;
  }
}

/* ------------------------------------------------------------------ */
/*  Loading skeleton                                                   */
/* ------------------------------------------------------------------ */

function LoadingState() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-36 w-full rounded-2xl" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-32 rounded-xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Skeleton className="h-96 rounded-xl lg:col-span-2" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Dashboard (role dispatcher)                                        */
/* ------------------------------------------------------------------ */

const ACADEMIC_LIMIT = 5000;

export default function Dashboard() {
  const { user } = useAuth();
  const role = (user?.role as Role) ?? "instructor";
  const theme = ROLE_THEME[role] ?? ROLE_THEME.instructor;

  const { data: summary, isLoading } = useGetDashboardSummary({
    query: { queryKey: getGetDashboardSummaryQueryKey() },
  });

  const { data: students, isLoading: studentsLoading } =
    useGetDashboardStudents(
      { limit: ACADEMIC_LIMIT },
      {
        query: {
          enabled: theme.academics,
          queryKey: getGetDashboardStudentsQueryKey({ limit: ACADEMIC_LIMIT }),
        },
      },
    );

  const academics = React.useMemo<AcademicAggregate | null>(
    () => (students ? aggregateAcademics(students) : null),
    [students],
  );

  if (isLoading) return <LoadingState />;
  if (!summary) return null;

  const updated =
    summary.updatedAt != null
      ? new Date(summary.updatedAt).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })
      : null;

  const ctx: DashCtx = {
    summary,
    academics,
    academicsLoading: theme.academics && studentsLoading,
    updated,
  };

  return (
    <div className="space-y-6">
      <Hero
        role={role}
        name={user?.name ?? "—"}
        theme={theme}
        updated={updated}
      />
      {renderBody(role, ctx)}
    </div>
  );
}
