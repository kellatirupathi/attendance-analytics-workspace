/* ------------------------------------------------------------------ */
/*  Dashboard building blocks — shared, typed, role-agnostic.          */
/*  Every role dashboard is composed from these primitives so the      */
/*  look-and-feel stays consistent while each layout stays distinct.   */
/* ------------------------------------------------------------------ */
import React from "react";
import { Link } from "wouter";
import type { SubjectSummary } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { getTier } from "@/lib/attendanceTiers";
import {
  BarChart as RechartsBarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Cell,
} from "recharts";
import { AlertTriangle, Building2, ChevronRight } from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Small helpers                                                      */
/* ------------------------------------------------------------------ */

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

export function pctOf(count: number, total: number): number {
  return total > 0 ? Math.round((count / total) * 100) : 0;
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

/* ------------------------------------------------------------------ */
/*  Attendance by subject (bar chart)                                  */
/* ------------------------------------------------------------------ */

function SubjectTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const h = getTier(d.pct);
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
    .map((s) => {
      const subjectTitle =
        typeof s.subjectTitle === "string" && s.subjectTitle.trim()
          ? s.subjectTitle.trim()
          : "Unassigned subject";
      return {
        fullName: subjectTitle,
        name:
          subjectTitle.length > 16
            ? subjectTitle.slice(0, 15) + "…"
            : subjectTitle,
        pct: s.pct,
        fill: getTier(s.pct).color,
      };
    });

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
            tick={{ fontSize: 12, fill: "#64748b" }}
            tickLine={false}
            axisLine={{ stroke: "#e5e7eb" }}
            interval={0}
            angle={-35}
            textAnchor="end"
            height={70}
          />
          <YAxis
            tick={{ fontSize: 12, fill: "#64748b" }}
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
