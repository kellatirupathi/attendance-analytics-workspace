/* ------------------------------------------------------------------ */
/*  SPI Quiz analytics: who opened the report, took and finished the   */
/*  quick quiz, scores and times. All counts come from                 */
/*  GET /api/dashboard/spi-quiz; this page only displays them.         */
/* ------------------------------------------------------------------ */
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ChevronsUpDown, Download, SearchX, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { PageHeader } from "@/components/PageHeader";
import { SearchableSelect } from "@/components/SearchableSelect";
import { DateRangeFilter } from "@/components/DateRangeFilter";
import { TablePagination } from "@/components/DataTable";
import { ErrorState } from "@/components/PageStates";
import { Section, StatTile } from "@/components/dashboard/overview";
import { FOCUS_RING } from "@/components/assessments/parts";
import { useAuth } from "@/contexts/AuthContext";
import { exportCsv } from "@/lib/csv";
import type { DateRange } from "@/lib/dateRange";
import { cn } from "@/lib/utils";

const ALL = "__all__";
const ROLES = ["superadmin", "admin", "hod", "capability_manager"];

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
  status: "opened" | "started" | "completed";
  score: number | null;
  totalQuestions: number | null;
  seconds: number | null;
  openedAt: string;
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

const STATUS: Record<StudentRow["status"], { label: string; className: string }> = {
  completed: { label: "Completed", className: "bg-emerald-50 text-emerald-800 ring-emerald-200" },
  started: { label: "Started", className: "bg-amber-50 text-amber-800 ring-amber-200" },
  opened: { label: "Opened", className: "bg-slate-100 text-slate-700 ring-slate-200" },
};

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
  const [college, setCollege] = useState(ALL);
  const [semester, setSemester] = useState(ALL);
  const [section, setSection] = useState(ALL);
  const [range, setRange] = useState<DateRange>({ dateFrom: "", dateTo: "" });
  const [scoreText, setScoreText] = useState("");
  const [includeTest, setIncludeTest] = useState(false);
  const [pageSize, setPageSize] = useState(50);
  const [exporting, setExporting] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "completion", desc: true });

  const score = useDebounced(scoreText.trim(), 400);

  const params = useMemo(() => {
    const p = new URLSearchParams();
    if (college !== ALL) p.set("college", college);
    if (semester !== ALL) p.set("semester", semester);
    if (college !== ALL && section !== ALL) p.set("section", section);
    if (range.dateFrom) p.set("from", range.dateFrom);
    if (range.dateTo) p.set("to", range.dateTo);
    if (score) p.set("score", score);
    if (includeTest) p.set("test", "1");
    return p;
  }, [college, semester, section, range, score, includeTest]);
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
  const colleges = [...new Set(opts.map((o) => o.college))];
  const semesters = [...new Set(opts.filter((o) => college === ALL || o.college === college).map((o) => o.semester))].sort();
  const sections = [
    ...new Set(opts.filter((o) => o.college === college && (semester === ALL || o.semester === semester)).map((o) => o.section)),
  ];

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
    college !== ALL && { label: college, clear: () => (setCollege(ALL), setSection(ALL)) },
    semester !== ALL && { label: semester, clear: () => (setSemester(ALL), setSection(ALL)) },
    college !== ALL && section !== ALL && { label: `Section ${section}`, clear: () => setSection(ALL) },
    (range.dateFrom || range.dateTo) && { label: `Opened ${range.dateFrom || "…"} to ${range.dateTo || "…"}`, clear: () => setRange({ dateFrom: "", dateTo: "" }) },
    score && { label: `Score = ${score}`, clear: () => setScoreText("") },
    includeTest && { label: "Test logins included", clear: () => setIncludeTest(false) },
  ].filter(Boolean) as { label: string; clear: () => void }[];
  const clearAll = () => {
    setCollege(ALL);
    setSemester(ALL);
    setSection(ALL);
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

  const onExport = async () => {
    setExporting(true);
    try {
      const all = await getJson<Analytics>(`/api/dashboard/spi-quiz?${params.toString()}&export=1`);
      exportCsv(
        `spi-quiz-students-${new Date().toISOString().slice(0, 10)}.csv`,
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
          r.openedAt,
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
      <PageHeader title="SPI Quiz Analytics" subtitle="SPI quick quiz before the student report" />

      {/* Filters: labelled controls, active filters as removable chips. */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto_140px]">
          <Field label="College">
            <SearchableSelect
              value={college}
              onValueChange={(v) => {
                setCollege(v);
                setSection(ALL);
              }}
              options={[{ value: ALL, label: "All colleges" }, ...colleges.map((c) => ({ value: c, label: c }))]}
            />
          </Field>
          <Field label="Semester">
            <SearchableSelect
              value={semester}
              onValueChange={(v) => {
                setSemester(v);
                setSection(ALL);
              }}
              options={[{ value: ALL, label: "All semesters" }, ...semesters.map((s) => ({ value: s, label: s }))]}
            />
          </Field>
          <Field label="Section" hint={college === ALL ? <span className="text-[11px] text-slate-500">Choose a college first</span> : undefined}>
            <SearchableSelect
              value={section}
              onValueChange={setSection}
              disabled={college === ALL}
              options={[{ value: ALL, label: "All sections" }, ...sections.map((s) => ({ value: s, label: s }))]}
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
          <Button onClick={() => void onExport()} disabled={exporting || !data || noMatch}>
            <Download className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {exporting ? "Exporting…" : "Export CSV"}
          </Button>
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

          <div className="grid gap-5 xl:grid-cols-2">
            <Section
              title={data?.groupBy === "section" ? "Section-wise" : "College-wise"}
              subtitle={data?.groupBy === "college" ? "click a college to see its sections" : undefined}
              updating={updating}
              className="rounded-xl border"
            >
              <div className="max-h-[440px] overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10 bg-slate-50 text-left text-xs text-slate-600">
                    <tr>
                      {(
                        [
                          ["name", data?.groupBy === "section" ? "Section" : "College", ""],
                          ["students", "Students", "text-right"],
                          ["opened", "Opened", "text-right"],
                          ["completion", "Completed", ""],
                          ["avgScore", "Avg score", "text-right"],
                        ] as [SortKey, string, string][]
                      ).map(([key, label, align]) => {
                        const active = sort.key === key;
                        const Icon = !active ? ChevronsUpDown : sort.desc ? ArrowDown : ArrowUp;
                        return (
                          <th key={key} scope="col" aria-sort={active ? (sort.desc ? "descending" : "ascending") : "none"} className={cn("px-4 py-2.5 font-semibold", align)}>
                            <button type="button" onClick={() => toggleSort(key)} className={cn("inline-flex items-center gap-1 hover:text-slate-900", FOCUS_RING)}>
                              {label}
                              <Icon className={cn("h-3 w-3", active ? "text-brand-700" : "text-slate-400")} aria-hidden="true" />
                            </button>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody className="tabular-nums">
                    {groups.map((g) => {
                      const clickable = data?.groupBy === "college";
                      return (
                        <tr key={g.name} className={cn("border-t border-slate-100", clickable && "hover:bg-slate-50")}>
                          <td className="max-w-[220px] px-4 py-2.5">
                            {clickable ? (
                              <button
                                type="button"
                                onClick={() => (setCollege(g.name), setSection(ALL))}
                                className={cn("block max-w-full truncate text-left font-medium text-brand-800 hover:underline", FOCUS_RING)}
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
                          <td className="px-4 py-2.5 text-right text-slate-700">{fmtInt(g.students)}</td>
                          <td className="px-4 py-2.5 text-right text-slate-700">{fmtInt(g.opened)}</td>
                          <td className="min-w-[150px] px-4 py-2.5" title={`${fmtInt(g.completed)} of ${fmtInt(g.students)} completed`}>
                            <span className="flex items-center gap-2">
                              <Bar pct={pct(g.completed, g.students)} />
                              <span className="w-12 shrink-0 text-right font-semibold text-slate-900">{fmtPct(g.completed, g.students)}</span>
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-right font-semibold text-slate-900">{fmtScore(g.avgScore)}</td>
                        </tr>
                      );
                    })}
                    {data && groups.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                          No data
                        </td>
                      </tr>
                    )}
                  </tbody>
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
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs text-slate-600">
                  <tr>
                    {["Student", "College", "Semester", "Section", "Status", "Score", "Time", "Finished"].map((h) => (
                      <th key={h} scope="col" className={cn("px-4 py-2.5 font-semibold", (h === "Score" || h === "Time") && "text-right")}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {data?.students.rows.map((r) => (
                    <tr key={r.studentId} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-2.5">
                        <span className="block font-medium text-slate-900">{r.name ?? "–"}</span>
                        <span className="block font-mono text-[11px] text-slate-500">{r.studentId}</span>
                      </td>
                      <td className="px-4 py-2.5 text-slate-700">{r.college ?? "–"}</td>
                      <td className="px-4 py-2.5 text-slate-700">{r.semester ?? "–"}</td>
                      <td className="px-4 py-2.5 text-slate-700">{r.section ?? "–"}</td>
                      <td className="px-4 py-2.5">
                        <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1", STATUS[r.status].className)}>{STATUS[r.status].label}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right font-semibold text-slate-900">{r.score == null ? "–" : `${r.score} / ${r.totalQuestions ?? t?.questionCount}`}</td>
                      <td className="px-4 py-2.5 text-right text-slate-700">{fmtTime(r.seconds)}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-slate-700">{fmtDate(r.finishedAt)}</td>
                    </tr>
                  ))}
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
              <TablePagination
                page={data.students.page}
                totalPages={data.students.totalPages}
                totalItems={data.students.total}
                pageSize={pageSize}
                onPageChange={(p) => setPageState({ key: viewKey, page: p })}
                onPageSizeChange={setPageSize}
                itemLabel="students"
              />
            )}
          </Section>
        </>
      )}
    </div>
  );
}
