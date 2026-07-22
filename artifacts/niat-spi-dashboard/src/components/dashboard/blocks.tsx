/* ------------------------------------------------------------------ */
/*  Dashboard building blocks — shared, typed, role-agnostic.          */
/*  Every role dashboard is composed from these primitives so the      */
/*  look-and-feel stays consistent while each layout stays distinct.   */
/* ------------------------------------------------------------------ */
import React from "react";
import { Link } from "wouter";
import type {
  DashboardStudent,
  StudentSearchResult,
  SubjectSummary,
  CampusSummaryItem,
  SectionSummaryItem,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn, pctColor, pctTextColor } from "@/lib/utils";
import {
  BarChart as RechartsBarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import {
  AlertTriangle,
  Building2,
  ChevronRight,
  Layers,
  ShieldCheck,
  BookOpenCheck,
  GraduationCap,
  Sparkles,
  Lock,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Small helpers                                                      */
/* ------------------------------------------------------------------ */

export function healthMeta(pct: number): { label: string; color: string } {
  if (pct >= 80) return { label: "Healthy", color: "#16a34a" };
  if (pct >= 65) return { label: "Warning", color: "#d97706" };
  return { label: "Critical", color: "#dc2626" };
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

export function pctOf(count: number, total: number): number {
  return total > 0 ? Math.round((count / total) * 100) : 0;
}

/* ------------------------------------------------------------------ */
/*  Academic aggregation — real classroom + module quiz numbers        */
/*  derived from the (already role-scoped) student list.               */
/* ------------------------------------------------------------------ */

export interface AcademicAggregate {
  classroomAvg: number | null;
  moduleAvg: number | null;
  classroomCovered: number;
  moduleCovered: number;
  totalStudents: number;
  classroomBuckets: { label: string; count: number; color: string }[];
}

function bucketOf(pct: number): 0 | 1 | 2 {
  if (pct >= 80) return 0;
  if (pct >= 65) return 1;
  return 2;
}

export function aggregateAcademics(
  students: DashboardStudent[],
): AcademicAggregate {
  let cSum = 0;
  let cCount = 0;
  let mSum = 0;
  let mCount = 0;
  const bucketCounts = [0, 0, 0];
  for (const s of students) {
    if (s.classroomAvg !== null && s.classroomAvg !== undefined) {
      cSum += s.classroomAvg;
      cCount += 1;
      bucketCounts[bucketOf(s.classroomAvg)]++;
    }
    if (s.moduleAvg !== null && s.moduleAvg !== undefined) {
      mSum += s.moduleAvg;
      mCount += 1;
    }
  }
  const round1 = (n: number) => Math.round(n * 10) / 10;
  return {
    classroomAvg: cCount > 0 ? round1(cSum / cCount) : null,
    moduleAvg: mCount > 0 ? round1(mSum / mCount) : null,
    classroomCovered: cCount,
    moduleCovered: mCount,
    totalStudents: students.length,
    classroomBuckets: [
      { label: "≥ 80%", count: bucketCounts[0]!, color: "#16a34a" },
      { label: "65–79%", count: bucketCounts[1]!, color: "#d97706" },
      { label: "< 65%", count: bucketCounts[2]!, color: "#dc2626" },
    ],
  };
}

/* ------------------------------------------------------------------ */
/*  Panel + section head                                               */
/* ------------------------------------------------------------------ */

export function Panel({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className={cn("overflow-hidden border-x-0 border-y border-slate-200 bg-white", className)}>
      {children}
    </Card>
  );
}

export function PanelHead({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ElementType;
  tint?: string;
  accent?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-3.5">
      <div>
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function ViewAllLink({
  href,
  label = "View all",
}: {
  href: string;
  label?: string;
}) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-0.5 text-xs font-medium text-brand-600 hover:text-brand-700"
    >
      {label} <ChevronRight className="h-3.5 w-3.5" />
    </Link>
  );
}

export function KpiCard({
  label,
  value,
  footer,
}: {
  label: string;
  value: React.ReactNode;
  icon?: React.ElementType;
  tint?: string;
  accent?: string;
  footer?: React.ReactNode;
}) {
  return (
    <div className="border-x-0 border-y border-slate-200 bg-white px-4 py-4">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <div className="mt-2 text-2xl font-semibold tabular-nums text-slate-900">
        {value}
      </div>
      {footer && (
        <div className="mt-2 text-xs text-slate-500">{footer}</div>
      )}
    </div>
  );
}

export function MiniBar({ pct }: { pct: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-sm bg-slate-200">
      <div
        className="h-full rounded-sm"
        style={{ width: `${Math.min(100, pct)}%`, background: pctColor(pct) }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Attendance by subject (bar chart)                                  */
/* ------------------------------------------------------------------ */

function SubjectTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const h = healthMeta(d.pct);
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-lg">
      <p className="max-w-[240px] text-xs font-semibold text-gray-800">
        {d.fullName}
      </p>
      <p
        className="mt-1 flex items-center gap-1.5 text-sm font-bold"
        style={{ color: h.color }}
      >
        <span
          className="h-2 w-2 rounded-full"
          style={{ background: h.color }}
        />
        {d.pct}% · {h.label}
      </p>
    </div>
  );
}

export function AttendanceBySubject({
  subjects,
  height = 340,
}: {
  subjects: SubjectSummary[];
  height?: number;
}) {
  const data = subjects
    .slice()
    .sort((a, b) => a.pct - b.pct)
    .map((s) => ({
      fullName: s.subjectTitle,
      name:
        s.subjectTitle.length > 16
          ? s.subjectTitle.slice(0, 15) + "…"
          : s.subjectTitle,
      pct: s.pct,
      fill: pctColor(s.pct),
    }));

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <RechartsBarChart
          data={data}
          margin={{ top: 8, right: 8, left: -16, bottom: 64 }}
          barCategoryGap="22%"
        >
          <defs>
            {data.map((entry, i) => (
              <linearGradient
                key={i}
                id={`bar-${i}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop offset="0%" stopColor={entry.fill} stopOpacity={0.9} />
                <stop offset="100%" stopColor={entry.fill} stopOpacity={0.6} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid
            strokeDasharray="3 3"
            vertical={false}
            stroke="#f1f3f5"
          />
          <XAxis
            dataKey="name"
            tick={{ fontSize: 11, fill: "#6b7280" }}
            tickLine={false}
            axisLine={{ stroke: "#e5e7eb" }}
            interval={0}
            angle={-35}
            textAnchor="end"
            height={70}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "#9ca3af" }}
            tickLine={false}
            axisLine={false}
            domain={[0, 100]}
            ticks={[0, 25, 50, 75, 100]}
            tickFormatter={(v: number) => `${v}%`}
          />
          <Tooltip
            cursor={{ fill: "rgba(0,0,0,0.03)" }}
            content={<SubjectTooltip />}
          />
          <Bar dataKey="pct" radius={[5, 5, 0, 0]} maxBarSize={44}>
            {data.map((_, i) => (
              <Cell key={i} fill={`url(#bar-${i})`} />
            ))}
          </Bar>
        </RechartsBarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Subject health donut                                               */
/* ------------------------------------------------------------------ */

export function SubjectHealthDonut({
  subjects,
}: {
  subjects: SubjectSummary[];
}) {
  const healthy = subjects.filter((s) => s.pct >= 80).length;
  const warning = subjects.filter((s) => s.pct >= 65 && s.pct < 80).length;
  const critical = subjects.filter((s) => s.pct < 65).length;

  const data = [
    { name: "Healthy", value: healthy, color: "#16a34a" },
    { name: "Warning", value: warning, color: "#d97706" },
    { name: "Critical", value: critical, color: "#dc2626" },
  ].filter((d) => d.value > 0);

  const segments = [
    { label: "Healthy", count: healthy, color: "#16a34a" },
    { label: "Warning", count: warning, color: "#d97706" },
    { label: "Critical", count: critical, color: "#dc2626" },
  ];

  return (
    <>
      <div className="relative mx-auto h-[188px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={64}
              outerRadius={88}
              paddingAngle={data.length > 1 ? 3 : 0}
              dataKey="value"
              stroke="none"
            >
              {data.map((entry, i) => (
                <Cell key={i} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                borderRadius: 8,
                border: "1px solid #e5e7eb",
                fontSize: 12,
              }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-bold text-gray-900">
            {subjects.length}
          </span>
          <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            subjects
          </span>
        </div>
      </div>
      <div className="mt-4 space-y-1.5">
        {segments.map((seg) => (
          <div
            key={seg.label}
            className="flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-gray-50"
          >
            <div className="flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ background: seg.color }}
              />
              <span className="text-sm text-gray-600">{seg.label}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-gray-900">
                {seg.count}
              </span>
              <span className="w-9 text-right text-xs text-gray-400">
                {pctOf(seg.count, subjects.length)}%
              </span>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Needs attention list                                               */
/* ------------------------------------------------------------------ */

export function NeedsAttentionList({
  students,
}: {
  students: StudentSearchResult[];
}) {
  if (students.length === 0) {
    return (
      <div className="flex flex-col items-center px-5 py-12 text-center">
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50">
          <ShieldCheck className="h-6 w-6 text-emerald-500" />
        </div>
        <p className="text-sm font-semibold text-gray-700">
          All students on track
        </p>
        <p className="mt-1 text-xs text-gray-400">
          No critical attendance alerts right now.
        </p>
      </div>
    );
  }
  return (
    <ul>
      {students.map((student) => {
        const pct = student.attendancePct ?? 0;
        return (
          <li
            key={student.studentId}
            className="flex items-center gap-3 border-b border-gray-200 px-5 py-3 last:border-0 hover:bg-gray-50"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-bold text-gray-600">
              {initials(student.studentName)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-gray-900">
                {student.studentName}
              </p>
              <p className="truncate text-xs text-gray-500">
                {student.instituteName ?? "—"}
              </p>
            </div>
            <div className="w-28 shrink-0">
              <div className="mb-1 flex items-center justify-end">
                <span
                  className="text-sm font-bold"
                  style={{ color: pctTextColor(pct) }}
                >
                  {pct}%
                </span>
              </div>
              <MiniBar pct={pct} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/*  Campus leaderboard                                                 */
/* ------------------------------------------------------------------ */

export function CampusLeaderboard({
  campuses,
}: {
  campuses: CampusSummaryItem[];
}) {
  return (
    <ul>
      {campuses
        .slice()
        .sort((a, b) => b.pct - a.pct)
        .map((campus, i) => (
          <li
            key={i}
            className="flex items-center gap-3 border-b border-gray-200 px-5 py-3 last:border-0 hover:bg-gray-50"
          >
            <span
              className={cn(
                "flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[11px] font-bold",
                i === 0
                  ? "bg-amber-100 text-amber-700"
                  : "bg-gray-100 text-gray-500",
              )}
            >
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-gray-900">
                {campus.instituteName}
              </p>
              <p className="text-xs text-gray-500">
                {campus.studentCount.toLocaleString()} students
              </p>
            </div>
            <div className="flex w-40 shrink-0 items-center gap-3">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.min(100, campus.pct)}%`,
                    background: pctColor(campus.pct),
                  }}
                />
              </div>
              <span
                className="w-11 text-right text-sm font-bold"
                style={{ color: pctTextColor(campus.pct) }}
              >
                {campus.pct}%
              </span>
            </div>
          </li>
        ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/*  Sections to watch                                                  */
/* ------------------------------------------------------------------ */

export function SectionsToWatch({
  sections,
  limit = 6,
}: {
  sections: SectionSummaryItem[];
  limit?: number;
}) {
  const top = sections
    .slice()
    .sort((a, b) => a.pct - b.pct)
    .slice(0, limit);
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {top.map((sec, i) => {
        const h = healthMeta(sec.pct);
        return (
          <div
            key={i}
            className="rounded-lg border border-gray-200 bg-white p-4 transition-shadow hover:shadow-sm"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-gray-900">
                  {sec.sectionName}
                </p>
                <p className="truncate text-xs text-gray-500">
                  {sec.instituteName}
                </p>
              </div>
              <span
                className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
                style={{ background: `${h.color}14`, color: h.color }}
              >
                {h.label}
              </span>
            </div>
            <div className="mt-4 flex items-end justify-between">
              <span className="text-xs text-gray-500">
                {sec.studentCount} students
              </span>
              <span
                className="text-xl font-bold leading-none"
                style={{ color: pctTextColor(sec.pct) }}
              >
                {sec.pct}%
              </span>
            </div>
            <div className="mt-2.5">
              <MiniBar pct={sec.pct} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Subject performance table (attendance + academic in one place)     */
/* ------------------------------------------------------------------ */

export function SubjectPerformanceList({
  subjects,
}: {
  subjects: SubjectSummary[];
}) {
  const rows = subjects.slice().sort((a, b) => a.pct - b.pct);
  return (
    <ul>
      {rows.map((s, i) => (
        <li
          key={i}
          className="flex items-center gap-3 border-b border-gray-200 px-5 py-3 last:border-0 hover:bg-gray-50"
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-gray-900">
              {s.subjectTitle}
            </p>
            <p className="text-xs text-gray-500">
              {s.studentCount.toLocaleString()} students ·{" "}
              {s.presentCount.toLocaleString()}/{s.totalCount.toLocaleString()}{" "}
              sessions
            </p>
          </div>
          <div className="flex w-44 shrink-0 items-center gap-3">
            <div className="flex-1">
              <MiniBar pct={s.pct} />
            </div>
            <span
              className="w-11 text-right text-sm font-bold"
              style={{ color: pctTextColor(s.pct) }}
            >
              {s.pct}%
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/*  Academic performance — classroom + module quizzes + assessments    */
/* ------------------------------------------------------------------ */

function QuizGauge({
  label,
  avg,
  covered,
  total,
}: {
  label: string;
  avg: number | null;
  covered: number;
  total: number;
  icon?: React.ElementType;
  accent?: string;
  tint?: string;
}) {
  const coverage = pctOf(covered, total);
  return (
    <div className="rounded-md border border-slate-200 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <div className="mt-2 flex items-end gap-1">
        {avg !== null ? (
          <span
            className="text-2xl font-semibold tabular-nums"
            style={{ color: pctTextColor(avg) }}
          >
            {avg}%
          </span>
        ) : (
          <span className="text-2xl font-semibold text-slate-300">—</span>
        )}
      </div>
      <div className="mt-2">{avg !== null && <MiniBar pct={avg} />}</div>
      <p className="mt-2 text-xs text-slate-500">
        {covered.toLocaleString()} / {total.toLocaleString()} students ·{" "}
        {coverage}% covered
      </p>
    </div>
  );
}

export function AcademicPerformance({
  data,
  loading,
}: {
  data: AcademicAggregate | null;
  loading?: boolean;
}) {
  if (loading || !data) {
    return (
      <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-36 animate-pulse rounded-xl bg-gray-100" />
        ))}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
      <QuizGauge
        label="Classroom Quizzes"
        avg={data.classroomAvg}
        covered={data.classroomCovered}
        total={data.totalStudents}
        icon={BookOpenCheck}
        accent="#2563eb"
        tint="#eff6ff"
      />
      <QuizGauge
        label="Module Quizzes"
        avg={data.moduleAvg}
        covered={data.moduleCovered}
        total={data.totalStudents}
        icon={Layers}
        accent="#7c3aed"
        tint="#f5f3ff"
      />
      <AssessmentSoon
        label="Skill Assessments"
        weight="25% of SPI"
        icon={Sparkles}
      />
      <AssessmentSoon
        label="Final Assessment"
        weight="50% of SPI"
        icon={GraduationCap}
      />
    </div>
  );
}

function AssessmentSoon({
  label,
  weight,
  icon: Icon,
}: {
  label: string;
  weight: string;
  icon: React.ElementType;
}) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-4">
      <p className="text-sm font-medium text-slate-700">{label}</p>
      <div className="mt-2 flex items-center gap-1.5 text-slate-400">
        <Lock className="h-3.5 w-3.5 shrink-0" />
        <span className="text-xs">Coming soon</span>
      </div>
      <p className="mt-2 text-xs text-slate-500">{weight}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Empty-scope hint (for narrowly-scoped roles with no data)          */
/* ------------------------------------------------------------------ */

export function EmptyScope({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-200 bg-white px-6 py-16 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
        <AlertTriangle className="h-6 w-6 text-gray-400" />
      </div>
      <p className="text-sm font-semibold text-gray-700">Nothing to show yet</p>
      <p className="mt-1 max-w-sm text-xs text-gray-400">{message}</p>
    </div>
  );
}

/* Re-export commonly used icons so role views import from one place */
export { Building2 };
