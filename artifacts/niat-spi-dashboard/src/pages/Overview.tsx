import { useMemo, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowUpRight } from "lucide-react";
import { format, subDays } from "date-fns";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/PageHeader";
import { ErrorState } from "@/components/PageStates";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/AuthContext";
import { exportCsv } from "@/lib/csv";
import { fmtInt } from "@/lib/assessmentMetrics";
import { AttendanceCaption } from "@/components/AttendanceInfo";
import { CheckMenu } from "@/components/SpiRecordFilterBar";
import { ExportMenu, FilterField, fieldTrigger, focusRing, MoreFiltersSheet, ScopeFilterBar, type FilterChip } from "@/components/ScopeFilters";
import { ATTENDANCE_TIERS, TIER_AT_RISK, TIER_ELIGIBLE, TIER_RECOVERY } from "@/lib/attendanceTiers";
import { directoryApi } from "@/lib/directoryReport";
import { directoryHref, NO_OVERVIEW_FILTERS, overviewApi, type OverviewFilters, type OverviewRank } from "@/lib/overviewReport";
import { Donut, HBars, Trend, useTip, type DonutItem, type TipProps } from "@/components/overview/charts";

/**
 * Overview: every figure is the student report's own (tiers, attendance, quiz and Skill Assessment averages), rolled
 * up on the server from the saved reports, so the cards agree with the Student Directory, Student Attendance Stats
 * and Assessments. The server limits everything to the user's own colleges and subjects. One layout for every role:
 * attendance first, then assessments. No SPI figures until the Final Skill Assessment ("Coming soon", as elsewhere).
 */
const STALE = 5 * 60_000;
const pct = (v: number | null | undefined) => (v == null ? "–" : `${v.toFixed(1)}%`);
const selectClass = "h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-600";

const TIER_ITEMS: { key: "eligible" | "recovery_eligible" | "at_risk" | "ineligible"; field: "eligible" | "recovery" | "atRisk" | "ineligible"; label: string; hint: string; color: string; bg: string }[] = [
  { key: "eligible", field: "eligible", label: "Eligible", hint: `≥ ${TIER_ELIGIBLE}%`, color: ATTENDANCE_TIERS[0]!.color, bg: ATTENDANCE_TIERS[0]!.bg },
  // The donut slice for Recovery is a brighter amber than its text colour, so it can be told apart from At risk.
  { key: "recovery_eligible", field: "recovery", label: "Recovery", hint: `${TIER_RECOVERY}–${TIER_ELIGIBLE - 1}%`, color: "#E3A008", bg: ATTENDANCE_TIERS[1]!.bg },
  { key: "at_risk", field: "atRisk", label: "At risk", hint: `${TIER_AT_RISK}–${TIER_RECOVERY - 1}%`, color: ATTENDANCE_TIERS[2]!.color, bg: ATTENDANCE_TIERS[2]!.bg },
  { key: "ineligible", field: "ineligible", label: "Ineligible", hint: `< ${TIER_AT_RISK}%`, color: ATTENDANCE_TIERS[3]!.color, bg: ATTENDANCE_TIERS[3]!.bg },
];

const QUIZ_METRICS = [
  ["classroom", "Classroom"],
  ["module", "Module"],
  ["skill", "Skill"],
] as const;
type QuizMetric = (typeof QUIZ_METRICS)[number][0];
const QUIZ_NAME: Record<QuizMetric, string> = { classroom: "Classroom Quiz", module: "Module Quiz", skill: "Skill Assessment" };

function Card({ title, right, children, footer, className }: { title: string; right?: ReactNode; children: ReactNode; footer?: ReactNode; className?: string }) {
  return (
    <section className={cn("flex h-full min-w-0 flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm", className)} aria-label={title}>
      <div className="mb-4 flex min-h-8 flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-slate-900">{title}</h3>
        {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      {/* The footer sits on the card's bottom edge, so cards side by side end on one line. */}
      {footer && <div className="mt-auto flex items-center justify-between gap-2 pt-4 text-xs text-slate-500">{footer}</div>}
    </section>
  );
}

function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
      {options.map(([v, l]) => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)} className={cn("min-h-7 rounded-md px-2.5 text-xs font-semibold", focusRing, value === v ? "bg-white text-violet-700 shadow-sm" : "text-slate-500 hover:text-slate-800")}>
          {l}
        </button>
      ))}
    </div>
  );
}

function ViewAll({ href, label = "View all" }: { href: string; label?: string }) {
  const [, setLocation] = useLocation();
  return (
    <button type="button" onClick={() => setLocation(href)} className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded px-1 text-xs font-semibold text-violet-700 hover:underline", focusRing)}>
      {label} <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
    </button>
  );
}

/** A number card; the value sits on the card's bottom line so values stay level when a label wraps. */
function Kpi({ label, value, color, loading, href }: { label: string; value: string; color?: string; loading: boolean; href?: string }) {
  const [, setLocation] = useLocation();
  const body = (
    <>
      {color && <span className="absolute bottom-3 left-0 top-3 w-[3px] rounded-r" style={{ background: color }} aria-hidden="true" />}
      <span className="text-xs font-medium text-slate-500">{label}</span>
      {loading ? <span className="mt-auto h-7 w-16 animate-pulse rounded bg-slate-100" /> : <span className="mt-auto text-xl font-bold tabular-nums tracking-tight text-slate-900" style={color ? { color } : undefined}>{value}</span>}
    </>
  );
  const box = "relative flex h-full min-h-[4.5rem] flex-col gap-1 rounded-xl border border-slate-200 bg-white px-4 py-3 text-left shadow-sm";
  if (!href) return <div className={box}>{body}</div>;
  return (
    <button type="button" onClick={() => setLocation(href)} className={cn(box, "group transition-colors hover:border-violet-300", focusRing)}>
      {body}
      <ArrowUpRight className="absolute right-2.5 top-2.5 h-3.5 w-3.5 text-slate-300 opacity-0 transition-opacity group-hover:opacity-100 motion-reduce:transition-none" aria-hidden="true" />
    </button>
  );
}

/** A card whose number needs the Final Skill Assessment (FSA): Coming soon until FSA results are in. */
function SoonKpi({ label }: { label: string }) {
  return (
    <div className="flex h-full min-h-[4.5rem] flex-col gap-1 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-3 shadow-sm">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <span className="mt-auto inline-flex w-fit items-center rounded-full bg-violet-50 px-2.5 py-0.5 text-xs font-semibold text-violet-700">Coming soon</span>
    </div>
  );
}

function SectionTitle({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
      <h2 className="text-base font-bold text-slate-900">{title}</h2>
      {children}
    </div>
  );
}

export default function Overview() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const tip = useTip();
  const [filters, setFilters] = useState<OverviewFilters>(NO_OVERVIEW_FILTERS);
  const [moreOpen, setMoreOpen] = useState(false);
  const [draft, setDraft] = useState<{ sections: string[]; subject: string }>({ sections: [], subject: "" });
  const [period, setPeriod] = useState<"semester" | "last30" | "last7">("semester");
  const [attOrder, setAttOrder] = useState<"top" | "bottom">("top");
  const [subjectOrder, setSubjectOrder] = useState<"top" | "bottom">("top");
  const [tab, setTab] = useState<"atRisk" | "ineligible">("atRisk");
  const [quizRank, setQuizRank] = useState<QuizMetric>("classroom");
  const [quizRankOrder, setQuizRankOrder] = useState<"top" | "bottom">("top");
  const [quizSubject, setQuizSubject] = useState<QuizMetric>("classroom");
  const [quizSubjectOrder, setQuizSubjectOrder] = useState<"top" | "bottom">("top");

  const options = useQuery({ queryKey: ["directory-options"], queryFn: directoryApi.options, staleTime: STALE });
  const data = useQuery({ queryKey: ["overview", filters], queryFn: () => overviewApi.data(filters), staleTime: STALE, placeholderData: keepPreviousData });
  const dates = useMemo(() => {
    if (period === "semester") return {};
    const today = new Date();
    return { dateFrom: format(subDays(today, period === "last30" ? 30 : 7), "yyyy-MM-dd"), dateTo: format(today, "yyyy-MM-dd") };
  }, [period]);
  const trend = useQuery({ queryKey: ["overview-trend", filters, dates], queryFn: () => overviewApi.trend(filters, dates), staleTime: STALE, placeholderData: keepPreviousData });
  /** Old numbers stay on screen while the new filters load. */
  const updating = (data.isFetching && data.isPlaceholderData) || (trend.isFetching && trend.isPlaceholderData);

  const opt = options.data;
  const o = data.data;
  const s = o?.summary;
  const loading = data.isLoading;
  const go = (href: string) => setLocation(href);
  /** A single-college user: the college is fixed. */
  const lockedCampus = opt?.colleges.length === 1 ? opt.colleges[0] : undefined;

  /* ---- filters (the Student Directory's, so a filter means the same on both pages) ---- */
  const sectionsFor = (colleges: string[], batches: string[]) =>
    (opt?.sections ?? []).filter((x) => (colleges.length || batches.length || lockedCampus) && (!colleges.length || colleges.includes(x.college)) && (!batches.length || batches.includes(`${x.college}\t${x.batch}`)));
  const sectionChoices = useMemo(() => {
    const list = sectionsFor(filters.colleges, filters.batches);
    const manyBatches = new Set(list.map((x) => `${x.college}\t${x.batch}`)).size > 1;
    const seen = new Map<string, string>();
    for (const x of list) seen.set(`${x.batch}\t${x.section}`, manyBatches ? `${x.batch} — ${x.section}` : x.section);
    return [...seen.entries()].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opt, filters.colleges, filters.batches, lockedCampus]);
  /** Changing a parent filter drops choices it no longer has, so no hidden filter stays on. */
  const change = (patch: Partial<OverviewFilters>) =>
    setFilters((f) => {
      const next = { ...f, ...patch };
      if (patch.colleges) next.batches = next.colleges.length ? next.batches.filter((b) => next.colleges.includes(b.split("\t")[0]!)) : next.batches;
      if (patch.colleges || patch.batches) {
        const ok = new Set(sectionsFor(next.colleges, next.batches).map((x) => `${x.batch}\t${x.section}`));
        next.sections = next.sections.filter((x) => ok.has(x));
      }
      return next;
    });
  const sectionLabel = (id: string) => sectionChoices.find((x) => x.id === id)?.label ?? id.split("\t")[1] ?? id;
  const chips: FilterChip[] = [
    ...filters.sections.map((id) => ({ key: `section-${id}`, label: `Section: ${sectionLabel(id)}`, clear: () => change({ sections: filters.sections.filter((x) => x !== id) }) })),
    ...(filters.subject ? [{ key: "subject", label: `Subject: ${filters.subject}`, clear: () => change({ subject: "" }) }] : []),
  ];
  const moreCount = (filters.sections.length ? 1 : 0) + (filters.subject ? 1 : 0);
  const anyFilter = filters.colleges.length > 0 || filters.batches.length > 0 || filters.term !== "" || chips.length > 0;
  const dirHref = (tier?: string) => directoryHref({ ...filters, tier });

  /* ---- rankings ---- */
  /** Colleges when several are in view; otherwise that college's sections (an HOD always sees sections). */
  const oneCollege = Boolean(lockedCampus) || filters.colleges.length === 1;
  const showColleges = user?.role !== "hod" && !oneCollege && (opt?.colleges.length ?? 0) > 1;
  const groups = showColleges ? o?.colleges ?? [] : o?.sections ?? [];
  const groupName = (r: OverviewRank) => (showColleges ? r.name : `Section ${r.name}`);
  const groupTitle = showColleges ? "College" : "Section";
  const tipBox = (title: string, line: string) => (
    <>
      <b>{title}</b>
      <br />
      <span className="text-slate-300">{line}</span>
    </>
  );
  const ranked = (list: OverviewRank[], value: (r: OverviewRank) => number | null, order: "top" | "bottom", name: (r: OverviewRank) => string, unit: string) =>
    list
      .filter((r) => value(r) != null)
      .sort((a, b) => (order === "bottom" ? value(a)! - value(b)! : value(b)! - value(a)!) || a.name.localeCompare(b.name))
      .slice(0, 5)
      .map((r) => ({ name: name(r), value: value(r), display: value(r)!.toFixed(1), tip: tipBox(r.college ? `${name(r)} · ${r.college}` : name(r), `${value(r)!.toFixed(1)}%${unit} · ${fmtInt(r.students)} students`) }));
  const orderSeg = (value: "top" | "bottom", onChange: (v: "top" | "bottom") => void) => <Seg label="Order" value={value} onChange={onChange} options={[["top", "Top 5"], ["bottom", "Bottom 5"]] as const} />;
  const firstText = (order: "top" | "bottom") => (order === "bottom" ? "Lowest first" : "Highest first");
  const selectGroup = (i: number, rows: { name: string }[]) => {
    if (!showColleges) return;
    const name = rows[i]?.name;
    if (name) change({ colleges: [name] });
  };

  /* ---- attendance cards ---- */
  const trendPoints = (trend.data?.points ?? []).map((p) => {
    const v = Math.floor((p.present * 1000) / p.scheduled) / 10;
    const label = format(new Date(`${p.week.slice(0, 10)}T00:00:00`), "d MMM");
    return { label, value: v, tip: tipBox(`Week of ${label}`, `${v.toFixed(1)}% · ${fmtInt(p.present)} of ${fmtInt(p.scheduled)} sessions`) };
  });
  const attRows = ranked(groups, (r) => r.attendance, attOrder, groupName, " attendance");
  const subjectAttRows = ranked(o?.subjects ?? [], (r) => r.attendance, subjectOrder, (r) => r.name, " attendance");
  const att = o?.attention[tab];
  const tabTier = TIER_ITEMS.find((x) => x.field === tab)!;

  /* ---- assessment cards ---- */
  const quizRankRows = ranked(groups, (r) => r[quizRank], quizRankOrder, groupName, ` ${QUIZ_NAME[quizRank]} avg`);
  const quizSubjectRows = ranked(o?.subjects ?? [], (r) => r[quizSubject], quizSubjectOrder, (r) => r.name, ` ${QUIZ_NAME[quizSubject]} avg`);

  const exportOverview = () => {
    if (!o) return;
    const rows: (string | number)[][] = [
      ["Total students", o.summary.students],
      ["Overall attendance % (present ÷ held)", o.summary.avgAttendance ?? ""],
      ["Eligible", o.summary.eligible],
      ["Recovery", o.summary.recovery],
      ["At risk", o.summary.atRisk],
      ["Ineligible", o.summary.ineligible],
      ["No sessions yet", o.summary.noSessions],
      ["Classroom Quiz avg %", o.assessment.classroom ?? ""],
      ["Module Quiz avg %", o.assessment.module ?? ""],
      ["Skill Assessment avg %", o.assessment.skill ?? ""],
      ...o.colleges.map((c) => [`College: ${c.name}`, `${c.students} students; attendance ${c.attendance ?? "–"}%; Classroom Quiz ${c.classroom ?? "–"}%; Module Quiz ${c.module ?? "–"}%; Skill Assessment ${c.skill ?? "–"}%`]),
    ];
    exportCsv("overview.csv", ["Measure", "Value"], rows);
  };

  return (
    <div className="flex min-w-0 flex-col">
      <PageHeader title="Overview" right={<ExportMenu disabled={!o} choices={[{ title: "This view", detail: "The cards and college figures for these filters", run: async () => exportOverview() }]} />} />

      <ScopeFilterBar
        campusOptions={opt?.colleges ?? []}
        campuses={filters.colleges}
        onCampuses={(colleges) => change({ colleges })}
        lockedCampus={lockedCampus}
        batchOptions={opt?.batches ?? []}
        batches={filters.batches}
        onBatches={(batches) => change({ batches })}
        term={filters.term}
        onTerm={(term) => change({ term })}
        moreCount={moreCount}
        onMore={() => {
          setDraft({ sections: filters.sections, subject: filters.subject });
          setMoreOpen(true);
        }}
        chips={chips}
        anyFilter={anyFilter}
        onClearAll={() => setFilters(NO_OVERVIEW_FILTERS)}
        updating={updating}
      />

      <MoreFiltersSheet
        open={moreOpen}
        onOpenChange={setMoreOpen}
        description="Narrow every card and chart on this page by section or subject."
        onReset={() => setDraft({ sections: [], subject: "" })}
        onApply={() => {
          change({ sections: draft.sections, subject: draft.subject });
          setMoreOpen(false);
        }}
      >
        <FilterField label="Section">
          <CheckMenu
            chevron
            className={fieldTrigger}
            label={draft.sections.length ? `${draft.sections.length} selected` : sectionChoices.length ? "All sections" : "Pick a college or batch first"}
            options={sectionChoices}
            selected={draft.sections}
            onChange={(next) => setDraft((d) => ({ ...d, sections: next }))}
          />
        </FilterField>
        <FilterField label="Subject">
          <select className={selectClass} value={draft.subject} onChange={(e) => setDraft((d) => ({ ...d, subject: e.target.value }))}>
            <option value="">{user?.subjects?.length ? "My subjects" : "All subjects"}</option>
            {(opt?.subjects ?? []).map((x) => (
              <option key={x} value={x}>{x}</option>
            ))}
          </select>
        </FilterField>
      </MoreFiltersSheet>

      {data.isError && !o ? (
        <ErrorState message="Failed to load the overview." onRetry={() => void data.refetch()} />
      ) : (
        <div aria-busy={updating} className={cn("flex flex-col gap-8 transition-opacity duration-200 motion-reduce:transition-none", updating && "opacity-60")}>
          {/* ---------------- Attendance ---------------- */}
          <section aria-labelledby="ov-attendance">
            <SectionTitle title="Attendance">
              <AttendanceCaption />
            </SectionTitle>
            <span id="ov-attendance" className="sr-only">Attendance</span>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              <Kpi label="Total students" value={fmtInt(s?.students ?? 0)} loading={loading} href={dirHref()} />
              <Kpi label="Overall attendance" value={pct(s?.avgAttendance)} loading={loading} href="/dashboard/attendance-stats" />
              {TIER_ITEMS.map((t) => (
                <Kpi key={t.key} label={t.label} value={fmtInt(s?.[t.field] ?? 0)} color={t.color} loading={loading} href={dirHref(t.key)} />
              ))}
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-12">
              <div className="min-w-0 xl:col-span-6">
                <Card
                  title="Attendance trend"
                  right={
                    <select aria-label="Trend period" className={cn(selectClass, "h-8 w-auto py-0 text-xs")} value={period} onChange={(e) => setPeriod(e.target.value as typeof period)}>
                      <option value="semester">Semester to date · weekly</option>
                      <option value="last30">Last 30 days · weekly</option>
                      <option value="last7">Last 7 days</option>
                    </select>
                  }
                >
                  {trend.isLoading ? <Skeleton className="h-56 w-full" /> : trendPoints.length === 0 ? <p className="my-auto py-10 text-center text-sm text-slate-500">No sessions in this period</p> : <Trend points={trendPoints} tip={tip.props as TipProps} label="Weekly attendance" format={(v) => `${v.toFixed(1)}%`} />}
                </Card>
              </div>
              <div className="min-w-0 xl:col-span-6">
                <Card
                  title="Attendance distribution"
                  footer={s && s.noSessions > 0 ? <span>{fmtInt(s.noSessions)} {s.noSessions === 1 ? "student has" : "students have"} no sessions yet</span> : undefined}
                >
                  {loading || !s ? <Skeleton className="h-56 w-full" /> : <Donut total={TIER_ITEMS.reduce((n, t) => n + s[t.field], 0)} items={TIER_ITEMS.map((t): DonutItem => ({ key: t.key, label: t.label, hint: t.hint, count: s[t.field], color: t.color }))} onSelect={(key) => go(dirHref(key))} />}
                </Card>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Card title={`${groupTitle} attendance`} right={orderSeg(attOrder, setAttOrder)} footer={<><span>{firstText(attOrder)}</span><ViewAll href={showColleges ? "/dashboard/attendance-stats" : "/dashboard/attendance-stats?group=university_section"} /></>}>
                {loading ? <Skeleton className="h-44 w-full" /> : <HBars rows={attRows} max={100} tip={tip.props} onSelect={(i) => selectGroup(i, attRows)} />}
              </Card>
              <Card title="Subject attendance" right={orderSeg(subjectOrder, setSubjectOrder)} footer={<><span>{firstText(subjectOrder)}</span><ViewAll href="/dashboard/attendance-stats?group=university_subject" /></>}>
                {loading ? <Skeleton className="h-44 w-full" /> : <HBars rows={subjectAttRows} max={100} tip={tip.props} onSelect={(i) => change({ subject: subjectAttRows[i]?.name ?? "" })} />}
              </Card>
            </div>

            <div className="mt-4">
              <Card
                title="Students requiring attention"
                right={
                  <div role="tablist" aria-label="Tier" className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
                    {([["atRisk", "At risk", o?.attention.atRisk.total], ["ineligible", "Ineligible", o?.attention.ineligible.total]] as const).map(([k, label, n]) => {
                      const t = TIER_ITEMS.find((x) => x.field === k)!;
                      return (
                        <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cn("inline-flex min-h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold", focusRing, tab === k ? "bg-white text-slate-900 shadow-sm" : "text-slate-500")}>
                          {label} <span className="rounded-full px-1.5 text-[11px] tabular-nums" style={{ background: t.bg, color: t.color }}>{n == null ? "" : fmtInt(n)}</span>
                        </button>
                      );
                    })}
                  </div>
                }
                footer={<><span>Lowest attendance first</span>{att && <ViewAll href={dirHref(tabTier.key)} label={`View all ${fmtInt(att.total)}`} />}</>}
              >
                {loading ? (
                  <Skeleton className="h-44 w-full" />
                ) : att && att.rows.length > 0 ? (
                  // Two columns on wide screens, so six students fit without a tall card.
                  <ul className="-mx-2 grid grid-cols-1 gap-x-6 md:grid-cols-2">
                    {att.rows.slice(0, 6).map((r) => (
                      <li key={r.studentId} className="border-b border-slate-100">
                        <button type="button" onClick={() => go(directoryHref({ tier: tabTier.key, q: r.studentId }))} className={cn("grid w-full grid-cols-[1fr_auto] items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-slate-50", focusRing)}>
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold text-slate-900">{r.name || "—"}</span>
                            <span className="block truncate text-xs text-slate-500">{r.college} · {r.section}</span>
                          </span>
                          <span className="rounded-full px-2.5 py-0.5 text-xs font-bold tabular-nums" style={{ color: tabTier.color, background: tabTier.bg }}>{r.attendancePct == null ? "–" : `${r.attendancePct}%`}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="my-auto py-8 text-center text-sm text-slate-500">No students in this group</p>
                )}
              </Card>
            </div>
          </section>

          {/* ---------------- Assessments ---------------- */}
          <section aria-labelledby="ov-assessments">
            <SectionTitle title="Assessments">
              <span className="text-xs text-slate-500">Average of course scores · a quiz not attempted counts as 0</span>
            </SectionTitle>
            <span id="ov-assessments" className="sr-only">Assessments</span>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
              <Kpi label="Classroom Quiz avg" value={pct(o?.assessment.classroom)} loading={loading} href="/dashboard/assessments?type=cq" />
              <Kpi label="Module Quiz avg" value={pct(o?.assessment.module)} loading={loading} href="/dashboard/assessments?type=mq" />
              <Kpi label="Skill Assessment avg" value={pct(o?.assessment.skill)} loading={loading} href="/dashboard/assessments?type=skill" />
              <SoonKpi label="FSA avg" />
              <SoonKpi label="SPI" />
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
              <Card
                title={`${groupTitle} assessment averages`}
                right={<><Seg label="Assessment" value={quizRank} onChange={(v) => setQuizRank(v as QuizMetric)} options={QUIZ_METRICS} />{orderSeg(quizRankOrder, setQuizRankOrder)}</>}
                footer={<><span>{QUIZ_NAME[quizRank]} · {firstText(quizRankOrder).toLowerCase()}</span><ViewAll href="/dashboard/assessments" /></>}
              >
                {loading ? <Skeleton className="h-44 w-full" /> : <HBars rows={quizRankRows} max={100} tip={tip.props} onSelect={(i) => selectGroup(i, quizRankRows)} />}
              </Card>
              <Card
                title="Subject assessment averages"
                right={<><Seg label="Assessment" value={quizSubject} onChange={(v) => setQuizSubject(v as QuizMetric)} options={QUIZ_METRICS} />{orderSeg(quizSubjectOrder, setQuizSubjectOrder)}</>}
                footer={<><span>{QUIZ_NAME[quizSubject]} · {firstText(quizSubjectOrder).toLowerCase()}</span><ViewAll href="/dashboard/assessments" /></>}
              >
                {loading ? <Skeleton className="h-44 w-full" /> : <HBars rows={quizSubjectRows} max={100} tip={tip.props} onSelect={(i) => change({ subject: quizSubjectRows[i]?.name ?? "" })} />}
              </Card>
            </div>
          </section>
        </div>
      )}
      {tip.layer}
    </div>
  );
}
