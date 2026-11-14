/* ------------------------------------------------------------------ */
/*  SPI Quiz analytics: who opened the quiz, took and finished the   */
/*  quick quiz, scores and times. All counts come from                 */
/*  GET /api/dashboard/spi-quiz; this page only displays them.         */
/* ------------------------------------------------------------------ */
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Download, Search, SearchX, X } from "lucide-react";
import { CheckMenu } from "@/components/SpiRecordFilterBar";
import { ExportMenu, FilterField, fieldTrigger, MoreFiltersSheet, ScopeFilterBar, type FilterChip, type ScopeBatch, type Term } from "@/components/ScopeFilters";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { PageHeader } from "@/components/PageHeader";
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

/** not_started = never opened the quiz. */
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
  totals: GroupRow & { avgSeconds: number | null; questionCount: number; notStarted: number; notSeen: number };
  groupBy: "college" | "section";
  groups: GroupRow[];
  scoreSpread: { score: number; students: number }[];
  questions: { id: string; position: number; topic: string; question: string; answered: number; correctPct: number | null; avgSeconds: number | null }[];
  students: { rows: StudentRow[]; total: number; page: number; pageSize: number; totalPages: number };
}

interface Option {
  college: string;
  batch: string;
  semester: string;
  section: string;
  ended: boolean;
  students: number;
}

/** More filters before Apply. */
interface Draft {
  sections: string[];
  statuses: Status[];
  range: DateRange;
  score: string;
  includeTest: boolean;
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
  started: { label: "Started, not finished", className: "bg-amber-50 text-amber-800 ring-amber-200" },
  opened: { label: "Opened, not started", className: "bg-slate-100 text-slate-700 ring-slate-200" },
  not_started: { label: "Not opened", className: "bg-rose-50 text-rose-800 ring-rose-200" },
};
const STATUS_ORDER: Status[] = ["not_started", "opened", "started", "completed"];

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
  /** "college\tbatch" keys. */
  const [batches, setBatches] = useState<string[]>([]);
  const [term, setTerm] = useState<Term>("");
  const [moreOpen, setMoreOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>({ sections: [], statuses: [], range: { dateFrom: "", dateTo: "" }, score: "", includeTest: false });
  const [sections, setSections] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<Status[]>([]);
  /** Colleges ticked in the College-wise table, for "Export selected". */
  const [picked, setPicked] = useState<string[]>([]);
  const [range, setRange] = useState<DateRange>({ dateFrom: "", dateTo: "" });
  const [scoreText, setScoreText] = useState("");
  const [studentText, setStudentText] = useState("");
  const [includeTest, setIncludeTest] = useState(false);
  const [pageSize, setPageSize] = useState(50);
  const [exporting, setExporting] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "completion", desc: true });

  const score = useDebounced(scoreText.trim(), 400);
  const student = useDebounced(studentText.trim(), 400);
  const studentId = useId();

  const params = useMemo(() => {
    const p = new URLSearchParams();
    colleges.forEach((c) => p.append("college", c));
    batches.forEach((b) => p.append("batch", b));
    if (term) p.set("term", term);
    if (colleges.length || batches.length) sections.forEach((s) => p.append("section", s));
    statuses.forEach((s) => p.append("status", s));
    if (range.dateFrom) p.set("from", range.dateFrom);
    if (range.dateTo) p.set("to", range.dateTo);
    if (score) p.set("score", score);
    if (student) p.set("student", student);
    if (includeTest) p.set("test", "1");
    return p;
  }, [colleges, batches, term, sections, statuses, range, score, student, includeTest]);
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
  /** One entry per batch: its students, and the semester most of them are on (ended when every one of them ended). */
  const batchChoices = useMemo<ScopeBatch[]>(() => {
    const byBatch = new Map<string, { campus: string; batch: string; ended: boolean; students: number; bySemester: Map<string, number> }>();
    for (const o of opts) {
      const key = `${o.college}\t${o.batch}`;
      const b = byBatch.get(key) ?? { campus: o.college, batch: o.batch, ended: true, students: 0, bySemester: new Map<string, number>() };
      b.students += o.students;
      if (!o.ended) b.ended = false;
      b.bySemester.set(o.semester, (b.bySemester.get(o.semester) ?? 0) + o.students);
      byBatch.set(key, b);
    }
    return [...byBatch.values()].map(({ bySemester, ...b }) => ({ ...b, semester: [...bySemester.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? "" }));
  }, [opts]);
  /** Sections of the colleges / batches picked (none until one is picked: a section name means little across colleges). */
  const sectionChoicesFor = (cols: string[], bats: string[]) =>
    [...new Set(opts.filter((o) => (cols.length || bats.length) && (!cols.length || cols.includes(o.college)) && (!bats.length || bats.includes(`${o.college}\t${o.batch}`))).map((o) => o.section))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const sectionChoices = sectionChoicesFor(colleges, batches);

  if (!allowed) {
    return (
      <div className="px-4 py-10 md:px-8">
        <ErrorState message="This page is for Super Admin, Admin, HOD and Capability Manager." />
      </div>
    );
  }

  const data = analytics.data ?? null;
  const updating = analytics.isPlaceholderData || scoreText.trim() !== score || studentText.trim() !== student;
  const t = data?.totals;
  const maxScore = t?.questionCount ?? 10;
  const scoreBad = scoreText.trim() !== "" && !/^\d{1,3}$/.test(scoreText.trim());
  const scoreTooHigh = !scoreBad && scoreText.trim() !== "" && Number(scoreText) > maxScore;

  const chips: FilterChip[] = [
    ...(sections.length ? [{ key: "section", label: `Section: ${chipText(sections, "sections")}`, clear: () => setSections([]) }] : []),
    ...(statuses.length ? [{ key: "status", label: `Status: ${chipText(statuses.map((s) => STATUS[s].label), "statuses")}`, clear: () => setStatuses([]) }] : []),
    ...(range.dateFrom || range.dateTo ? [{ key: "dates", label: `Quiz opened ${range.dateFrom || "…"} to ${range.dateTo || "…"}`, clear: () => setRange({ dateFrom: "", dateTo: "" }) }] : []),
    ...(score ? [{ key: "score", label: `Score = ${score}`, clear: () => setScoreText("") }] : []),
    ...(includeTest ? [{ key: "test", label: "Test logins included", clear: () => setIncludeTest(false) }] : []),
  ];
  const moreCount = (sections.length ? 1 : 0) + (statuses.length ? 1 : 0) + (range.dateFrom || range.dateTo ? 1 : 0) + (score ? 1 : 0) + (includeTest ? 1 : 0);
  const anyFilter = colleges.length > 0 || batches.length > 0 || term !== "" || studentText.trim() !== "" || chips.length > 0;
  const clearAll = () => {
    setColleges([]);
    setBatches([]);
    setTerm("");
    setSections([]);
    setStatuses([]);
    setRange({ dateFrom: "", dateTo: "" });
    setScoreText("");
    setStudentText("");
    setIncludeTest(false);
  };
  const openMore = () => {
    setDraft({ sections, statuses, range, score: scoreText.trim(), includeTest });
    setMoreOpen(true);
  };
  const draftScoreError = draft.score && !/^\d{1,3}$/.test(draft.score) ? "Enter a whole number." : draft.score && Number(draft.score) > maxScore ? `Scores go up to ${maxScore}.` : "";
  const draftDateError = draft.range.dateFrom && draft.range.dateTo && draft.range.dateFrom > draft.range.dateTo ? "From must be on or before To." : "";
  const applyMore = () => {
    if (draftScoreError || draftDateError) return;
    setSections(draft.sections);
    setStatuses(draft.statuses);
    setRange(draft.range);
    setScoreText(draft.score);
    setIncludeTest(draft.includeTest);
    setMoreOpen(false);
  };
  const exportGroups = async () => {
    const label = data?.groupBy === "section" ? "Section" : "College";
    exportCsv(
      `spi-quiz-${label.toLowerCase()}-wise-${new Date().toISOString().slice(0, 10)}.csv`,
      [label, "Students", "Opened quiz", "Started", "Completed", "Completed %", "Avg score"],
      groups.map((g) => [g.name, g.students, g.opened, g.started, g.completed, g.students ? Math.round(pct(g.completed, g.students) * 10) / 10 : "", g.avgScore == null ? "" : Math.round(g.avgScore * 10) / 10]),
    );
  };
  const funnel = t
    ? [
        { label: "All students", n: t.students },
        { label: "Opened quiz", n: t.opened },
        { label: "Started quiz", n: t.started },
        { label: "Completed quiz", n: t.completed },
      ]
    : [];
  // Students who never came to the quiz at all (never opened the quiz).
  const notStarted = t?.notStarted ?? 0;
  const notSeen = t?.notSeen ?? 0;
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
        ["Student ID", "Name", "College", "Semester", "Section", "Status", "Score", "Out of", "Time (s)", "Quiz opened", "Quiz finished"],
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
    : student
      ? `No student matches "${student}" for these filters.`
      : score
      ? `No data. No student finished the quiz with a score of ${score} for these filters.`
      : chips.length
        ? "No data for these filters."
        : "No student has opened the quiz yet.";

  return (
    <div className="space-y-5 px-4 pb-10 md:px-8">
      <PageHeader
        title="SPI Quiz Analytics"
        subtitle="SPI quick quiz before the student report"
        right={
          <ExportMenu
            disabled={!data}
            choices={[
              {
                title: "Students in these filters",
                detail: `One row per student (${data ? fmtInt(data.students.total) : "…"}): status, score, time, dates`,
                disabled: noMatch,
                run: () => onExport(),
              },
              {
                title: data?.groupBy === "section" ? "Section-wise table" : "College-wise table",
                detail: `${fmtInt(groups.length)} rows: students, opened, completed, average score`,
                disabled: groups.length === 0,
                run: exportGroups,
              },
            ]}
          />
        }
      />

      <ScopeFilterBar
        campusOptions={collegeChoices}
        campuses={colleges}
        onCampuses={(next) => {
          setColleges(next);
          const keptBatches = next.length ? batches.filter((b) => next.includes(b.split("\t")[0]!)) : batches;
          setBatches(keptBatches);
          setSections((cur) => cur.filter((x) => sectionChoicesFor(next, keptBatches).includes(x)));
        }}
        batchOptions={batchChoices}
        batches={batches}
        onBatches={(next) => {
          setBatches(next);
          setSections((cur) => cur.filter((x) => sectionChoicesFor(colleges, next).includes(x)));
        }}
        term={term}
        onTerm={setTerm}
        moreCount={moreCount}
        onMore={openMore}
        chips={chips}
        anyFilter={anyFilter}
        onClearAll={clearAll}
        extra={
          <FilterField label="Student (table and export)">
            <span className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <Input
                id={studentId}
                type="search"
                placeholder="Name or ID"
                value={studentText}
                onChange={(e) => setStudentText(e.target.value.slice(0, 100))}
                className="h-10 border-slate-300 pl-9 pr-8 [&::-webkit-search-cancel-button]:hidden"
              />
              {studentText && (
                <button
                  type="button"
                  onClick={() => setStudentText("")}
                  aria-label="Clear student search"
                  className={cn("absolute right-1.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700", FOCUS_RING)}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </span>
          </FilterField>
        }
      />

      <MoreFiltersSheet
        open={moreOpen}
        onOpenChange={setMoreOpen}
        description="Narrow the counts, charts and table by section, quiz status, the day the quiz was opened, or score."
        onReset={() => setDraft({ sections: [], statuses: [], range: { dateFrom: "", dateTo: "" }, score: "", includeTest: false })}
        onApply={applyMore}
        applyDisabled={Boolean(draftScoreError || draftDateError)}
      >
        <FilterField label="Section">
          <CheckMenu
            chevron
            className={fieldTrigger}
            label={draft.sections.length ? `${draft.sections.length} selected` : sectionChoices.length ? "All sections" : "Pick a college or batch first"}
            options={sectionChoices.map((name) => ({ id: name, label: name }))}
            selected={draft.sections}
            onChange={(next) => setDraft((d) => ({ ...d, sections: next }))}
          />
        </FilterField>
        <FilterField label="Status (table and export)">
          <CheckMenu
            chevron
            className={fieldTrigger}
            label={draft.statuses.length ? chipText(draft.statuses.map((x) => STATUS[x].label), "statuses") : "All statuses"}
            options={STATUS_ORDER.map((x) => ({ id: x, label: STATUS[x].label }))}
            selected={draft.statuses}
            onChange={(next) => setDraft((d) => ({ ...d, statuses: STATUS_ORDER.filter((x) => next.includes(x)) }))}
          />
        </FilterField>
        <div className="flex flex-col gap-1.5 text-xs font-medium text-slate-600">
          Quiz opened on
          <DateRangeFilter value={draft.range} onChange={(next) => setDraft((d) => ({ ...d, range: next }))} allDatesLabel="All dates" />
          {draftDateError && <p className="font-medium text-red-700" role="alert">{draftDateError}</p>}
        </div>
        <FilterField label="Quiz score (exact)">
          <Input
            id={scoreId}
            inputMode="numeric"
            placeholder={`0–${maxScore}`}
            value={draft.score}
            onChange={(e) => setDraft((d) => ({ ...d, score: e.target.value.replace(/[^\d]/g, "").slice(0, 3) }))}
            aria-invalid={Boolean(draftScoreError)}
            className="h-10 tabular-nums"
          />
          {draftScoreError && <span className="font-medium text-red-700" role="alert">{draftScoreError}</span>}
        </FilterField>
        <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-700">
          Show test logins
          <Switch checked={draft.includeTest} onCheckedChange={(on) => setDraft((d) => ({ ...d, includeTest: on }))} />
        </label>
      </MoreFiltersSheet>

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
                {/* Click a row to list those students (sets the Status filter). */}
                {t &&
                  [
                    { label: "Did not open quiz", n: notStarted, statuses: ["not_started"] as Status[] },
                    { label: "Report not seen yet", n: notSeen, statuses: ["not_started", "opened", "started"] as Status[] },
                  ].map((r, i) => (
                    <li key={r.label} className={cn("text-sm", i === 0 && "border-t border-dashed border-slate-200 pt-4")}>
                      <button
                        type="button"
                        onClick={() => setStatuses(r.statuses)}
                        title="Show these students in the table"
                        className={cn("grid w-full grid-cols-[110px_1fr_auto] items-center gap-3 rounded-md text-left sm:grid-cols-[130px_1fr_170px]", FOCUS_RING)}
                      >
                        <span className="font-medium text-slate-800">{r.label}</span>
                        <span className="relative block h-7 rounded-md bg-rose-50" aria-hidden="true">
                          <span className="absolute inset-y-0 left-0 rounded-md bg-rose-400" style={{ width: `${pct(r.n, t.students)}%` }} />
                        </span>
                        <span className="text-right tabular-nums">
                          <b className="text-slate-900">{fmtInt(r.n)}</b> <span className="text-xs text-slate-500">{fmtPct(r.n, t.students)}</span>
                        </span>
                      </button>
                    </li>
                  ))}
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
                      { key: "opened", label: "Opened quiz", align: "right" },
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
