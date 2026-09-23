import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { AlertTriangle, Download, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { exportCsv } from "@/lib/csv";
import { useQueryParams } from "@/hooks/useQueryParams";
import { cn } from "@/lib/utils";

type Band = "good" | "recovery" | "at_risk";

interface SummaryRow {
  university: string;
  overallAttendancePct: number;
  subject: string;
  attendancePct: number;
  good: number;
  recovery: number;
  atRisk: number;
}

interface SummaryResponse {
  fromDate: string | null;
  toDate: string;
  campuses: string[];
  rows: SummaryRow[];
}

interface StudentRow {
  name: string;
  userId: string;
  batch: string;
  section: string;
  attendancePct: number;
}

const BANDS: { id: Band; label: string }[] = [
  { id: "good", label: "Good" },
  { id: "recovery", label: "Recovery" },
  { id: "at_risk", label: "At Risk" },
];

function istToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
  }).format(new Date());
}

function shiftDate(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function monthStart(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

function formatLong(iso: string | null): string {
  if (!iso) return "Earliest";
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1));
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function statusOf(pct: number): Band {
  if (pct >= 80) return "good";
  if (pct >= 50) return "recovery";
  return "at_risk";
}

function pctClass(pct: number): string {
  if (pct >= 80) return "text-emerald-700";
  if (pct >= 50) return "text-amber-700";
  return "text-red-700";
}

function countText(value: number): string {
  return value === 0 ? "–" : String(value);
}

function needsWarning(subject: string, pct: number): boolean {
  return pct === 0 || subject === "Unmapped" || subject.endsWith("Quizzes");
}

function listParam(params: URLSearchParams, key: string): string[] {
  return params.getAll(key).map((item) => item.trim()).filter(Boolean);
}

function CampusMultiSelect({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string[];
  onChange: (value: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const shown = options.filter((name) =>
    name.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const label =
    value.length === 0
      ? "All campuses"
      : value.length === 1
        ? value[0]
        : `${value.length} campuses`;

  return (
    <div className="relative min-w-[220px]">
      <Button
        type="button"
        variant="outline"
        className="w-full justify-between"
        onClick={() => setOpen((current) => !current)}
      >
        <span className="truncate">{label}</span>
      </Button>
      {open && (
        <div className="absolute z-20 mt-1 w-full rounded-md border border-slate-200 bg-white p-2 shadow-lg">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search campuses"
            className="mb-2"
          />
          <div className="mb-2 flex gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => onChange([...options])}>
              Select all
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => onChange([])}>
              Clear
            </Button>
          </div>
          <div className="max-h-56 space-y-1 overflow-auto">
            {shown.map((name) => (
              <label key={name} className="flex items-center gap-2 px-1 py-1 text-sm">
                <input
                  type="checkbox"
                  checked={value.includes(name)}
                  onChange={() =>
                    onChange(
                      value.includes(name)
                        ? value.filter((item) => item !== name)
                        : [...value, name],
                    )
                  }
                />
                <span className="truncate">{name}</span>
              </label>
            ))}
            {shown.length === 0 && (
              <p className="px-1 py-2 text-sm text-slate-500">No campuses</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function AttendanceSummary() {
  const params = useQueryParams();
  const [, setLocation] = useLocation();
  const today = istToday();
  const appliedFrom = params.get("from") ?? "";
  const appliedTo = params.get("to") || today;
  const appliedCampuses = listParam(params, "campuses");
  const selectedSubjects = listParam(params, "subjects");
  const selectedStatuses = listParam(params, "statuses");
  const activeStatuses: Band[] = selectedStatuses.includes("none")
    ? []
    : selectedStatuses.length === 0
      ? ["good", "recovery", "at_risk"]
      : (selectedStatuses.filter((item) =>
          BANDS.some((band) => band.id === item),
        ) as Band[]);

  const [fromDraft, setFromDraft] = useState(appliedFrom);
  const [toDraft, setToDraft] = useState(appliedTo);
  const [campusDraft, setCampusDraft] = useState(appliedCampuses);
  const [data, setData] = useState<SummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [panel, setPanel] = useState<{
    campus: string;
    subject: string;
    band: Band;
  } | null>(null);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [studentsLoading, setStudentsLoading] = useState(false);
  const [studentQuery, setStudentQuery] = useState("");

  useEffect(() => {
    setFromDraft(appliedFrom);
    setToDraft(appliedTo);
    setCampusDraft(appliedCampuses);
  }, [appliedFrom, appliedTo, appliedCampuses.join("|")]);

  useEffect(() => {
    const controller = new AbortController();
    const search = new URLSearchParams();
    if (appliedFrom) search.set("from", appliedFrom);
    search.set("to", appliedTo);
    for (const campus of appliedCampuses) search.append("campuses", campus);
    setLoading(true);
    setError("");
    fetch(`/api/dashboard/attendance-summary?${search}`, {
      credentials: "include",
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error || "Failed to load attendance summary");
        }
        return res.json() as Promise<SummaryResponse>;
      })
      .then((body) => {
        if (!controller.signal.aborted) setData(body);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setData(null);
        setError(err instanceof Error ? err.message : "Failed to load attendance summary");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [appliedFrom, appliedTo, appliedCampuses.join("|")]);

  function writeParams(next: {
    from?: string;
    to?: string;
    campuses?: string[];
    subjects?: string[];
    statuses?: Band[];
  }) {
    const search = new URLSearchParams();
    const from = next.from ?? appliedFrom;
    const to = next.to ?? appliedTo;
    const campuses = next.campuses ?? appliedCampuses;
    const subjects = next.subjects ?? selectedSubjects;
    const statuses = next.statuses ?? activeStatuses;
    if (from) search.set("from", from);
    if (to) search.set("to", to);
    for (const campus of campuses) search.append("campuses", campus);
    for (const subject of subjects) search.append("subjects", subject);
    if (statuses.length === 0) search.append("statuses", "none");
    else if (statuses.length < 3) {
      for (const status of statuses) search.append("statuses", status);
    }
    const query = search.toString();
    setLocation(
      query
        ? `/dashboard/reports/attendance-summary?${query}`
        : "/dashboard/reports/attendance-summary",
    );
  }

  const dateError =
    toDraft > today
      ? "To date cannot be in the future"
      : fromDraft && fromDraft > toDraft
        ? "From date cannot be after To date"
        : "";

  const subjectOptions = useMemo(() => {
    const names = new Set((data?.rows ?? []).map((row) => row.subject));
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [data]);

  const visibleRows = useMemo(() => {
    const subjects =
      selectedSubjects.length === 0 ? null : new Set(selectedSubjects);
    const statuses = new Set(activeStatuses);
    return (data?.rows ?? []).filter((row) => {
      if (subjects && !subjects.has(row.subject)) return false;
      return statuses.has(statusOf(row.attendancePct));
    });
  }, [data, selectedSubjects, activeStatuses]);

  const blocks = useMemo(() => {
    const grouped = new Map<string, { overall: number; rows: SummaryRow[] }>();
    for (const row of visibleRows) {
      const block = grouped.get(row.university) ?? {
        overall: row.overallAttendancePct,
        rows: [],
      };
      block.rows.push(row);
      grouped.set(row.university, block);
    }
    return [...grouped.entries()];
  }, [visibleRows]);

  const summaryLine = [
    `${formatLong(appliedFrom || null)} – ${formatLong(appliedTo)}`,
    appliedCampuses.length === 0
      ? `${data?.campuses.length ?? 0} campuses`
      : `${appliedCampuses.length} campuses`,
    selectedSubjects.length === 0
      ? "All subjects"
      : `${selectedSubjects.length} subjects`,
    activeStatuses.length === 3
      ? "All statuses"
      : activeStatuses
          .map((id) => BANDS.find((band) => band.id === id)?.label)
          .filter(Boolean)
          .join(", "),
  ].join(" · ");

  function exportReport() {
    exportCsv(
      "attendance-summary.csv",
      [
        "from_date",
        "to_date",
        "university",
        "overall_attendance_pct",
        "subject",
        "attendance_pct",
        "good",
        "recovery",
        "at_risk",
      ],
      visibleRows.map((row) => [
        appliedFrom,
        appliedTo,
        row.university,
        row.overallAttendancePct.toFixed(2),
        row.subject,
        row.attendancePct.toFixed(2),
        row.good,
        row.recovery,
        row.atRisk,
      ]),
    );
  }

  function exportPdf() {
    const sections = blocks
      .map(([campus, block], index) => {
        const body = block.rows
          .map(
            (row) =>
              `<tr><td>${escapeHtml(row.subject)}</td><td>${row.attendancePct.toFixed(2)}%</td><td>${countText(row.good)}</td><td>${countText(row.recovery)}</td><td>${countText(row.atRisk)}</td></tr>`,
          )
          .join("");
        return `<h2>${index + 1}. ${escapeHtml(campus)}</h2><p>Overall Attendance: ${block.overall.toFixed(2)}%</p><table><thead><tr><th>Subject</th><th>Att.</th><th>Good</th><th>Recovery</th><th>At Risk</th></tr></thead><tbody>${body}</tbody></table>`;
      })
      .join("");
    const popup = window.open("", "_blank", "noopener,noreferrer");
    if (!popup) return;
    popup.document.write(
      `<!doctype html><html><head><title>Attendance Summary</title><style>body{font-family:sans-serif;padding:24px}table{border-collapse:collapse;width:100%;margin-bottom:24px}td,th{border:1px solid #ccc;padding:6px;text-align:left}h2{margin-bottom:4px}</style></head><body><p>${escapeHtml(summaryLine)}</p>${sections || "<p>No attendance data for these filters</p>"}</body></html>`,
    );
    popup.document.close();
    popup.focus();
    popup.print();
  }

  async function openBand(campus: string, subject: string, band: Band, count: number) {
    if (count === 0) return;
    setPanel({ campus, subject, band });
    setStudentQuery("");
    setStudentsLoading(true);
    const search = new URLSearchParams({ to: appliedTo, campus, subject, band });
    if (appliedFrom) search.set("from", appliedFrom);
    try {
      const res = await fetch(`/api/dashboard/attendance-summary/students?${search}`, {
        credentials: "include",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || "Failed to load students");
      }
      const body = (await res.json()) as { students: StudentRow[] };
      setStudents(body.students);
    } catch (err) {
      setStudents([]);
      setError(err instanceof Error ? err.message : "Failed to load students");
    } finally {
      setStudentsLoading(false);
    }
  }

  const filteredStudents = students.filter((student) => {
    const q = studentQuery.trim().toLowerCase();
    if (!q) return true;
    return [student.name, student.userId, student.batch, student.section]
      .join(" ")
      .toLowerCase()
      .includes(q);
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <label className="text-sm">
          <span className="mb-1 block text-slate-600">From</span>
          <Input type="date" max={today} value={fromDraft} onChange={(event) => setFromDraft(event.target.value)} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-slate-600">To</span>
          <Input type="date" max={today} value={toDraft} onChange={(event) => setToDraft(event.target.value)} />
        </label>
        <CampusMultiSelect
          options={data?.campuses ?? []}
          value={campusDraft}
          onChange={setCampusDraft}
        />
        <Button
          type="button"
          disabled={Boolean(dateError)}
          onClick={() =>
            writeParams({ from: fromDraft, to: toDraft, campuses: campusDraft })
          }
        >
          Apply
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setFromDraft("");
            setToDraft(today);
            setCampusDraft([]);
            writeParams({
              from: "",
              to: today,
              campuses: [],
              subjects: [],
              statuses: ["good", "recovery", "at_risk"],
            });
          }}
        >
          Reset filters
        </Button>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={() => writeParams({ from: shiftDate(today, -6), to: today })}>Last 7 days</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => writeParams({ from: shiftDate(today, -29), to: today })}>Last 30 days</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => writeParams({ from: monthStart(today), to: today })}>This month</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => writeParams({ from: "", to: today })}>All time</Button>
        </div>
      </div>
      {dateError && <p className="text-sm text-red-600">{dateError}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <SubjectMulti
          options={subjectOptions}
          value={selectedSubjects}
          onChange={(subjects) => writeParams({ subjects })}
        />
        <div className="flex gap-2">
          {BANDS.map((band) => {
            const on = activeStatuses.includes(band.id);
            return (
              <Button
                key={band.id}
                type="button"
                size="sm"
                variant={on ? "default" : "outline"}
                onClick={() => {
                  const next = on
                    ? activeStatuses.filter((item) => item !== band.id)
                    : [...activeStatuses, band.id];
                  writeParams({
                    statuses: next.length === 0 ? [] : next,
                  });
                }}
              >
                {band.label}
              </Button>
            );
          })}
        </div>
        <Button type="button" variant="outline" onClick={exportReport}>
          <Download className="mr-2 h-4 w-4" /> CSV
        </Button>
        <Button type="button" variant="outline" onClick={exportPdf}>
          <Download className="mr-2 h-4 w-4" /> PDF
        </Button>
      </div>
      <p className="text-sm text-slate-600">{summaryLine}</p>

      {loading ? (
        <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-6 py-16 text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading attendance summary
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-6 py-10 text-sm text-red-700">
          {error}
        </div>
      ) : blocks.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-6 py-16 text-center text-slate-500">
          No attendance data for these filters
        </div>
      ) : (
        blocks.map(([campus, block], index) => (
          <section key={campus} className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-lg font-semibold text-slate-900">
              {index + 1}. {campus}
            </h2>
            <p className="mt-1 text-sm text-slate-700">
              Overall Attendance: {block.overall.toFixed(2)}%
            </p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-slate-500">
                    <th className="py-2 pr-3 font-medium">Subject</th>
                    <th className="py-2 pr-3 font-medium">Att.</th>
                    <th className="py-2 pr-3 font-medium">Good</th>
                    <th className="py-2 pr-3 font-medium">Recovery</th>
                    <th className="py-2 font-medium">At Risk</th>
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row) => (
                    <tr key={row.subject} className="border-b border-slate-100">
                      <td className="py-2 pr-3">
                        <span className="inline-flex items-center gap-1">
                          {row.subject}
                          {needsWarning(row.subject, row.attendancePct) && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <AlertTriangle className="h-4 w-4 text-amber-600" />
                              </TooltipTrigger>
                              <TooltipContent>Likely a data/mapping issue</TooltipContent>
                            </Tooltip>
                          )}
                        </span>
                      </td>
                      <td className={cn("py-2 pr-3 font-semibold", pctClass(row.attendancePct))}>
                        {row.attendancePct.toFixed(2)}%
                      </td>
                      <td className="py-2 pr-3">
                        <CountButton value={row.good} onClick={() => openBand(campus, row.subject, "good", row.good)} />
                      </td>
                      <td className="py-2 pr-3">
                        <CountButton value={row.recovery} onClick={() => openBand(campus, row.subject, "recovery", row.recovery)} />
                      </td>
                      <td className="py-2">
                        <CountButton value={row.atRisk} onClick={() => openBand(campus, row.subject, "at_risk", row.atRisk)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}

      <Sheet open={panel !== null} onOpenChange={(open) => !open && setPanel(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>
              {panel ? `${BANDS.find((band) => band.id === panel.band)?.label} · ${panel.subject}` : "Students"}
            </SheetTitle>
            <SheetDescription>{panel?.campus}</SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-3">
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-slate-400" />
              <Input
                value={studentQuery}
                onChange={(event) => setStudentQuery(event.target.value)}
                placeholder="Search students"
                className="pl-8"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                exportCsv(
                  "attendance-summary-students.csv",
                  ["Name", "User ID", "Batch", "Section", "Attendance %"],
                  filteredStudents.map((student) => [
                    student.name,
                    student.userId,
                    student.batch,
                    student.section,
                    student.attendancePct.toFixed(2),
                  ]),
                )
              }
            >
              Export CSV
            </Button>
            {studentsLoading ? (
              <p className="text-sm text-slate-500">Loading students</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-slate-500">
                    <th className="py-2 pr-2">Name</th>
                    <th className="py-2 pr-2">User ID</th>
                    <th className="py-2 pr-2">Batch</th>
                    <th className="py-2 pr-2">Section</th>
                    <th className="py-2">Attendance %</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredStudents.map((student) => (
                    <tr key={student.userId} className="border-b border-slate-100">
                      <td className="py-2 pr-2">
                        {student.name}
                        {student.attendancePct < 80 && (
                          <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
                            Not SPI-eligible
                          </span>
                        )}
                        {student.attendancePct < 50 && (
                          <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-800">
                            RAF candidate
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-2">{student.userId}</td>
                      <td className="py-2 pr-2">{student.batch}</td>
                      <td className="py-2 pr-2">{student.section}</td>
                      <td className="py-2">{student.attendancePct.toFixed(2)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function SubjectMulti({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string[];
  onChange: (value: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const shown = options.filter((name) =>
    name.toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <div className="relative min-w-[200px]">
      <Button type="button" variant="outline" onClick={() => setOpen((current) => !current)}>
        {value.length === 0 ? "All subjects" : `${value.length} subjects`}
      </Button>
      {open && (
        <div className="absolute z-20 mt-1 w-64 rounded-md border border-slate-200 bg-white p-2 shadow-lg">
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search subjects" className="mb-2" />
          <Button type="button" size="sm" variant="ghost" onClick={() => onChange([])}>
            All subjects
          </Button>
          <div className="max-h-56 space-y-1 overflow-auto">
            {shown.map((name) => (
              <label key={name} className="flex items-center gap-2 px-1 py-1 text-sm">
                <input
                  type="checkbox"
                  checked={value.includes(name)}
                  onChange={() =>
                    onChange(
                      value.includes(name)
                        ? value.filter((item) => item !== name)
                        : [...value, name],
                    )
                  }
                />
                <span className="truncate">{name}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function CountButton({ value, onClick }: { value: number; onClick: () => void }) {
  if (value === 0) return <span>–</span>;
  return (
    <button type="button" className="font-medium text-brand-700 underline" onClick={onClick}>
      {value}
    </button>
  );
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
