/* ------------------------------------------------------------------ */
/*  SPI Quiz analytics: who opened the report, took and finished the   */
/*  quick quiz, scores and times. All counts come from                 */
/*  GET /api/dashboard/spi-quiz; this page only displays them.         */
/* ------------------------------------------------------------------ */
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Download, SearchX, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { PageHeader } from "@/components/PageHeader";
import { MultiSelect } from "@/components/MultiSelect";
import { DateRangeFilter } from "@/components/DateRangeFilter";
import { Body, cell, Head, num, Pager } from "@/components/assessments/quiz/QuizTables";
import { Pill } from "@/components/assessments/quiz/quizParts";
import { ErrorState } from "@/components/PageStates";
import { Section, StatTile } from "@/components/dashboard/overview";
import { FOCUS_RING } from "@/components/assessments/parts";
import { useAuth } from "@/contexts/AuthContext";
import { exportCsv } from "@/lib/csv";
import type { DateRange } from "@/lib/dateRange";
import { cn } from "@/lib/utils";

const ROLES = ["superadmin", "admin", "hod", "capability_manager"];

/** not_started = never opened the report. */
type Status = "not_started" | "opened" | "started" | "completed";

interface GroupRow {
  name: string;
  students: number;
  opened: number;
  started: number;
  completed: number;
  avgScore: number | null;
}

interface StudentRow {
  studentId: string;
  name: string | null;
  college: string | null;
  semester: string | null;
  section: string | null;
  status: Status;
  score: number | null;
  totalQuestions: number | null;
  seconds: number | null;
  openedAt: string | null;
  finishedAt: string | null;
}

interface Analytics {
  totals: GroupRow & { avgSeconds: number | null; questionCount: number };
  groupBy: "college" | "section";
  groups: GroupRow[];
  scoreSpread: { score: number; students: number }[];
  questions: { id: string; position: number; topic: string; question: string; answered: number; correctPct: number | null; avgSeconds: number | null }[];
  students: { rows: StudentRow[]; total: number; page: number; pageSize: number; totalPages: number };
}

interface Option {
  college: string;
  semester: string;
  section: string;
}

type SortKey = "name" | "students" | "opened" | "completion" | "avgScore";

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()) as T;
}

const fmtInt = (n: number) => n.toLocaleString("en-IN");
const pct = (n: number, d: number) => (d ? (n / d) * 100 : 0);
const fmtPct = (n: number, d: number) => (d ? `${pct(n, d).toFixed(1)}%` : "–");
const fmtScore = (n: number | null) => (n == null ? "–" : n.toFixed(1));
function fmtTime(seconds: number | null): string {
  if (seconds == null) return "–";
  const s = Math.round(seconds);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}
const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "–";

const STATUS: Record<Status, { label: string; className: string }> = {
  completed: { label: "Completed", className: "bg-emerald-50 text-emerald-800 ring-emerald-200" },
  started: { label: "Started", className: "bg-amber-50 text-amber-800 ring-amber-200" },
  opened: { label: "Opened", className: "bg-slate-100 text-slate-700 ring-slate-200" },
  not_started: { label: "Not started", className: "bg-rose-50 text-rose-800 ring-rose-200" },
};
const STATUS_ORDER: Status[] = ["opened", "started", "completed", "not_started"];

/** "3 colleges" / the one name / nothing, for a filter chip. */
const chipText = (values: string[], noun: string) => (values.length === 1 ? values[0]! : `${values.length} ${noun}`);

/** A thin horizontal bar; `pct` is 0–100. */
function Bar({ pct: value, tone = "bg-brand-600" }: { pct: number; tone?: string }) {
  return (
    <span className="relative block h-2 w-full rounded-full bg-slate-100" aria-hidden="true">
      <span className={cn("absolute inset-y-0 left-0 rounded-full", tone)} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </span>
  );
}

/** A visible label above a filter control. */
function Field({ label, htmlFor, hint, children, className }: { label: string; htmlFor?: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-xs font-medium text-slate-600">
        {label}
      </label>
      {children}
      {hint}
    </div>
  );
}

/** Waits until typing stops before the value is used in a query. */
function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return settled;
}

export default function SpiQuizAnalytics() {
  const { user } = useAuth();
  const allowed = ROLES.includes(user?.role ?? "");
  const scoreId = useId();
  const [colleges, setColleges] = useState<string[]>([]);
  const [semesters, setSemesters] = useState<string[]>([]);
  const [sections, setSections] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<Status[]>([]);
  /** Colleges ticked in the College-wise table, for "Export selected". */
  const [picked, setPicked] = useState<string[]>([]);
  const [range, setRange] = useState<DateRange>({ dateFrom: "", dateTo: "" });
  const [scoreText, setScoreText] = useState("");
  const [includeTest, setIncludeTest] = useState(false);
  const [pageSize, setPageSize] = useState(50);
  const [exporting, setExporting] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "completion", desc: true });

  const score = useDebounced(scoreText.trim(), 400);

  const params = useMemo(() => {
    const p = new URLSearchParams();
    colleges.forEach((c) => p.append("college", c));
    semesters.forEach((s) => p.append("semester", s));
    if (colleges.length) sections.forEach((s) => p.append("section", s));
    statuses.forEach((s) => p.append("status", s));
    if (range.dateFrom) p.set("from", range.dateFrom);
    if (range.dateTo) p.set("to", range.dateTo);
    if (score) p.set("score", score);
    if (includeTest) p.set("test", "1");
    return p;
  }, [colleges, semesters, sections, statuses, range, score, includeTest]);
  const viewKey = `${params.toString()}|${pageSize}`;
  const [pageState, setPageState] = useState({ key: viewKey, page: 1 });
  const page = pageState.key === viewKey ? pageState.page : 1;

  const options = useQuery({
    queryKey: ["spi-quiz-options"],
    queryFn: () => getJson<{ options: Option[] }>("/api/dashboard/spi-quiz/options"),
    staleTime: 30 * 60_000,
    enabled: allowed,
  });
  const analytics = useQuery({
    queryKey: ["spi-quiz", viewKey, page],
    queryFn: () => getJson<Analytics>(`/api/dashboard/spi-quiz?${params.toString()}&page=${page}&pageSize=${pageSize}`),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    enabled: allowed,
  });

  const opts = options.data?.options ?? [];
  const collegeChoices = [...new Set(opts.map((o) => o.college))];
  const semesterChoices = [...new Set(opts.filter((o) => !colleges.length || colleges.includes(o.college)).map((o) => o.semester))].sort();
  const sectionChoices = [
    ...new Set(
      opts
        .filter((o) => colleges.includes(o.college) && (!semesters.length || semesters.includes(o.semester)))
        .map((o) => o.section),
    ),
  ];
  // Changing a parent filter drops choices that no longer exist, so no hidden filter stays on.
  const keepSections = (nextColleges: string[], nextSemesters: string[]) =>
    sections.filter((s) =>
      opts.some((o) => o.section === s && nextColleges.includes(o.college) && (!nextSemesters.length || nextSemesters.includes(o.semester))),
    );

  if (!allowed) {
    return (
      <div className="px-4 py-10 md:px-8">
        <ErrorState message="This page is for Super Admin, Admin, HOD and Capability Manager." />
      </div>
    );
  }

  const data = analytics.data ?? null;
  const updating = analytics.isPlaceholderData || (scoreText.trim() !== score);
  const t = data?.totals;
  const maxScore = t?.questionCount ?? 10;
  const scoreBad = scoreText.trim() !== "" && !/^\d{1,3}$/.test(scoreText.trim());
  const scoreTooHigh = !scoreBad && scoreText.trim() !== "" && Number(scoreText) > maxScore;

  const chips = [
    colleges.length > 0 && { label: chipText(colleges, "colleges"), clear: () => (setColleges([]), setSections([])) },
    semesters.length > 0 && { label: chipText(semesters, "semesters"), clear: () => (setSemesters([]), setSections([])) },
    colleges.length > 0 && sections.length > 0 && { label: `Section ${chipText(sections, "sections")}`, clear: () => setSections([]) },
    statuses.length > 0 && { label: chipText(statuses.map((s) => STATUS[s].label), "statuses"), clear: () => setStatuses([]) },
    (range.dateFrom || range.dateTo) && { label: `Opened ${range.dateFrom || "…"} to ${range.dateTo || "…"}`, clear: () => setRange({ dateFrom: "", dateTo: "" }) },
    score && { label: `Score = ${score}`, clear: () => setScoreText("") },
    includeTest && { label: "Test logins included", clear: () => setIncludeTest(false) },
  ].filter(Boolean) as { label: string; clear: () => void }[];
  const clearAll = () => {
    setColleges([]);
    setSemesters([]);
    setSections([]);
    setStatuses([]);
    setRange({ dateFrom: "", dateTo: "" });
    setScoreText("");
    setIncludeTest(false);
  };

  const funnel = t
    ? [
        { label: "All students", n: t.students },
        { label: "Opened report", n: t.opened },
        { label: "Started quiz", n: t.started },
        { label: "Completed", n: t.completed },
      ]
    : [];
  // Students who never came to the quiz at all (never opened the report).
  const notStarted = t ? Math.max(0, t.students - t.opened) : 0;
  const spread = t
    ? Array.from({ length: t.questionCount + 1 }, (_, s) => ({ score: s, students: data!.scoreSpread.find((x) => x.score === s)?.students ?? 0 }))
    : [];
  const spreadMax = Math.max(1, ...spread.map((s) => s.students));

  const sortValue = (g: GroupRow): number | string =>
    sort.key === "name" ? g.name.toLowerCase()
    : sort.key === "students" ? g.students
    : sort.key === "opened" ? g.opened
    : sort.key === "avgScore" ? (g.avgScore ?? -1)
    : g.students ? g.completed / g.students : -1;
  const groups = [...(data?.groups ?? [])].sort((a, b) => {
    const va = sortValue(a);
    const vb = sortValue(b);
    const cmp = typeof va === "string" ? va.localeCompare(vb as string) : va - (vb as number);
    return (sort.desc ? -cmp : cmp) || a.name.localeCompare(b.name);
  });
  const toggleSort = (key: SortKey) => setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: key !== "name" }));

  /** Every student for the current filters; `onlyColleges` swaps the college filter for the ticked ones. */
  const onExport = async (onlyColleges?: string[]) => {
    setExporting(true);
    try {
      const p = new URLSearchParams(params);
      if (onlyColleges) {
        p.delete("college");
        p.delete("section");
        onlyColleges.forEach((c) => p.append("college", c));
      }
      const all = await getJson<Analytics>(`/api/dashboard/spi-quiz?${p.toString()}&export=1`);
      exportCsv(
        `spi-quiz-${onlyColleges ? "colleges" : "students"}-${new Date().toISOString().slice(0, 10)}.csv`,
        ["Student ID", "Name", "College", "Semester", "Section", "Status", "Score", "Out of", "Time (s)", "Opened", "Finished"],
        all.students.rows.map((r) => [
          r.studentId,
          r.name ?? "",
          r.college ?? "",
          r.semester ?? "",
          r.section ?? "",
          STATUS[r.status].label,
          r.score ?? "",
          r.totalQuestions ?? "",
          r.seconds ?? "",
          r.openedAt ?? "",
          r.finishedAt ?? "",
        ]),
      );
    } finally {
      setExporting(false);
    }
  };

  const noMatch = data != null && data.students.total === 0;
  const emptyMessage = scoreTooHigh
    ? `No data. Scores go from 0 to ${maxScore}, so no student has ${scoreText.trim()}.`
    : score
      ? `No data. No student finished the quiz with a score of ${score} for these filters.`
      : chips.length
        ? "No data for these filters."
        : "No student has opened the report yet.";

  return (
    <div className="space-y-5 px-4 pb-10 md:px-8">
      <PageHeader
        title="SPI Quiz Analytics"
        subtitle="SPI quick quiz before the student report"
        right={
          <Button onClick={() => void onExport()} disabled={exporting || !data || noMatch}>
            <Download className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {exporting ? "Exporting…" : "Export CSV"}
          </Button>
        }
      />

      {/* Filters: labelled controls, active filters as removable chips. */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="College">
            <MultiSelect
              compact
              noun="colleges"
              placeholder="All colleges"
              options={collegeChoices}
              value={colleges}
              onChange={(next) => {
                setColleges(next);
                setSections(next.length ? keepSections(next, semesters) : []);
                setSemesters((cur) =>
                  cur.filter((s) => !next.length || opts.some((o) => o.semester === s && next.includes(o.college))),
                );
              }}
            />
          </Field>
          <Field label="Semester">
            <MultiSelect
              compact
              noun="semesters"
              placeholder="All semesters"
              options={semesterChoices}
              value={semesters}
              onChange={(next) => {
                setSemesters(next);
                setSections(keepSections(colleges, next));
              }}
            />
          </Field>
          <Field label="Section" hint={!colleges.length ? <span className="text-[11px] text-slate-500">Choose a college first</span> : undefined}>
            <MultiSelect compact noun="sections" placeholder="All sections" options={sectionChoices} value={sections} onChange={setSections} disabled={!colleges.length} />
          </Field>
          <Field label="Status" hint={<span className="text-[11px] text-slate-500">Students table and export</span>}>
            <MultiSelect
              compact
              noun="statuses"
              placeholder="All statuses"
              options={STATUS_ORDER}
              value={statuses}
              onChange={(next) => setStatuses(STATUS_ORDER.filter((s) => next.includes(s)))}
              labelFor={(s) => STATUS[s as Status].label}
            />
          </Field>
          <Field label="Report opened">
            <DateRangeFilter value={range} onChange={setRange} allDatesLabel="All dates" />
          </Field>
          <Field
            label="Quiz score"
            htmlFor={scoreId}
            hint={
              <span
                id={`${scoreId}-hint`}
                className={cn("text-[11px]", scoreBad || scoreTooHigh ? "text-amber-700" : "text-slate-500")}
                aria-live="polite"
              >
                {scoreBad ? "Enter a whole number" : scoreTooHigh ? `Scores go up to ${maxScore}` : `Exact score, 0–${maxScore}`}
              </span>
            }
          >
            <div className="relative">
              <Input
                id={scoreId}
                inputMode="numeric"
                placeholder="Any"
                value={scoreText}
                onChange={(e) => setScoreText(e.target.value.replace(/[^\d]/g, "").slice(0, 3))}
                aria-describedby={`${scoreId}-hint`}
                aria-invalid={scoreBad || scoreTooHigh}
                className="h-10 pr-8 tabular-nums"
              />
              {scoreText && (
                <button
                  type="button"
                  onClick={() => setScoreText("")}
                  aria-label="Clear quiz score"
                  className={cn("absolute right-1.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700", FOCUS_RING)}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </Field>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
          {chips.length === 0 ? (
            <span className="text-xs text-slate-500">No filters · all colleges, all dates</span>
          ) : (
            <>
              {chips.map((c) => (
                <span key={c.label} className="inline-flex items-center gap-1 rounded-full bg-brand-50 py-1 pl-3 pr-1 text-xs font-medium text-brand-900 ring-1 ring-brand-100">
                  {c.label}
                  <button type="button" onClick={c.clear} aria-label={`Remove filter ${c.label}`} className={cn("rounded-full p-0.5 hover:bg-brand-100", FOCUS_RING)}>
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
              <button type="button" onClick={clearAll} className={cn("text-xs font-medium text-brand-800 hover:underline", FOCUS_RING)}>
                Clear all
              </button>
            </>
          )}
          <label className="ml-auto flex cursor-pointer items-center gap-2 text-sm text-slate-600">
            <Switch checked={includeTest} onCheckedChange={setIncludeTest} />
            Show test logins
          </label>
        </div>
      </div>

      {analytics.isError && !data ? (
        <ErrorState onRetry={() => void analytics.refetch()} />
      ) : (
        <>
          {/* Headline numbers; the stage counts live in the funnel below. */}
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200 md:grid-cols-4">
            <StatTile
              label="Completed"
              value={t ? fmtInt(t.completed) : null}
              hint={t && `${fmtPct(t.completed, t.students)} of all students`}
              updating={updating}
            />
            <StatTile label="Average score" value={t ? `${fmtScore(t.avgScore)} / ${t.questionCount}` : null} hint="completed students" updating={updating} />
            <StatTile label="Average time" value={t ? fmtTime(t.avgSeconds) : null} hint="start to finish" updating={updating} />
            <StatTile label="Dropped midway" value={t ? fmtInt(t.started - t.completed) : null} hint="started, not finished" updating={updating} />
          </div>

          <div className="grid gap-5 xl:grid-cols-2">
            <Section title="Funnel" subtitle="each step out of all students" updating={updating} className="rounded-xl border">
              <ol className="space-y-4 p-5">
                {funnel.map((f, i) => {
                  const prev = i > 0 ? funnel[i - 1]!.n : null;
                  return (
                    <li key={f.label} className="grid grid-cols-[110px_1fr_auto] items-center gap-3 text-sm sm:grid-cols-[130px_1fr_170px]">
                      <span className="font-medium text-slate-800">{f.label}</span>
                      <span className="relative block h-7 rounded-md bg-brand-50" aria-hidden="true">
                        <span
                          className={cn("absolute inset-y-0 left-0 rounded-md", i === funnel.length - 1 ? "bg-brand-900" : "bg-brand-600")}
                          style={{ width: `${pct(f.n, t!.students)}%` }}
                        />
                      </span>
                      <span className="text-right tabular-nums">
                        <b className="text-slate-900">{fmtInt(f.n)}</b>{" "}
                        <span className="text-xs text-slate-500">
                          {fmtPct(f.n, t!.students)}
                          {prev != null && <span className="hidden sm:inline"> · {fmtPct(f.n, prev)} of previous</span>}
                        </span>
                      </span>
                    </li>
                  );
                })}
                {/* Never came to the quiz: shown apart from the steps above, as the students lost before step 2. */}
                {t && <li className="grid grid-cols-[110px_1fr_auto] items-center gap-3 border-t border-dashed border-slate-200 pt-4 text-sm sm:grid-cols-[130px_1fr_170px]">
                  <span className="font-medium text-slate-800">Not started quiz</span>
                  <span className="relative block h-7 rounded-md bg-rose-50" aria-hidden="true">
                    <span className="absolute inset-y-0 left-0 rounded-md bg-rose-400" style={{ width: `${pct(notStarted, t!.students)}%` }} />
                  </span>
                  <span className="text-right tabular-nums">
                    <b className="text-slate-900">{fmtInt(notStarted)}</b> <span className="text-xs text-slate-500">{fmtPct(notStarted, t.students)}</span>
                  </span>
                </li>}
              </ol>
            </Section>

            <Section
              title="Score spread"
              subtitle="completed students · click a bar to filter by that score"
              updating={updating}
              className="rounded-xl border"
            >
              <div className="p-5">
                <div className="flex h-44 items-end gap-1.5 border-b border-slate-200" role="group" aria-label="Students per quiz score">
                  {spread.map((s) => {
                    const selected = score !== "" && Number(score) === s.score;
                    const dim = score !== "" && !selected;
                    return (
                      <button
                        key={s.score}
                        type="button"
                        aria-pressed={selected}
                        aria-label={`Score ${s.score}: ${fmtInt(s.students)} students${selected ? ", selected" : ""}`}
                        title={`Score ${s.score}: ${fmtInt(s.students)} students`}
                        onClick={() => setScoreText(selected ? "" : String(s.score))}
                        className={cn("group flex h-full flex-1 flex-col items-center justify-end gap-1", FOCUS_RING)}
                      >
                        <span className={cn("text-[11px] tabular-nums", selected ? "font-semibold text-brand-900" : "text-slate-500")}>
                          {s.students ? fmtInt(s.students) : ""}
                        </span>
                        <span
                          className={cn(
                            "w-full rounded-t transition-colors duration-150",
                            selected ? "bg-brand-900" : dim ? "bg-brand-200 group-hover:bg-brand-400" : "bg-brand-600 group-hover:bg-brand-800",
                          )}
                          style={{ height: `${(s.students / spreadMax) * 100}%`, minHeight: s.students ? 2 : 0 }}
                        />
                      </button>
                    );
                  })}
                </div>
                <div className="mt-1.5 flex gap-1.5" aria-hidden="true">
                  {spread.map((s) => (
                    <span key={s.score} className="flex-1 text-center text-[11px] tabular-nums text-slate-500">
                      {s.score}
                    </span>
                  ))}
                </div>
                <p className="mt-1 text-center text-[11px] text-slate-500">Score out of {maxScore}</p>
              </div>
            </Section>
          </div>

          <div className="grid gap-5 xl:grid-cols-[3fr_2fr]">
            <Section
              title={data?.groupBy === "section" ? "Section-wise" : "College-wise"}
              subtitle={data?.groupBy === "college" ? "click a college to see its sections · tick colleges to export them" : undefined}
              action={
                data?.groupBy === "college" ? (
                  <div className="flex items-center gap-2">
                    {picked.length > 0 && (
                      <button type="button" onClick={() => setPicked([])} className={cn("text-xs font-medium text-brand-800 hover:underline", FOCUS_RING)}>
                        Clear
                      </button>
                    )}
                    <Button type="button" variant="outline" size="sm" disabled={picked.length === 0 || exporting} onClick={() => void onExport(picked)}>
                      <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                      Export selected{picked.length ? ` (${picked.length})` : ""}
                    </Button>
                  </div>
                ) : undefined
              }
              updating={updating}
              // xl: the row is as tall as Question-wise; the table fills it and scrolls, so no empty space is left below.
              className="rounded-xl border xl:flex xl:flex-col xl:[&>div:last-child]:relative xl:[&>div:last-child]:min-h-[440px] xl:[&>div:last-child]:flex-1"
            >
              <div className="max-h-[440px] overflow-auto xl:absolute xl:inset-0 xl:max-h-none">
                <table className="w-full text-left">
                  <Head
                    sticky
                    columns={[
                      ...(data?.groupBy === "college" ? [{ key: "pick", label: "", sortable: false }] : []),
                      { key: "name", label: data?.groupBy === "section" ? "Section" : "College" },
                      { key: "students", label: "Students", align: "right" },
                      { key: "opened", label: "Opened", align: "right" },
                      { key: "completion", label: "Completed", align: "right" },
                      { key: "avgScore", label: "Avg score", align: "right" },
                    ]}
                    sort={{ key: sort.key, dir: sort.desc ? "desc" : "asc" }}
                    onSort={(key) => toggleSort(key as SortKey)}
                  />
                  <Body loading={!data} empty="No data" colSpan={6} rowsCount={groups.length}>
                    {groups.map((g) => {
                      const clickable = data?.groupBy === "college";
                      return (
                        <tr key={g.name} className="hover:bg-slate-50">
                          {clickable && (
                            <td className={cn(cell, "w-8 pr-0")}>
                              <input
                                type="checkbox"
                                checked={picked.includes(g.name)}
                                onChange={(e) => setPicked((cur) => (e.target.checked ? [...cur, g.name] : cur.filter((n) => n !== g.name)))}
                                aria-label={`Select ${g.name} for export`}
                                className="h-4 w-4 cursor-pointer accent-brand-700"
                              />
                            </td>
                          )}
                          <td className={cn(cell, "max-w-[200px]")}>
                            {clickable ? (
                              <button
                                type="button"
                                onClick={() => (setColleges([g.name]), setSections([]))}
                                className={cn("block max-w-full truncate text-left font-medium text-brand-700 hover:underline", FOCUS_RING)}
                                title={g.name}
                              >
                                {g.name}
                              </button>
                            ) : (
                              <span className="block truncate font-medium text-slate-800" title={g.name}>
                                {g.name}
                              </span>
                            )}
                          </td>
                          <td className={num}>{fmtInt(g.students)}</td>
                          <td className={num}>{fmtInt(g.opened)}</td>
                          <td className={num} title={`${fmtInt(g.completed)} of ${fmtInt(g.students)} completed`}>
                            <Pill metric="completion" value={g.students ? Math.round(pct(g.completed, g.students) * 10) / 10 : null} />
                          </td>
                          <td className={cn(num, "font-semibold text-slate-900")}>{fmtScore(g.avgScore)}</td>
                        </tr>
                      );
                    })}
                  </Body>
                </table>
              </div>
            </Section>

            <Section title="Question-wise" subtitle="% answered correctly · hardest first" updating={updating} className="rounded-xl border">
              <ol className="divide-y divide-slate-100">
                {data?.questions.map((q) => (
                  <li key={q.id} className="grid grid-cols-[minmax(0,1fr)_minmax(80px,140px)_92px] items-center gap-3 px-5 py-2.5 text-sm" title={`${q.question}\n${fmtInt(q.answered)} answered`}>
                    <span className="min-w-0">
                      <span className="block truncate text-slate-800">
                        <span className="mr-1.5 text-[11px] font-semibold text-slate-500">Q{q.position}</span>
                        {q.topic || q.question}
                      </span>
                      <span className="text-[11px] text-slate-500">{fmtInt(q.answered)} answered · {fmtTime(q.avgSeconds)} avg</span>
                    </span>
                    <Bar pct={q.correctPct ?? 0} tone={q.correctPct != null && q.correctPct < 50 ? "bg-amber-500" : "bg-brand-600"} />
                    <span className="text-right tabular-nums">
                      <b className="text-slate-900">{q.correctPct == null ? "–" : `${Math.round(q.correctPct)}%`}</b>
                      {q.correctPct != null && q.correctPct < 50 && <span className="ml-1.5 rounded bg-amber-50 px-1.5 py-0.5 text-[10.5px] font-semibold text-amber-800">Hard</span>}
                    </span>
                  </li>
                ))}
              </ol>
            </Section>
          </div>

          <Section
            title="Students"
            subtitle={data ? `${fmtInt(data.students.total)} students${score ? ` with score ${score}` : ""}` : undefined}
            updating={updating}
            className="rounded-xl border"
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[46rem] text-left">
                <Head
                  columns={[
                    { key: "student", label: "Student" },
                    { key: "college", label: "College" },
                    { key: "semester", label: "Semester" },
                    { key: "section", label: "Section" },
                    { key: "status", label: "Status" },
                    { key: "score", label: "Score", align: "right" },
                    { key: "time", label: "Time", align: "right" },
                    { key: "finished", label: "Finished" },
                  ]}
                />
                {!noMatch && (
                  <Body loading={!data} empty="" colSpan={8} rowsCount={data?.students.rows.length ?? 0}>
                    {data?.students.rows.map((r) => (
                      <tr key={r.studentId} className="hover:bg-slate-50">
                        <td className={cell}>
                          <span className="block font-medium text-slate-900">{r.name ?? "–"}</span>
                          <span className="block font-mono text-[11px] text-slate-500">{r.studentId}</span>
                        </td>
                        <td className={cell}>{r.college ?? "–"}</td>
                        <td className={cell}>{r.semester ?? "–"}</td>
                        <td className={cell}>{r.section ?? "–"}</td>
                        <td className={cell}>
                          <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1", STATUS[r.status].className)}>{STATUS[r.status].label}</span>
                        </td>
                        <td className={cn(num, "font-semibold text-slate-900")}>{r.score == null ? "–" : `${r.score} / ${r.totalQuestions ?? t?.questionCount}`}</td>
                        <td className={num}>{fmtTime(r.seconds)}</td>
                        <td className={cell}>{fmtDate(r.finishedAt)}</td>
                      </tr>
                    ))}
                  </Body>
                )}
                <tbody>
                  {noMatch && (
                    <tr>
                      <td colSpan={8} className="px-4 py-12">
                        <div className="flex flex-col items-center gap-2 text-center">
                          <SearchX className="h-6 w-6 text-slate-400" aria-hidden="true" />
                          <p className="text-sm font-medium text-slate-800">{emptyMessage}</p>
                          {chips.length > 0 && (
                            <Button type="button" variant="outline" size="sm" onClick={clearAll}>
                              Clear filters
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {data && !noMatch && (
              <Pager page={data.students} unit="students" pageSize={pageSize} onPage={(p) => setPageState({ key: viewKey, page: p })} onPageSize={setPageSize} />
            )}
          </Section>
        </>
      )}
    </div>
  );
}
