/* ------------------------------------------------------------------ */
/*  Overview blocks — filter bar, KPI tiles, health bars, trend,        */
/*  leaderboard, watch list and insights. Data comes pre-aggregated    */
/*  from lib/overviewAggregate.ts.                                     */
/* ------------------------------------------------------------------ */
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { format, parseISO } from "date-fns";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowDown, ArrowUp, ChevronRight, Download, TrendingDown, TrendingUp, AlertTriangle, Info, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { SearchableSelect } from "@/components/SearchableSelect";
import { CheckMenu, Field } from "@/components/SpiRecordFilterBar";
import { ATTENDANCE_TIERS } from "@/lib/attendanceTiers";
import { cn, pctTextColor } from "@/lib/utils";
import type { AttendanceHeader } from "@/lib/attendanceStatsAggregate";
import type { AssessmentCounts } from "@/lib/assessmentAggregate";
import type { LeaderGrain, LeaderRow, SpiOverview, WatchStudent } from "@/lib/overviewAggregate";
import type { Insight } from "@/lib/overviewInsights";

export type OverviewPeriod = "semester_to_date" | "last_30" | "custom";

function fmtInt(n: number | null | undefined): string {
  return n == null ? "—" : n.toLocaleString("en-IN");
}

function fmtPct(n: number | null | undefined): string {
  return n == null ? "—" : `${n.toFixed(1)}%`;
}

/* ------------------------------------------------------------------ */
/*  Filter bar                                                         */
/* ------------------------------------------------------------------ */

export function OverviewFilterBar({
  showCampus,
  campuses,
  campusOptions,
  onCampuses,
  semesters,
  semesterOptions,
  onSemesters,
  sections,
  sectionChoices,
  onSections,
  period,
  from,
  to,
  onPeriod,
  onClear,
}: {
  showCampus: boolean;
  campuses: string[];
  campusOptions: string[];
  onCampuses: (next: string[]) => void;
  semesters: string[];
  semesterOptions: string[];
  onSemesters: (next: string[]) => void;
  sections: string[];
  sectionChoices: { campus: string; section: string }[];
  onSections: (next: string[]) => void;
  period: OverviewPeriod;
  from: string;
  to: string;
  onPeriod: (patch: { period?: OverviewPeriod; from?: string; to?: string }) => void;
  onClear: () => void;
}) {
  const multiCampus = campuses.length !== 1;
  return (
    <div className="flex flex-wrap items-end gap-3 border-y border-slate-200 bg-white px-5 py-3">
      {showCampus && (
        <Field label="Campus">
          <CheckMenu
            label={campuses.length ? `${campuses.length} selected` : "All campuses"}
            options={campusOptions.map((name) => ({ id: name, label: name }))}
            selected={campuses}
            onChange={onCampuses}
          />
        </Field>
      )}
      <Field label="Semester">
        <CheckMenu
          label={semesters.length ? `${semesters.length} selected` : "Current semesters"}
          options={semesterOptions.map((name) => ({ id: name, label: name }))}
          selected={semesters}
          onChange={onSemesters}
        />
      </Field>
      <Field label="Section">
        <CheckMenu
          label={sections.length ? `${sections.length} selected` : campuses.length ? "All sections" : "Select a campus"}
          options={sectionChoices.map((item) => ({
            id: `${item.campus}\t${item.section}`,
            label: multiCampus ? `${item.campus} — ${item.section}` : item.section,
          }))}
          selected={sections}
          onChange={onSections}
        />
      </Field>
      <Field label="Attendance period">
        <div className="flex flex-wrap items-center gap-2">
          <SearchableSelect
            value={period}
            onValueChange={(value) => onPeriod({ period: value as OverviewPeriod })}
            options={[
              { value: "semester_to_date", label: "This semester so far" },
              { value: "last_30", label: "Last 30 days" },
              { value: "custom", label: "Custom range" },
            ]}
            className="w-[200px]"
          />
          {period === "custom" && (
            <>
              <Input type="date" aria-label="Attendance period from" className="h-9 w-[150px]" value={from} onChange={(event) => onPeriod({ from: event.target.value })} />
              <Input type="date" aria-label="Attendance period to" className="h-9 w-[150px]" value={to} onChange={(event) => onPeriod({ to: event.target.value })} />
            </>
          )}
        </div>
      </Field>
      <Button type="button" variant="outline" size="sm" onClick={onClear}>
        Clear
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  KPI tile                                                           */
/* ------------------------------------------------------------------ */

export function StatTile({
  label,
  value,
  hint,
  href,
  delta,
  valueColor,
}: {
  label: string;
  value: string | null;
  hint?: ReactNode;
  href?: string;
  delta?: { value: number; label: string } | null;
  valueColor?: string;
}) {
  const body = (
    <div className={cn("h-full bg-white px-4 py-4", href && "transition-colors hover:bg-slate-50")}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
      {value == null ? (
        <Skeleton className="mt-2 h-8 w-20" />
      ) : (
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-2xl font-semibold tabular-nums text-slate-900" style={valueColor ? { color: valueColor } : undefined}>
            {value}
          </span>
          {delta && Math.abs(delta.value) >= 0.1 && (
            <span
              className={cn(
                "inline-flex items-center gap-0.5 text-xs font-medium",
                delta.value > 0 ? "text-emerald-700" : "text-red-700",
              )}
              title={`vs ${delta.label}`}
            >
              {delta.value > 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
              {Math.abs(delta.value).toFixed(1)} pts
            </span>
          )}
        </div>
      )}
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </div>
  );
  return href ? <Link href={href} className="block h-full">{body}</Link> : body;
}

export function TileGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-px border-y border-slate-200 bg-slate-200 md:grid-cols-4 xl:grid-cols-7">
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Section wrapper                                                    */
/* ------------------------------------------------------------------ */

export function Section({
  title,
  subtitle,
  action,
  className,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn("overflow-hidden border-y border-slate-200 bg-white", className)}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3.5">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function SectionLink({ href, label = "Details" }: { href: string; label?: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-0.5 text-xs font-medium text-brand-600 hover:text-brand-700">
      {label} <ChevronRight className="h-3.5 w-3.5" />
    </Link>
  );
}

/* ------------------------------------------------------------------ */
/*  Stacked share bar (tiers, skill levels)                            */
/* ------------------------------------------------------------------ */

interface ShareSegment {
  id: string;
  label: string;
  hint?: string;
  count: number;
  color: string;
}

function ShareBar({ segments, total }: { segments: ShareSegment[]; total: number }) {
  const share = (count: number) => (total > 0 ? (count / total) * 100 : 0);
  return (
    <div>
      <div className="flex h-3 gap-[2px] overflow-hidden rounded bg-slate-100">
        {segments.filter((s) => s.count > 0).map((s) => (
          <span
            key={s.id}
            className="h-full first:rounded-l last:rounded-r"
            style={{ width: `${share(s.count)}%`, background: s.color }}
            title={`${s.label}${s.hint ? ` (${s.hint})` : ""}: ${fmtInt(s.count)} · ${Math.round(share(s.count))}%`}
          />
        ))}
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        {segments.map((s) => (
          <li key={s.id} className="flex items-start gap-2 text-xs">
            <span className="mt-1 h-2 w-2 shrink-0 rounded-sm" style={{ background: s.color }} />
            <span>
              <span className="font-medium text-slate-800">{s.label}</span>
              {s.hint && <span className="text-slate-500"> {s.hint}</span>}
              <span className="block tabular-nums text-slate-600">
                {fmtInt(s.count)} · {Math.round(share(s.count))}%
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TierBar({ header }: { header: AttendanceHeader | null }) {
  if (!header) return <Skeleton className="h-20 w-full" />;
  const counts: Record<string, number> = {
    eligible: header.eligible,
    recovery: header.recoveryEligible,
    at_risk: header.atRisk,
    ineligible: header.ineligible,
  };
  const segments = ATTENDANCE_TIERS.map((tier) => ({
    id: tier.id,
    label: tier.label,
    hint: tier.hint,
    count: counts[tier.id] ?? 0,
    color: tier.color,
  }));
  const total = segments.reduce((sum, s) => sum + s.count, 0);
  return <ShareBar segments={segments} total={total} />;
}

const SKILL_SEGMENTS: { id: keyof SpiOverview["summary"]; label: string; color: string }[] = [
  { id: "levelAPlus", label: "A+", color: "#047857" },
  { id: "levelA", label: "A", color: "#10b981" },
  { id: "levelB", label: "B", color: "#84cc16" },
  { id: "levelC", label: "C", color: "#fbbf24" },
  { id: "levelD", label: "D", color: "#f97316" },
  { id: "skillDebt", label: "Skill Debt", color: "#dc2626" },
];

export function SkillSplit({ summary }: { summary: SpiOverview["summary"] | null }) {
  if (!summary) return <Skeleton className="h-20 w-full" />;
  const segments = SKILL_SEGMENTS.map((s) => ({ id: s.id, label: s.label, count: Number(summary[s.id]) || 0, color: s.color }));
  return <ShareBar segments={segments} total={summary.students} />;
}

export function CompletionBars({ counts }: { counts: AssessmentCounts | null }) {
  if (!counts) return <Skeleton className="h-20 w-full" />;
  const items = [
    { label: "Classroom quizzes", value: counts.classroomPct },
    { label: "Module quizzes", value: counts.modulePct },
  ];
  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div key={item.label}>
          <div className="mb-1 flex justify-between text-xs">
            <span className="text-slate-700">{item.label}</span>
            <span className="font-medium tabular-nums text-slate-900">{fmtPct(item.value)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded bg-slate-100">
            <div className="h-full rounded bg-blue-600" style={{ width: `${Math.min(100, item.value)}%` }} />
          </div>
        </div>
      ))}
      <p className="text-xs text-slate-500">Share of assigned quizzes students have completed. Quiz data is not date-filtered.</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Trend                                                              */
/* ------------------------------------------------------------------ */

export interface TrendPoint {
  week: string;
  present: number;
  scheduled: number;
}

function TrendTooltip({ active, payload }: { active?: boolean; payload?: { payload: { week: string; pct: number; scheduled: number } }[] }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]!.payload;
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-md">
      <p className="font-medium text-slate-800">Week of {format(parseISO(d.week), "d MMM yyyy")}</p>
      <p className="mt-0.5 tabular-nums text-slate-700">
        {d.pct.toFixed(1)}% attendance · {fmtInt(d.scheduled)} records
      </p>
    </div>
  );
}

export function AttendanceTrend({ points, loading }: { points: TrendPoint[] | null; loading: boolean }) {
  const data = useMemo(
    () => (points ?? []).map((p) => ({ ...p, pct: Math.round((p.present / p.scheduled) * 1000) / 10 })),
    [points],
  );
  if (loading && !points) return <Skeleton className="h-[220px] w-full" />;
  if (!data.length) return <p className="py-10 text-center text-sm text-slate-500">No attendance recorded in this period.</p>;
  return (
    <div className="h-[220px]">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 16, left: -12, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef0f3" />
          <XAxis
            dataKey="week"
            tickFormatter={(v: string) => format(parseISO(v), "d MMM")}
            tick={{ fontSize: 11, fill: "#6b7280" }}
            tickLine={false}
            axisLine={{ stroke: "#e5e7eb" }}
            minTickGap={24}
          />
          <YAxis
            domain={[0, 100]}
            ticks={[0, 25, 50, 75, 100]}
            tickFormatter={(v: number) => `${v}%`}
            tick={{ fontSize: 11, fill: "#9ca3af" }}
            tickLine={false}
            axisLine={false}
          />
          <ReferenceLine
            y={80}
            stroke="#94a3b8"
            strokeDasharray="4 4"
            label={{ value: "80% target", position: "insideTopRight", fontSize: 10, fill: "#64748b" }}
          />
          <Tooltip content={<TrendTooltip />} cursor={{ stroke: "#cbd5e1" }} />
          <Line
            type="monotone"
            dataKey="pct"
            stroke="#2563eb"
            strokeWidth={2}
            dot={{ r: 3, fill: "#2563eb", stroke: "#fff", strokeWidth: 2 }}
            activeDot={{ r: 5, stroke: "#fff", strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Leaderboard                                                        */
/* ------------------------------------------------------------------ */

type SortKey = "label" | "students" | "attendancePct" | "belowSixty" | "avgSpi" | "skillDebt" | "completionPct";

const GRAIN_HEADING: Record<LeaderGrain, string> = {
  campus: "Campus",
  section: "Section",
  subject: "Subject",
};

export function Leaderboard({
  rows,
  grain,
  loading,
  linkFor,
  onExport,
}: {
  rows: LeaderRow[];
  grain: LeaderGrain;
  loading: boolean;
  linkFor: (row: LeaderRow) => string;
  onExport: (sorted: LeaderRow[]) => void;
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "attendancePct", dir: 1 });
  const sorted = useMemo(() => {
    const list = rows.slice();
    list.sort((a, b) => {
      if (sort.key === "label") return a.label.localeCompare(b.label, undefined, { numeric: true }) * sort.dir;
      const av = a[sort.key];
      const bv = b[sort.key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return ((av as number) - (bv as number)) * sort.dir;
    });
    return list;
  }, [rows, sort]);

  const columns: { key: SortKey; label: string; hide?: boolean }[] = [
    { key: "label", label: GRAIN_HEADING[grain] },
    { key: "students", label: "Students" },
    { key: "attendancePct", label: "Attendance" },
    { key: "belowSixty", label: "Below 60%", hide: grain === "subject" },
    { key: "avgSpi", label: "Avg SPI", hide: grain === "subject" },
    { key: "skillDebt", label: "Skill debt", hide: grain === "subject" },
    { key: "completionPct", label: "Quiz completion" },
  ];
  const visible = columns.filter((c) => !c.hide);

  if (loading && !rows.length) return <div className="p-5"><Skeleton className="h-48 w-full" /></div>;
  if (!rows.length) return <p className="p-5 text-sm text-slate-500">No data for these filters.</p>;

  return (
    <div>
      <div className="flex justify-end px-5 pt-3">
        <Button variant="outline" size="sm" onClick={() => onExport(sorted)}>
          <Download className="mr-1 h-3.5 w-3.5" /> Export CSV
        </Button>
      </div>
      <div className="max-h-[420px] overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-white">
            <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-500">
              {visible.map((c) => (
                <th key={c.key} className={cn("px-5 py-2 font-medium", c.key !== "label" && "text-right")}>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 hover:text-slate-800"
                    onClick={() =>
                      setSort((cur) => (cur.key === c.key ? { key: c.key, dir: cur.dir === 1 ? -1 : 1 } : { key: c.key, dir: c.key === "label" ? 1 : -1 }))
                    }
                  >
                    {c.label}
                    {sort.key === c.key && (sort.dir === 1 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr key={row.key} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="px-5 py-2">
                  <Link href={linkFor(row)} className="font-medium text-slate-900 hover:text-brand-700 hover:underline">
                    {row.label || "—"}
                  </Link>
                  {grain === "section" && row.campus && <span className="block text-xs text-slate-500">{row.campus}</span>}
                </td>
                <td className="px-5 py-2 text-right tabular-nums">{fmtInt(row.students)}</td>
                <td className="px-5 py-2 text-right font-medium tabular-nums" style={row.attendancePct != null ? { color: pctTextColor(row.attendancePct) } : undefined}>
                  {fmtPct(row.attendancePct)}
                </td>
                {grain !== "subject" && (
                  <>
                    <td className="px-5 py-2 text-right tabular-nums">{fmtInt(row.belowSixty)}</td>
                    <td className="px-5 py-2 text-right tabular-nums">{row.avgSpi == null ? "—" : row.avgSpi.toFixed(1)}</td>
                    <td className="px-5 py-2 text-right tabular-nums">{fmtInt(row.skillDebt)}</td>
                  </>
                )}
                <td className="px-5 py-2 text-right tabular-nums">{fmtPct(row.completionPct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Watch list                                                         */
/* ------------------------------------------------------------------ */

export function WatchList({
  rows,
  total,
  loading,
  spiPaths,
}: {
  rows: WatchStudent[];
  total: number;
  loading: boolean;
  spiPaths: Record<string, string>;
}) {
  if (loading && !rows.length) return <div className="p-5"><Skeleton className="h-48 w-full" /></div>;
  if (!rows.length) return <p className="p-5 text-sm text-slate-500">No students below 60% or in skill debt. </p>;
  return (
    <div>
      <ul className="divide-y divide-slate-100">
        {rows.map((s) => {
          const href = spiPaths[s.studentId];
          const name = <span className="font-medium text-slate-900">{s.studentName || s.studentId}</span>;
          return (
            <li key={`${s.campus}-${s.studentId}`} className="flex items-center justify-between gap-3 px-5 py-2.5">
              <div className="min-w-0">
                {href ? (
                  <Link href={href} className="hover:underline">{name}</Link>
                ) : (
                  name
                )}
                <p className="truncate text-xs text-slate-500">
                  {s.campus}
                  {s.section ? ` · ${s.section}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2 text-xs">
                {s.skillDebt && (
                  <span className="rounded bg-red-50 px-1.5 py-0.5 font-medium text-red-700">Skill debt</span>
                )}
                <span
                  className="w-14 text-right font-semibold tabular-nums"
                  style={s.attendancePct != null ? { color: pctTextColor(s.attendancePct) } : undefined}
                >
                  {fmtPct(s.attendancePct)}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
      {total > rows.length && (
        <p className="border-t border-slate-100 px-5 py-2 text-xs text-slate-500">
          Showing {rows.length} of {fmtInt(total)} flagged students.
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Insights                                                           */
/* ------------------------------------------------------------------ */

const TONE_ICON = {
  good: { icon: TrendingUp, color: "text-emerald-700" },
  bad: { icon: TrendingDown, color: "text-red-700" },
  warn: { icon: AlertTriangle, color: "text-amber-700" },
  info: { icon: Info, color: "text-slate-500" },
} as const;

export function InsightsList({ insights, loading }: { insights: Insight[]; loading: boolean }) {
  if (loading && !insights.length) return <div className="p-5"><Skeleton className="h-24 w-full" /></div>;
  if (!insights.length) {
    return (
      <p className="flex items-center gap-2 p-5 text-sm text-slate-500">
        <CheckCircle2 className="h-4 w-4" /> Nothing stands out for these filters.
      </p>
    );
  }
  return (
    <ul className="space-y-2.5 p-5">
      {insights.map((item, i) => {
        const tone = TONE_ICON[item.tone];
        return (
          <li key={i} className="flex items-start gap-2.5 text-sm text-slate-800">
            <tone.icon className={cn("mt-0.5 h-4 w-4 shrink-0", tone.color)} aria-label={item.tone} />
            <span>{item.text}</span>
          </li>
        );
      })}
    </ul>
  );
}
