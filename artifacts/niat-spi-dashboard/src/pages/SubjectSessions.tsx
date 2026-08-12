import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/PageHeader";
import { ErrorState } from "@/components/PageStates";
import { PageBreadcrumb } from "@/components/PageBreadcrumb";
import { TableShell, TablePagination } from "@/components/DataTable";
import {
  Search,
  Loader2,
  ChevronRight,
  Download,
  ExternalLink,
} from "lucide-react";
import { pctColor, pctTextColor } from "@/lib/utils";
import { useDebounceValue } from "@/hooks/useDebounceValue";
import { exportCsv } from "@/lib/csv";

const PAGE_SIZES = [25, 50, 100];

interface SessionSummary {
  sessionTitle: string;
  date: string | null;
  studentCount: number;
  presentCount: number;
  totalCount: number;
  pct: number;
}

interface SessionStudent {
  studentId: string;
  studentName: string;
  instituteName: string | null;
  sectionName: string | null;
  attendanceStatus: string;
  markingMethod: string | null;
  spiPath: string;
}

const safeFileName = (value: string) =>
  value.replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-");

const isPresent = (status: string) => status.trim().toLowerCase() === "present";

/**
 * Unit/session level of the attendance drill-down. Without a `session` param
 * it lists the sessions in a subject; with one it lists the students in that
 * session and whether each attended.
 */
export default function SubjectSessions() {
  const [location, setLocation] = useLocation();

  const params = useMemo(() => {
    const p = new URLSearchParams(window.location.search);
    return {
      subject: p.get("subject") ?? "",
      campus: p.get("campus") ?? "",
      session: p.get("session") ?? "",
      date: p.get("date") ?? "",
      from: p.get("from") ?? "",
    };
  }, [location]);

  const { subject, campus, session, date, from } = params;
  const viaCampuses = from === "campuses";

  // Trail back through whichever tab the user drilled in from.
  const baseTrail = useMemo(() => {
    const trail: { label: string; onClick: () => void }[] = viaCampuses
      ? [
          {
            label: "Campus-wise Stats",
            onClick: () => setLocation("/dashboard/attendance-stats/campuses"),
          },
        ]
      : [
          {
            label: "Student Attendance Stats",
            onClick: () => setLocation("/dashboard/attendance-stats"),
          },
        ];
    if (campus) {
      trail.push({
        label: campus,
        onClick: () =>
          setLocation(
            viaCampuses
              ? `/dashboard/attendance-stats/campuses?campus=${encodeURIComponent(campus)}`
              : `/dashboard/attendance-stats?campus=${encodeURIComponent(campus)}`,
          ),
      });
    }
    return trail;
  }, [viaCampuses, campus, setLocation]);

  const subjectQs = useMemo(() => {
    const p = new URLSearchParams({ subject });
    if (campus) p.set("campus", campus);
    if (from) p.set("from", from);
    return p.toString();
  }, [subject, campus, from]);

  if (!subject) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <p className="text-gray-500">No subject selected.</p>
        <Button
          variant="link"
          className="mt-2"
          onClick={() =>
            setLocation(
              viaCampuses
                ? "/dashboard/attendance-stats/campuses"
                : "/dashboard/attendance-stats",
            )
          }
        >
          {viaCampuses
            ? "Back to Campus-wise Stats"
            : "Back to Student Attendance Stats"}
        </Button>
      </div>
    );
  }

  if (session) {
    return (
      <SessionStudents
        subject={subject}
        campus={campus}
        sessionTitle={session}
        date={date}
        trail={[
          ...baseTrail,
          {
            label: subject,
            onClick: () =>
              setLocation(
                `/dashboard/attendance-stats/sessions?${subjectQs}`,
              ),
          },
        ]}
      />
    );
  }

  return (
    <SessionList
      subject={subject}
      campus={campus}
      trail={baseTrail}
      onOpenSession={(s) => {
        const p = new URLSearchParams({ subject, session: s.sessionTitle });
        if (campus) p.set("campus", campus);
        if (s.date) p.set("date", s.date);
        if (from) p.set("from", from);
        setLocation(`/dashboard/attendance-stats/sessions?${p.toString()}`);
      }}
    />
  );
}

function SessionList({
  subject,
  campus,
  trail,
  onOpenSession,
}: {
  subject: string;
  campus: string;
  trail: { label: string; onClick: () => void }[];
  onOpenSession: (s: SessionSummary) => void;
}) {
  const [rows, setRows] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounceValue(search, 300);
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
    setSearch("");
  }, [subject, campus]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setFetchError(false);
    const p = new URLSearchParams({ subject });
    if (campus) p.set("campus", campus);
    fetch(`/api/dashboard/sessions?${p.toString()}`, {
      credentials: "include",
    })
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: SessionSummary[]) => {
        if (alive) setRows(data ?? []);
      })
      .catch(() => {
        if (alive) {
          setRows([]);
          setFetchError(true);
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [subject, campus]);

  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (s) =>
        s.sessionTitle.toLowerCase().includes(q) ||
        (s.date ?? "").toLowerCase().includes(q),
    );
  }, [rows, debouncedSearch]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paged = filtered.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );

  const handleExport = () => {
    if (filtered.length === 0) return;
    exportCsv(
      `${safeFileName(subject) || "subject"}-sessions.csv`,
      ["Session", "Date", "Students", "Present", "Total", "Attendance %"],
      filtered.map((s) => [
        s.sessionTitle,
        s.date ?? "",
        s.studentCount,
        s.presentCount,
        s.totalCount,
        s.pct,
      ]),
    );
  };

  return (
    <div className="flex flex-col">
      <PageBreadcrumb items={[...trail, { label: subject, current: true }]} />

      <PageHeader
        title={subject}
        subtitle={
          campus
            ? `Unit-wise attendance at ${campus} — click a session to see who attended.`
            : "Unit-wise attendance — click a session to see who attended."
        }
        right={
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[200px] sm:w-64">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                placeholder="Search sessions…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                className="h-9 border-gray-200 pl-9"
              />
            </div>
            {loading && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
            <Button
              variant="outline"
              className="h-9 gap-2 border-gray-200"
              onClick={handleExport}
              disabled={filtered.length === 0 || loading}
            >
              <Download className="h-4 w-4" /> Export
            </Button>
          </div>
        }
      />

      {fetchError && (
        <div className="mb-4">
          <ErrorState message="Failed to load sessions for this subject." />
        </div>
      )}

      <TableShell>
        <div className="border-b border-gray-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-gray-900">
            Attendance by session
          </h2>
          <p className="mt-0.5 text-xs text-gray-500">
            {filtered.length.toLocaleString()} session
            {filtered.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-gray-200 bg-gray-50 hover:bg-gray-50">
                <Th>Session</Th>
                <Th>Date</Th>
                <Th className="text-right">Students</Th>
                <Th className="text-right">Present</Th>
                <Th className="text-right">Total</Th>
                <Th className="w-[220px] text-right">Attendance</Th>
                <Th className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={7}>
                      <Skeleton className="h-8 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : paged.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-32 text-center text-gray-500">
                    No sessions found for this subject.
                  </TableCell>
                </TableRow>
              ) : (
                paged.map((s) => (
                  <TableRow
                    key={`${s.sessionTitle}-${s.date ?? ""}`}
                    className="cursor-pointer border-b border-gray-200 hover:bg-brand-50/40"
                    onClick={() => onOpenSession(s)}
                  >
                    <TableCell className="py-3 font-medium text-gray-900">
                      {s.sessionTitle}
                    </TableCell>
                    <TableCell className="tabular-nums text-gray-600">
                      {s.date ?? "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-gray-600">
                      {s.studentCount.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-gray-600">
                      {s.presentCount.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-gray-600">
                      {s.totalCount.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-3">
                        <div className="hidden h-2 w-28 overflow-hidden rounded-full bg-gray-200 sm:block">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${Math.min(100, s.pct)}%`,
                              backgroundColor: pctColor(s.pct),
                            }}
                          />
                        </div>
                        <span
                          className="w-14 font-bold tabular-nums"
                          style={{ color: pctTextColor(s.pct) }}
                        >
                          {s.pct}%
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right text-gray-300">
                      <ChevronRight className="ml-auto h-4 w-4" />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {!loading && filtered.length > 0 && (
          <TablePagination
            page={currentPage}
            totalPages={totalPages}
            totalItems={filtered.length}
            pageSize={pageSize}
            pageSizeOptions={PAGE_SIZES}
            onPageChange={setPage}
            onPageSizeChange={(s) => {
              setPageSize(s);
              setPage(1);
            }}
            itemLabel="sessions"
          />
        )}
      </TableShell>
    </div>
  );
}

function SessionStudents({
  subject,
  campus,
  sessionTitle,
  date,
  trail,
}: {
  subject: string;
  campus: string;
  sessionTitle: string;
  date: string;
  trail: { label: string; onClick: () => void }[];
}) {
  const [rows, setRows] = useState<SessionStudent[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounceValue(search, 300);
  const [statusFilter, setStatusFilter] = useState<"all" | "present" | "absent">(
    "all",
  );
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
    setSearch("");
    setStatusFilter("all");
  }, [subject, campus, sessionTitle, date]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setFetchError(false);
    const p = new URLSearchParams({ subject, sessionTitle });
    if (campus) p.set("campus", campus);
    if (date) p.set("date", date);
    fetch(`/api/dashboard/session-students?${p.toString()}`, {
      credentials: "include",
    })
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: SessionStudent[]) => {
        if (alive) setRows(data ?? []);
      })
      .catch(() => {
        if (alive) {
          setRows([]);
          setFetchError(true);
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [subject, campus, sessionTitle, date]);

  const presentCount = useMemo(
    () => rows.filter((s) => isPresent(s.attendanceStatus)).length,
    [rows],
  );

  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    return rows.filter((s) => {
      if (statusFilter === "present" && !isPresent(s.attendanceStatus))
        return false;
      if (statusFilter === "absent" && isPresent(s.attendanceStatus))
        return false;
      if (!q) return true;
      return (
        s.studentName.toLowerCase().includes(q) ||
        s.studentId.toLowerCase().includes(q)
      );
    });
  }, [rows, debouncedSearch, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paged = filtered.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );

  const handleExport = () => {
    if (filtered.length === 0) return;
    exportCsv(
      `${safeFileName(sessionTitle) || "session"}-students.csv`,
      ["Name", "Student ID", "Campus", "Section", "Status", "Marked via"],
      filtered.map((s) => [
        s.studentName,
        s.studentId,
        s.instituteName ?? "",
        s.sectionName ?? "",
        s.attendanceStatus,
        s.markingMethod ?? "",
      ]),
    );
  };

  const pct = rows.length > 0 ? Math.round((presentCount / rows.length) * 1000) / 10 : 0;

  return (
    <div className="flex flex-col">
      <PageBreadcrumb
        items={[...trail, { label: sessionTitle, current: true }]}
      />

      <PageHeader
        title={sessionTitle}
        subtitle={
          date
            ? `${subject} · ${date}${campus ? ` · ${campus}` : ""}`
            : `${subject}${campus ? ` · ${campus}` : ""}`
        }
        right={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded-md border border-gray-200 p-0.5">
              {(["all", "present", "absent"] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    setStatusFilter(key);
                    setPage(1);
                  }}
                  className={
                    "rounded px-2.5 py-1 text-xs font-medium capitalize transition-colors " +
                    (statusFilter === key
                      ? "bg-brand-600 text-white"
                      : "text-gray-600 hover:bg-gray-100")
                  }
                >
                  {key}
                </button>
              ))}
            </div>
            <div className="relative min-w-[200px] sm:w-64">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                placeholder="Search students…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                className="h-9 border-gray-200 pl-9"
              />
            </div>
            {loading && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
            <Button
              variant="outline"
              className="h-9 gap-2 border-gray-200"
              onClick={handleExport}
              disabled={filtered.length === 0 || loading}
            >
              <Download className="h-4 w-4" /> Export
            </Button>
          </div>
        }
      />

      {fetchError && (
        <div className="mb-4">
          <ErrorState message="Failed to load students for this session." />
        </div>
      )}

      {!loading && rows.length > 0 && (
        <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          Session attendance:{" "}
          <span
            className="font-semibold tabular-nums"
            style={{ color: pctTextColor(pct) }}
          >
            {pct}%
          </span>
          {" · "}
          <span className="tabular-nums">
            {presentCount.toLocaleString()} present / {rows.length.toLocaleString()}{" "}
            students
          </span>
        </div>
      )}

      <TableShell>
        <div className="border-b border-gray-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-gray-900">
            Student attendance
          </h2>
          <p className="mt-0.5 text-xs text-gray-500">
            {filtered.length.toLocaleString()} student
            {filtered.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-gray-200 bg-gray-50 hover:bg-gray-50">
                <Th>Name</Th>
                <Th>Student ID</Th>
                <Th>Section</Th>
                <Th>Status</Th>
                <Th>Marked via</Th>
                <Th className="w-16 text-right">Report</Th>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={6}>
                      <Skeleton className="h-8 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : paged.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center text-gray-500">
                    No students found for this session.
                  </TableCell>
                </TableRow>
              ) : (
                paged.map((s) => (
                  <TableRow
                    key={s.studentId}
                    className="border-b border-gray-200 hover:bg-gray-50"
                  >
                    <TableCell className="py-3 font-medium text-gray-900">
                      {s.studentName}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-gray-500">
                      {s.studentId}
                    </TableCell>
                    <TableCell className="max-w-[160px] truncate text-gray-600">
                      {s.sectionName ?? "—"}
                    </TableCell>
                    <TableCell>
                      <StatusPill status={s.attendanceStatus} />
                    </TableCell>
                    <TableCell className="text-gray-500">
                      {s.markingMethod ?? "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <a
                        href={s.spiPath}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:text-brand-700 hover:underline"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {!loading && filtered.length > 0 && (
          <TablePagination
            page={currentPage}
            totalPages={totalPages}
            totalItems={filtered.length}
            pageSize={pageSize}
            pageSizeOptions={PAGE_SIZES}
            onPageChange={setPage}
            onPageSizeChange={(s) => {
              setPageSize(s);
              setPage(1);
            }}
            itemLabel="students"
          />
        )}
      </TableShell>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const present = isPresent(status);
  const label = status.trim() || "Unknown";
  return (
    <span
      className={
        "inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize " +
        (present
          ? "bg-emerald-50 text-emerald-700"
          : "bg-red-50 text-red-700")
      }
    >
      {label}
    </span>
  );
}

function Th({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <TableHead
      className={
        "h-11 px-3 text-[11px] font-semibold uppercase tracking-wider text-gray-600 " +
        (className ?? "")
      }
    >
      {children}
    </TableHead>
  );
}
