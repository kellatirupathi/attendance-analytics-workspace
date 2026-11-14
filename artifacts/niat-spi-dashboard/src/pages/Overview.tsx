import { useMemo, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Download, Lock } from "lucide-react";
import { format, subDays } from "date-fns";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/PageHeader";
import { ErrorState } from "@/components/PageStates";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/AuthContext";
import { exportCsv } from "@/lib/csv";
import { fmtInt } from "@/lib/assessmentMetrics";
import { AttendanceCaption } from "@/components/AttendanceInfo";
import { ATTENDANCE_TIERS, TIER_AT_RISK, TIER_ELIGIBLE, TIER_RECOVERY } from "@/lib/attendanceTiers";
import { directoryApi } from "@/lib/directoryReport";
import { directoryHref, NO_OVERVIEW_FILTERS, overviewApi, type OverviewFilters, type OverviewRank } from "@/lib/overviewReport";
import { Donut, HBars, Trend, useTip, VBars, type DonutItem, type TipProps } from "@/components/overview/charts";

/**
 * Overview, one layout per role. Every figure is the student report's own (tiers, attendance, SPI, quiz averages, skill debt),
 * rolled up on the server from the saved reports, so the cards agree with the Student Directory and the reports.
 * The server limits everything to the user's own colleges and subjects.
 */
type CardId = "att" | "trend" | "fsa" | "assess" | "spidist" | "rank" | "subject" | "debt" | "attention";

const LAYOUT: Record<string, [CardId, number][]> = {
  admin: [["att", 4], ["trend", 5], ["fsa", 3], ["assess", 4], ["spidist", 4], ["rank", 4], ["subject", 4], ["attention", 8]],
  superadmin: [["trend", 5], ["att", 4], ["fsa", 3], ["rank", 6], ["subject", 6], ["assess", 4], ["spidist", 4], ["attention", 4]],
  boa: [["assess", 5], ["spidist", 4], ["fsa", 3], ["att", 4], ["rank", 8], ["trend", 6], ["subject", 6], ["attention", 12]],
  cos: [["assess", 5], ["spidist", 4], ["fsa", 3], ["att", 4], ["rank", 8], ["trend", 6], ["subject", 6], ["attention", 12]],
  hod: [["att", 4], ["trend", 5], ["fsa", 3], ["rank", 6], ["subject", 6], ["assess", 4], ["spidist", 4], ["attention", 4]],
  capability_manager: [["assess", 4], ["rank", 4], ["fsa", 4], ["att", 4], ["trend", 4], ["debt", 4], ["attention", 12]],
};
const SPAN: Record<number, string> = { 3: "xl:col-span-3", 4: "xl:col-span-4", 5: "xl:col-span-5", 6: "xl:col-span-6", 8: "xl:col-span-8", 12: "xl:col-span-12" };
const selectClass = "h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-600 disabled:bg-slate-50 disabled:text-slate-500";
const STALE = 5 * 60_000;
const pct = (v: number | null) => (v == null ? "–" : `${v.toFixed(1)}%`);

const TIER_ITEMS: { key: "eligible" | "recovery_eligible" | "at_risk" | "ineligible"; field: "eligible" | "recovery" | "atRisk" | "ineligible"; label: string; hint: string; color: string; bg: string }[] = [
  { key: "eligible", field: "eligible", label: "Eligible", hint: `≥ ${TIER_ELIGIBLE}%`, color: ATTENDANCE_TIERS[0]!.color, bg: ATTENDANCE_TIERS[0]!.bg },
  // The donut slice for Recovery is a brighter amber than its text colour, so it can be told apart from At risk.
  { key: "recovery_eligible", field: "recovery", label: "Recovery", hint: `${TIER_RECOVERY}–${TIER_ELIGIBLE - 1}%`, color: "#E3A008", bg: ATTENDANCE_TIERS[1]!.bg },
  { key: "at_risk", field: "atRisk", label: "At risk", hint: `${TIER_AT_RISK}–${TIER_RECOVERY - 1}%`, color: ATTENDANCE_TIERS[2]!.color, bg: ATTENDANCE_TIERS[2]!.bg },
  { key: "ineligible", field: "ineligible", label: "Ineligible", hint: `< ${TIER_AT_RISK}%`, color: ATTENDANCE_TIERS[3]!.color, bg: ATTENDANCE_TIERS[3]!.bg },
];

function Card({ title, right, children, className }: { title: string; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("flex min-w-0 flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm", className)} aria-label={title}>
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-slate-900">{title}</h2>
        {right && <div className="flex items-center gap-2">{right}</div>}
      </div>
      {children}
    </section>
  );
}

function Seg({ value, options, onChange, label }: { value: string; options: [string, string][]; onChange: (v: string) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
      {options.map(([v, l]) => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)} className={cn("rounded-md px-2.5 py-1 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-600", value === v ? "bg-white text-violet-700 shadow-sm" : "text-slate-500 hover:text-slate-800")}>
          {l}
        </button>
      ))}
    </div>
  );
}

const Chip = ({ children }: { children: ReactNode }) => <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold text-slate-500">{children}</span>;

function ViewAll({ href, label = "View all" }: { href: string; label?: string }) {
  const [, setLocation] = useLocation();
  return (
    <button type="button" onClick={() => setLocation(href)} className="inline-flex items-center gap-1 whitespace-nowrap rounded px-1 text-xs font-semibold text-violet-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-600">
      {label} <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
    </button>
  );
}

/** Nice axis maximum divisible by four, so every tick is a whole number. */
const niceMax = (m: number) => {
  const u = m < 100 ? 5 : m < 500 ? 25 : 50;
  return Math.max(4 * u, Math.ceil(m / (4 * u)) * 4 * u);
};

export default function Overview() {
  const { user } = useAuth();
  const role = user?.role && LAYOUT[user.role] ? user.role : "admin";
  const [, setLocation] = useLocation();
  const tip = useTip();
  const [filters, setFilters] = useState<OverviewFilters>(NO_OVERVIEW_FILTERS);
  const [metric, setMetric] = useState<"attendance" | "spi">("attendance");
  const [subjectMetric, setSubjectMetric] = useState<"attendance" | "score">("attendance");
  const [order, setOrder] = useState<"top" | "bottom">("top");
  const [tab, setTab] = useState<"atRisk" | "ineligible">("atRisk");
  const [period, setPeriod] = useState<"semester" | "last30" | "last7">("semester");

  const options = useQuery({ queryKey: ["directory-options"], queryFn: directoryApi.options, staleTime: STALE });
  const data = useQuery({ queryKey: ["overview", filters], queryFn: () => overviewApi.data(filters), staleTime: STALE, placeholderData: keepPreviousData });
  const scopeCampus = options.data?.colleges.length === 1 ? options.data.colleges[0]! : "";
  const dates = useMemo(() => {
    if (period === "semester") return {};
    const today = new Date();
    return { dateFrom: format(subDays(today, period === "last30" ? 30 : 7), "yyyy-MM-dd"), dateTo: format(today, "yyyy-MM-dd") };
  }, [period]);
  const trend = useQuery({ queryKey: ["overview-trend", filters, dates, scopeCampus], queryFn: () => overviewApi.trend(filters, dates, scopeCampus), staleTime: STALE, placeholderData: keepPreviousData });

  const o = data.data;
  const s = o?.summary;
  const loading = data.isLoading;
  const colleges = options.data?.colleges ?? [];
  const sectionNames = useMemo(() => [...new Set((options.data?.sections ?? []).filter((x) => !filters.college || x.college === filters.college).map((x) => x.section))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })), [options.data, filters.college]);
  const college = filters.college || scopeCampus;
  const go = (href: string) => setLocation(href);
  const dirHref = (tier?: string) => directoryHref({ tier, college: college || undefined, semester: filters.semester || undefined });
  const change = (patch: Partial<OverviewFilters>) =>
    setFilters((f) => {
      const next = { ...f, ...patch };
      if (patch.college !== undefined && next.section && !(options.data?.sections ?? []).some((x) => (!next.college || x.college === next.college) && x.section === next.section)) next.section = "";
      return next;
    });

  /* ---- KPI cards ---- */
  const kpis: { label: string; value: string; color?: string; href: string }[] = [
    { label: "Total students", value: s ? fmtInt(s.students) : "", href: dirHref() },
    { label: "Overall attendance", value: s ? pct(s.avgAttendance) : "", href: "/dashboard/attendance-stats" },
    { label: "Average SPI", value: s ? (s.avgSpi == null ? "–" : s.avgSpi.toFixed(2)) : "", href: dirHref() },
    ...TIER_ITEMS.map((t) => ({ label: t.label, value: s ? fmtInt(s[t.field]) : "", color: t.color, href: dirHref(t.key) })),
  ];
  if (role === "capability_manager") kpis.push({ label: "Skill debt", value: s ? fmtInt(s.skillDebt) : "", color: "#6D4AE0", href: dirHref() });

  /* ---- cards ---- */
  const tipBox = (title: string, line: string) => (
    <>
      <b>{title}</b>
      <br />
      <span className="text-slate-300">{line}</span>
    </>
  );
  const top5 = (rows: OverviewRank[], value: (r: OverviewRank) => number | null, bottom = false) =>
    rows.filter((r) => value(r) != null).sort((a, b) => (bottom ? value(a)! - value(b)! : value(b)! - value(a)!)).slice(0, 5);
  const rankRows = (list: OverviewRank[], v: (r: OverviewRank) => number | null, display: (n: number) => string, unit: string, bottom = false) =>
    top5(list, v, bottom).map((r) => ({ name: r.name, value: v(r), display: display(v(r)!), tip: tipBox(r.college ? `${r.name} · ${r.college}` : r.name, `${display(v(r)!)}${unit} · ${fmtInt(r.students)} students`) }));

  const cards: Record<CardId, () => ReactNode> = {
    att: () => (
      <Card title="Attendance distribution">
        {loading || !s ? <Skeleton className="h-40 w-full" /> : <Donut total={TIER_ITEMS.reduce((n, t) => n + s[t.field], 0)} items={TIER_ITEMS.map((t): DonutItem => ({ key: t.key, label: t.label, hint: t.hint, count: s[t.field], color: t.color }))} onSelect={(key) => go(dirHref(key))} />}
        {s && s.noSessions > 0 && <p className="mt-2 text-xs text-slate-500">{fmtInt(s.noSessions)} students have no sessions yet.</p>}
        <AttendanceCaption />
      </Card>
    ),
    trend: () => {
      const points = (trend.data?.points ?? []).filter((p) => p.scheduled > 0).map((p) => {
        const v = Math.floor((p.present * 1000) / p.scheduled) / 10;
        const label = format(new Date(`${p.week.slice(0, 10)}T00:00:00`), "d MMM");
        return { label, value: v, tip: tipBox(`Week of ${label}`, `${v.toFixed(1)}% · ${fmtInt(p.present)} of ${fmtInt(p.scheduled)} sessions`) };
      });
      return (
        <Card title="Attendance trend" right={<><Chip>weekly</Chip><select aria-label="Trend period" className={cn(selectClass, "h-8 py-0 text-xs")} value={period} onChange={(e) => setPeriod(e.target.value as typeof period)}><option value="semester">Semester to date</option><option value="last30">Last 30 days</option><option value="last7">Last 7 days</option></select></>}>
          {trend.isLoading ? <Skeleton className="h-44 w-full" /> : points.length === 0 ? <p className="py-10 text-center text-sm text-slate-500">No sessions in this period</p> : <Trend points={points} tip={tip.props as TipProps} label="Weekly attendance" format={(v) => `${v.toFixed(1)}%`} />}
          <AttendanceCaption />
        </Card>
      );
    },
    fsa: () => (
      <Card title="Final Skill Assessment (50%)" className="justify-center bg-gradient-to-b from-white to-violet-50/40">
        <div className="flex flex-col items-start gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-violet-50 text-violet-700"><Lock className="h-[18px] w-[18px]" aria-hidden="true" /></span>
          <span className="rounded-full bg-violet-50 px-3 py-1 text-xs font-bold text-violet-700">Coming soon</span>
        </div>
      </Card>
    ),
    assess: () => {
      const a = o?.assessment;
      const items = [["Classroom Quiz", a?.classroom ?? null], ["Module Quiz", a?.module ?? null], ["Skill Assessment", a?.skill ?? null]] as [string, number | null][];
      return (
        <Card title="Assessment performance" right={<Chip>avg score %</Chip>}>
          {loading ? <Skeleton className="h-44 w-full" /> : <VBars label="Assessment performance" max={100} tip={tip.props} onSelect={() => go("/dashboard/assessments")} items={items.map(([label, value]) => ({ label, value, tip: tipBox(label, value == null ? "Nothing held yet" : `${value.toFixed(1)}% average`) }))} />}
        </Card>
      );
    },
    spidist: () => {
      const bins = o?.spiBins ?? [];
      return (
        <Card title="SPI distribution" right={<Chip>students</Chip>}>
          {loading ? <Skeleton className="h-44 w-full" /> : <VBars label="SPI distribution" max={niceMax(Math.max(0, ...bins.map((b) => b.count)))} tip={tip.props} onSelect={() => go(dirHref())} items={bins.map((b) => ({ label: b.label, value: b.count, tip: tipBox(`SPI ${b.label}`, `${fmtInt(b.count)} students (${s?.students ? Math.round((b.count / s.students) * 100) : 0}%)`) }))} />}
        </Card>
      );
    },
    rank: () => {
      if (role === "capability_manager") {
        const rows = rankRows(o?.subjects ?? [], (r) => r.spi, (n) => n.toFixed(2), " / 10");
        return (
          <Card title="Course-wise SPI" right={<Chip>out of 10</Chip>}>
            {loading ? <Skeleton className="h-40 w-full" /> : <HBars rows={rows} max={10} tip={tip.props} onSelect={(i) => setFilters((f) => ({ ...f, subject: rows[i]!.name }))} />}
            <div className="mt-2 flex justify-end"><ViewAll href="/dashboard/attendance-stats?group=university_subject" /></div>
          </Card>
        );
      }
      const showColleges = role !== "hod" && !filters.college && !scopeCampus && colleges.length > 1;
      const list = showColleges ? o?.colleges ?? [] : o?.sections ?? [];
      const bottom = role === "superadmin" && order === "bottom";
      const useAtt = metric === "attendance";
      const rows = rankRows(list, (r) => (useAtt ? r.attendance : r.spi), (n) => (useAtt ? n.toFixed(1) : n.toFixed(2)), useAtt ? "%" : "", bottom).map((r) => ({ ...r, name: showColleges ? r.name : `Section ${r.name}` }));
      const title = showColleges ? (role === "boa" ? "College comparison" : "College performance") : "Section performance";
      return (
        <Card title={title} right={<>{role === "superadmin" && <Seg label="Order" value={order} onChange={(v) => setOrder(v as "top" | "bottom")} options={[["top", "Top 5"], ["bottom", "Bottom 5"]]} />}<Seg label="Metric" value={metric} onChange={(v) => setMetric(v as "attendance" | "spi")} options={[["attendance", "Attendance"], ["spi", "SPI"]]} /></>}>
          {loading ? <Skeleton className="h-40 w-full" /> : <HBars rows={rows} max={useAtt ? 100 : 10} tip={tip.props} onSelect={(i) => showColleges && change({ college: list.find((r) => r.name === rows[i]!.name)?.name ?? "" })} />}
          {useAtt && <AttendanceCaption />}
          <div className="mt-2 flex items-center justify-between text-xs text-slate-500"><span>{bottom ? "Lowest" : "Highest"} first</span><ViewAll href={showColleges ? "/dashboard/attendance-stats" : "/dashboard/attendance-stats?group=university_section"} /></div>
        </Card>
      );
    },
    subject: () => {
      const useAtt = subjectMetric === "attendance";
      const rows = rankRows(o?.subjects ?? [], (r) => (useAtt ? r.attendance : r.score), (n) => n.toFixed(1), "%");
      return (
        <Card title="Subject performance" right={<Seg label="Metric" value={subjectMetric} onChange={(v) => setSubjectMetric(v as "attendance" | "score")} options={[["attendance", "Attendance"], ["score", "Avg score"]]} />}>
          {loading ? <Skeleton className="h-40 w-full" /> : <HBars rows={rows} max={100} tip={tip.props} onSelect={(i) => setFilters((f) => ({ ...f, subject: rows[i]!.name }))} />}
          {useAtt && <AttendanceCaption />}
          <div className="mt-2 flex justify-end"><ViewAll href="/dashboard/attendance-stats?group=university_subject" /></div>
        </Card>
      );
    },
    debt: () => {
      const list = (o?.subjects ?? []).slice().sort((a, b) => b.debt - a.debt).slice(0, 5);
      const max = Math.max(1, ...list.map((r) => r.debt));
      return (
        <Card title="Skill debt by course" right={<Chip>students</Chip>}>
          {loading ? <Skeleton className="h-40 w-full" /> : <HBars rows={list.map((r) => ({ name: r.name, value: r.debt, display: fmtInt(r.debt), tip: tipBox(r.name, `${fmtInt(r.debt)} of ${fmtInt(r.students)} students at level F`) }))} max={max} tip={tip.props} />}
          <div className="mt-2 flex justify-end"><ViewAll href={dirHref()} /></div>
        </Card>
      );
    },
    attention: () => {
      const a = o?.attention[tab];
      const t = TIER_ITEMS.find((x) => x.field === tab)!;
      return (
        <Card
          title="Students requiring attention"
          right={
            <div role="tablist" className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
              {([["atRisk", "At risk", o?.attention.atRisk.total], ["ineligible", "Ineligible", o?.attention.ineligible.total]] as const).map(([k, label, n]) => (
                <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cn("inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-600", tab === k ? "bg-white text-slate-900 shadow-sm" : "text-slate-500")}>
                  {label} <span className="rounded-full px-1.5 text-[11px]" style={{ background: TIER_ITEMS.find((x) => x.field === k)!.bg, color: TIER_ITEMS.find((x) => x.field === k)!.color }}>{n == null ? "" : fmtInt(n)}</span>
                </button>
              ))}
            </div>
          }
        >
          {loading ? <Skeleton className="h-40 w-full" /> : a && a.rows.length > 0 ? (
            <ul>
              {a.rows.slice(0, role === "boa" || role === "capability_manager" ? 5 : 5).map((r) => (
                <li key={r.studentId}>
                  <button type="button" onClick={() => go(directoryHref({ tier: t.key, q: r.studentId }))} className="grid w-full grid-cols-[1fr_auto] items-center gap-3 rounded-lg border-b border-slate-100 px-2 py-2 text-left hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-600">
                    <span>
                      <span className="block text-sm font-semibold text-slate-900">{r.name || "—"}</span>
                      <span className="text-xs text-slate-500">{r.college} · {r.section}</span>
                    </span>
                    <span className="rounded-full px-2.5 py-0.5 text-xs font-bold tabular-nums" style={{ color: t.color, background: t.bg }}>{r.attendancePct == null ? "–" : `${r.attendancePct}%`}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-8 text-center text-sm text-slate-500">No students in this group</p>
          )}
          <AttendanceCaption />
          <div className="mt-2 flex items-center justify-between text-xs text-slate-500"><span>Lowest attendance first</span>{a && <ViewAll href={dirHref(t.key)} label={`View all ${fmtInt(a.total)}`} />}</div>
        </Card>
      );
    },
  };

  const exportOverview = () => {
    if (!o) return;
    const rows: (string | number)[][] = [
      ["Total students", o.summary.students],
      ["Overall attendance % (present ÷ held)", o.summary.avgAttendance ?? ""],
      ["Average SPI", o.summary.avgSpi ?? ""],
      ["Eligible", o.summary.eligible],
      ["Recovery", o.summary.recovery],
      ["At risk", o.summary.atRisk],
      ["Ineligible", o.summary.ineligible],
      ["Skill debt (students)", o.summary.skillDebt],
      ["Classroom Quiz avg %", o.assessment.classroom ?? ""],
      ["Module Quiz avg %", o.assessment.module ?? ""],
      ["Skill Assessment avg %", o.assessment.skill ?? ""],
      ...o.colleges.map((c) => [`College: ${c.name}`, `${c.attendance ?? ""}% attendance, SPI ${c.spi ?? ""}, ${c.students} students`]),
    ];
    exportCsv("overview.csv", ["Measure", "Value"], rows);
  };

  const scopeLabel = [filters.college || (scopeCampus ? scopeCampus : colleges.length > 1 ? "All colleges" : ""), filters.section && `Section ${filters.section}`, filters.subject].filter(Boolean).join(" · ");

  return (
    <div className="flex min-w-0 flex-col">
      <PageHeader
        title="Overview"
        right={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {scopeLabel && <span className="rounded-full bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-700">{scopeLabel}</span>}
            {colleges.length > 1 && (
              <select aria-label="College" className={selectClass} value={filters.college} onChange={(e) => change({ college: e.target.value })}>
                <option value="">All colleges</option>
                {colleges.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            )}
            <select aria-label="Section" className={selectClass} value={filters.section} onChange={(e) => change({ section: e.target.value })}>
              <option value="">All sections</option>
              {sectionNames.map((x) => (
                <option key={x} value={x}>{x}</option>
              ))}
            </select>
            <select aria-label="Subject" className={cn(selectClass, "max-w-[12rem]")} value={filters.subject} onChange={(e) => change({ subject: e.target.value })}>
              <option value="">{user?.subjects?.length ? "My subjects" : "All subjects"}</option>
              {(options.data?.subjects ?? []).map((x) => (
                <option key={x} value={x}>{x}</option>
              ))}
            </select>
            <button type="button" onClick={exportOverview} disabled={!o} className="inline-flex h-9 items-center gap-2 rounded-lg bg-violet-600 px-3.5 text-sm font-semibold text-white hover:bg-violet-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-600 focus-visible:ring-offset-2 disabled:opacity-50">
              <Download className="h-4 w-4" aria-hidden="true" /> Export
            </button>
          </div>
        }
      />

      {data.isError && !o ? (
        <ErrorState message="Failed to load the overview." onRetry={() => void data.refetch()} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4 xl:grid-cols-[repeat(auto-fit,minmax(7.5rem,1fr))]">
            {kpis.map((k) => (
              <button key={k.label} type="button" onClick={() => go(k.href)} className="group relative flex flex-col gap-0.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-left shadow-sm transition hover:-translate-y-px hover:border-violet-200 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-600 motion-reduce:transition-none motion-reduce:hover:translate-y-0">
                {k.color && <span className="absolute bottom-3 left-0 top-3 w-[3px] rounded-r" style={{ background: k.color }} aria-hidden="true" />}
                <span className="text-xs font-medium text-slate-500">{k.label}</span>
                {loading ? <Skeleton className="h-7 w-16" /> : <span className="text-xl font-bold tabular-nums tracking-tight text-slate-900" style={k.color ? { color: k.color } : undefined}>{k.value}</span>}
                <ArrowUpRight className="absolute right-2.5 top-2.5 h-3.5 w-3.5 text-slate-300 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
              </button>
            ))}
          </div>
          <div className="mt-3.5 grid grid-cols-1 gap-3.5 md:grid-cols-6 xl:grid-cols-12">
            {LAYOUT[role]!.map(([id, span]) => (
              <div key={id} className={cn("flex min-w-0 md:col-span-3", SPAN[span], span >= 8 && "md:col-span-6")}>
                <div className="flex min-w-0 flex-1 flex-col [&>section]:flex-1">{cards[id]()}</div>
              </div>
            ))}
          </div>
        </>
      )}
      {tip.layer}
    </div>
  );
}
