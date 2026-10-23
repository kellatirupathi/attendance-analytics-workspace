/* ------------------------------------------------------------------ */
/*  SPI Quiz analytics: who opened the report, took and finished the   */
/*  quick quiz, scores and times. All counts come from                 */
/*  GET /api/dashboard/spi-quiz; this page only displays them.         */
/* ------------------------------------------------------------------ */
import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { PageHeader } from "@/components/PageHeader";
import { SearchableSelect } from "@/components/SearchableSelect";
import { DateRangeFilter } from "@/components/DateRangeFilter";
import { TablePagination } from "@/components/DataTable";
import { ErrorState } from "@/components/PageStates";
import { Section, StatTile, TileGrid } from "@/components/dashboard/overview";
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
  completed: { label: "Completed", className: "bg-emerald-50 text-emerald-700" },
  started: { label: "Started", className: "bg-amber-50 text-amber-700" },
  opened: { label: "Opened", className: "bg-slate-100 text-slate-600" },
};

/** A thin horizontal bar; `pct` is 0–100. */
function Bar({ pct: value, tone = "bg-brand-600" }: { pct: number; tone?: string }) {
  return (
    <span className="relative block h-2.5 w-full rounded bg-slate-100">
      <span className={cn("absolute inset-y-0 left-0 rounded-r", tone)} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </span>
  );
}

export default function SpiQuizAnalytics() {
  const { user } = useAuth();
  const allowed = ROLES.includes(user?.role ?? "");
  const [college, setCollege] = useState(ALL);
  const [semester, setSemester] = useState(ALL);
  const [section, setSection] = useState(ALL);
  const [range, setRange] = useState<DateRange>({ dateFrom: "", dateTo: "" });
  const [includeTest, setIncludeTest] = useState(false);
  const [pageSize, setPageSize] = useState(50);
  const [exporting, setExporting] = useState(false);

  const params = useMemo(() => {
    const p = new URLSearchParams();
    if (college !== ALL) p.set("college", college);
    if (semester !== ALL) p.set("semester", semester);
    if (college !== ALL && section !== ALL) p.set("section", section);
    if (range.dateFrom) p.set("from", range.dateFrom);
    if (range.dateTo) p.set("to", range.dateTo);
    if (includeTest) p.set("test", "1");
    return p;
  }, [college, semester, section, range, includeTest]);
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
  const updating = analytics.isPlaceholderData;
  const t = data?.totals;
  const funnel = t
    ? [
        { label: "All students", n: t.students },
        { label: "Opened report", n: t.opened },
        { label: "Started quiz", n: t.started },
        { label: "Completed", n: t.completed },
      ]
    : [];
  const spreadMax = Math.max(1, ...(data?.scoreSpread.map((s) => s.students) ?? [1]));
  const spread = t ? Array.from({ length: t.questionCount + 1 }, (_, score) => ({ score, students: data!.scoreSpread.find((s) => s.score === score)?.students ?? 0 })) : [];

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

  return (
    <div className="space-y-5 px-4 pb-10 md:px-8">
      <PageHeader title="SPI Quiz Analytics" subtitle="SPI quick quiz before the student report" />

      <div className="flex flex-wrap items-center gap-2">
        <SearchableSelect
          className="w-56"
          value={college}
          onValueChange={(v) => {
            setCollege(v);
            setSection(ALL);
          }}
          options={[{ value: ALL, label: "All colleges" }, ...colleges.map((c) => ({ value: c, label: c }))]}
        />
        <SearchableSelect
          className="w-44"
          value={semester}
          onValueChange={(v) => {
            setSemester(v);
            setSection(ALL);
          }}
          options={[{ value: ALL, label: "All semesters" }, ...semesters.map((s) => ({ value: s, label: s }))]}
        />
        <SearchableSelect
          className="w-44"
          value={section}
          onValueChange={setSection}
          disabled={college === ALL}
          options={[{ value: ALL, label: "All sections" }, ...sections.map((s) => ({ value: s, label: s }))]}
        />
        <DateRangeFilter value={range} onChange={setRange} allDatesLabel="All dates" />
        <label className="ml-auto flex items-center gap-2 text-sm text-slate-600">
          <Switch checked={includeTest} onCheckedChange={setIncludeTest} />
          Show test logins
        </label>
        <Button onClick={() => void onExport()} disabled={exporting || !data}>
          <Download className="mr-1.5 h-4 w-4" />
          {exporting ? "Exporting…" : "Export CSV"}
        </Button>
      </div>

      {analytics.isError && !data ? (
        <ErrorState onRetry={() => void analytics.refetch()} />
      ) : (
        <>
          <TileGrid>
            <StatTile label="All students" value={t ? fmtInt(t.students) : null} hint="current semester" updating={updating} />
            <StatTile label="Opened report" value={t ? fmtInt(t.opened) : null} hint={t && `${fmtPct(t.opened, t.students)} of all`} updating={updating} />
            <StatTile label="Started quiz" value={t ? fmtInt(t.started) : null} hint={t && `${fmtPct(t.started, t.opened)} of opened`} updating={updating} />
            <StatTile
              label="Completed"
              value={t ? fmtInt(t.completed) : null}
              hint={t && `${fmtPct(t.completed, t.opened)} of opened · ${fmtPct(t.completed, t.students)} of all`}
              updating={updating}
            />
            <StatTile label="Average score" value={t ? `${fmtScore(t.avgScore)} / ${t.questionCount}` : null} updating={updating} />
            <StatTile label="Average time" value={t ? fmtTime(t.avgSeconds) : null} hint="start to finish" updating={updating} />
            <StatTile label="Dropped midway" value={t ? fmtInt(t.started - t.completed) : null} hint="started, not finished" updating={updating} />
          </TileGrid>

          <div className="grid gap-5 xl:grid-cols-2">
            <Section title="Funnel" subtitle="out of all students" updating={updating}>
              <div className="space-y-3 p-5">
                {funnel.map((f, i) => (
                  <div key={f.label} className="grid grid-cols-[120px_1fr_150px] items-center gap-3 text-sm" title={`${f.label}: ${fmtInt(f.n)}`}>
                    <span className="text-brand-900">{f.label}</span>
                    <span className="relative block h-6 rounded bg-brand-50">
                      <span className="absolute inset-y-0 left-0 rounded-r bg-brand-600" style={{ width: `${pct(f.n, t!.students)}%` }} />
                    </span>
                    <span className="tabular-nums">
                      <b className="text-brand-900">{fmtInt(f.n)}</b>{" "}
                      <span className="text-xs text-slate-500">
                        {fmtPct(f.n, t!.students)}
                        {i > 0 && ` · −${fmtInt(funnel[i - 1]!.n - f.n)}`}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </Section>

            <Section title="Score spread" subtitle="completed students" updating={updating}>
              <div className="p-5">
                <div className="flex h-40 items-end gap-1.5 border-b border-slate-200">
                  {spread.map((s) => (
                    <div key={s.score} className="flex h-full flex-1 flex-col items-center justify-end gap-1" title={`Score ${s.score}: ${fmtInt(s.students)} students`}>
                      <span className="text-[10.5px] tabular-nums text-slate-500">{s.students ? fmtInt(s.students) : ""}</span>
                      <span className="w-full rounded-t bg-brand-600" style={{ height: `${(s.students / spreadMax) * 100}%` }} />
                    </div>
                  ))}
                </div>
                <div className="mt-1.5 flex gap-1.5">
                  {spread.map((s) => (
                    <span key={s.score} className="flex-1 text-center text-[11px] tabular-nums text-slate-500">
                      {s.score}
                    </span>
                  ))}
                </div>
              </div>
            </Section>
          </div>

          <div className="grid gap-5 xl:grid-cols-2">
            <Section
              title={data?.groupBy === "section" ? "Section-wise" : "College-wise"}
              subtitle={data?.groupBy === "college" ? "click a college to see its sections" : undefined}
              updating={updating}
            >
              <div className="max-h-[420px] overflow-y-auto p-5">
                <div className="grid grid-cols-[minmax(0,190px)_1fr_52px_100px_52px] gap-x-3 gap-y-2.5 text-sm">
                  <span className="text-[11px] text-slate-500">{data?.groupBy === "section" ? "Section" : "College"}</span>
                  <span className="col-span-2 text-[11px] text-slate-500">Completion · % of all</span>
                  <span className="col-span-2 text-[11px] text-slate-500">Avg score</span>
                  {data?.groups.map((g) => {
                    const clickable = data.groupBy === "college";
                    return (
                      <div
                        key={g.name}
                        className={cn("col-span-5 grid grid-cols-subgrid items-center", clickable && "cursor-pointer rounded hover:bg-slate-50")}
                        title={`${g.name}: ${fmtInt(g.completed)} of ${fmtInt(g.students)} completed · opened ${fmtInt(g.opened)} · avg ${fmtScore(g.avgScore)}`}
                        onClick={clickable ? () => (setCollege(g.name), setSection(ALL)) : undefined}
                      >
                        <span className="truncate text-brand-900">{g.name}</span>
                        <Bar pct={pct(g.completed, g.students)} />
                        <span className="text-right font-semibold tabular-nums text-brand-900">{fmtPct(g.completed, g.students)}</span>
                        <Bar pct={g.avgScore == null ? 0 : (g.avgScore / (t?.questionCount || 10)) * 100} tone="bg-brand-900" />
                        <span className="text-right font-semibold tabular-nums text-brand-900">{fmtScore(g.avgScore)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </Section>

            <Section title="Question-wise · % correct" subtitle="hardest first · avg time" updating={updating}>
              <div className="space-y-2.5 p-5">
                {data?.questions.map((q) => (
                  <div key={q.id} className="grid grid-cols-[minmax(0,220px)_1fr_90px] items-center gap-3 text-sm" title={`${q.question}\n${q.answered} answered`}>
                    <span className="truncate text-brand-900">
                      <span className="mr-1.5 text-[11px] text-slate-500">Q{q.position}</span>
                      {q.topic || q.question}
                    </span>
                    <Bar pct={q.correctPct ?? 0} />
                    <span className="text-right tabular-nums">
                      <b className="text-brand-900">{q.correctPct == null ? "–" : `${Math.round(q.correctPct)}%`}</b>{" "}
                      <span className="text-[11px] text-slate-500">{fmtTime(q.avgSeconds)}</span>
                    </span>
                  </div>
                ))}
              </div>
            </Section>
          </div>

          <Section title="Students" updating={updating}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-brand-50 text-left text-xs text-brand-900">
                  <tr>
                    {["Student", "College", "Semester", "Section", "Status", "Score", "Time", "Finished"].map((h) => (
                      <th key={h} className={cn("px-4 py-2.5 font-semibold", (h === "Score" || h === "Time") && "text-right")}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {data?.students.rows.map((r) => (
                    <tr key={r.studentId} className="border-t border-slate-100">
                      <td className="px-4 py-2.5 font-medium text-brand-600">{r.name ?? r.studentId}</td>
                      <td className="px-4 py-2.5">{r.college ?? "–"}</td>
                      <td className="px-4 py-2.5">{r.semester ?? "–"}</td>
                      <td className="px-4 py-2.5">{r.section ?? "–"}</td>
                      <td className="px-4 py-2.5">
                        <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", STATUS[r.status].className)}>{STATUS[r.status].label}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right">{r.score == null ? "–" : `${r.score} / ${r.totalQuestions ?? t?.questionCount}`}</td>
                      <td className="px-4 py-2.5 text-right">{fmtTime(r.seconds)}</td>
                      <td className="px-4 py-2.5">{fmtDate(r.finishedAt)}</td>
                    </tr>
                  ))}
                  {data && data.students.rows.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-10 text-center text-slate-500">
                        No students yet
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {data && (
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
