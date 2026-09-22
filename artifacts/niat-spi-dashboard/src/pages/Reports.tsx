import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  useGetDashboardStudents,
  getGetDashboardStudentsQueryKey,
  type DashboardStudent,
} from "@workspace/api-client-react";
import { PageHeader } from "@/components/PageHeader";
import { SubNav, reportsNav } from "@/components/SubNav";
import { TableShell } from "@/components/DataTable";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/AuthContext";
import { exportCsv } from "@/lib/csv";
import { cn, pctColor, pctTextColor } from "@/lib/utils";
import {
  attendanceStanding,
  computeSpiScore,
  standingLabel,
  type AttendanceStanding,
} from "@/lib/spiScore";
import { Download, Loader2 } from "lucide-react";

type ReportsTab = "spi-record" | "skill-debt" | "insights";

const FETCH_LIMIT = 5000;

const PLACEHOLDER: Record<
  Exclude<ReportsTab, "spi-record">,
  { title: string; description: string }
> = {
  "skill-debt": {
    title: "Skill Debt",
    description: "Students with active Skill Debt will appear here.",
  },
  insights: {
    title: "Insights",
    description: "Trends and highlights across SPI will appear here.",
  },
};

function tabFromPath(path: string): ReportsTab {
  if (path === "/dashboard/reports/skill-debt") return "skill-debt";
  if (path === "/dashboard/reports/insights") return "insights";
  return "spi-record";
}

type StudentRow = DashboardStudent & {
  spiPct: number;
  spiPoints: number;
  standing: AttendanceStanding;
};

type CampusCard = {
  name: string;
  studentCount: number;
  sectionCount: number;
  avgSpiPct: number;
  avgSpiPoints: number;
};

type SectionRow = {
  name: string;
  studentCount: number;
  avgSpiPct: number;
  avgSpiPoints: number;
};

function enrichStudent(s: DashboardStudent): StudentRow {
  const { spiPct, points } = computeSpiScore(s.classroomAvg, s.moduleAvg);
  return {
    ...s,
    spiPct,
    spiPoints: points,
    standing: attendanceStanding(s.attendancePct),
  };
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function StandingBadge({ standing }: { standing: AttendanceStanding }) {
  const styles =
    standing === "good"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : standing === "recovery"
        ? "bg-amber-50 text-amber-800 border-amber-200"
        : "bg-red-50 text-red-700 border-red-200";
  return (
    <span
      className={cn(
        "inline-flex rounded-full border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide",
        styles,
      )}
    >
      {standingLabel(standing)}
    </span>
  );
}

function SpiBar({ pct }: { pct: number }) {
  const safe = Math.min(100, Math.max(0, pct));
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-100 sm:w-32">
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${safe}%`,
            backgroundColor: pctColor(safe),
          }}
        />
      </div>
      <span
        className="w-10 text-right text-xs font-semibold tabular-nums"
        style={{ color: pctTextColor(safe) }}
      >
        {safe.toFixed(0)}%
      </span>
    </div>
  );
}

function SpiRecordPanel() {
  const { user } = useAuth();
  const [selectedCampus, setSelectedCampus] = useState<string | null>(null);
  const [selectedSection, setSelectedSection] = useState<string | null>(null);

  const studentQuery = { limit: FETCH_LIMIT };
  const { data: students, isLoading, isFetching } = useGetDashboardStudents(
    studentQuery,
    {
      query: {
        queryKey: getGetDashboardStudentsQueryKey(studentQuery),
        staleTime: 30_000,
      },
    },
  );

  const rows = useMemo(
    () => (students ?? []).map(enrichStudent),
    [students],
  );

  const campuses = useMemo<CampusCard[]>(() => {
    const byCampus = new Map<string, StudentRow[]>();
    for (const s of rows) {
      const key = s.instituteName || "Unknown campus";
      const list = byCampus.get(key);
      if (list) list.push(s);
      else byCampus.set(key, [s]);
    }
    return Array.from(byCampus.entries())
      .map(([name, list]) => {
        const sections = new Set(
          list.map((s) => s.sectionName?.trim() || "Unassigned"),
        );
        const avgSpiPct = mean(list.map((s) => s.spiPct));
        return {
          name,
          studentCount: list.length,
          sectionCount: sections.size,
          avgSpiPct,
          avgSpiPoints: avgSpiPct / 10,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  // Prefer the user's first assigned campus when present in the list.
  useEffect(() => {
    if (selectedCampus || campuses.length === 0) return;
    const assigned = user?.campuses?.find((c) =>
      campuses.some((card) => card.name === c),
    );
    setSelectedCampus(assigned ?? campuses[0]!.name);
  }, [campuses, selectedCampus, user?.campuses]);

  useEffect(() => {
    setSelectedSection(null);
  }, [selectedCampus]);

  const campusStudents = useMemo(
    () =>
      rows.filter(
        (s) =>
          (s.instituteName || "Unknown campus") === selectedCampus,
      ),
    [rows, selectedCampus],
  );

  const sections = useMemo<SectionRow[]>(() => {
    const bySection = new Map<string, StudentRow[]>();
    for (const s of campusStudents) {
      const key = s.sectionName?.trim() || "Unassigned";
      const list = bySection.get(key);
      if (list) list.push(s);
      else bySection.set(key, [s]);
    }
    return Array.from(bySection.entries())
      .map(([name, list]) => {
        const avgSpiPct = mean(list.map((s) => s.spiPct));
        return {
          name,
          studentCount: list.length,
          avgSpiPct,
          avgSpiPoints: avgSpiPct / 10,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [campusStudents]);

  const sectionStudents = useMemo(
    () =>
      selectedSection
        ? campusStudents.filter(
            (s) => (s.sectionName?.trim() || "Unassigned") === selectedSection,
          )
        : [],
    [campusStudents, selectedSection],
  );

  const handleExport = () => {
    if (selectedSection && sectionStudents.length > 0) {
      exportCsv(
        `spi-record-${selectedCampus}-${selectedSection}.csv`,
        ["Name", "Student ID", "SPI Score", "SPI %", "Status", "Attendance %"],
        sectionStudents.map((s) => [
          s.studentName,
          s.studentId,
          s.spiPoints.toFixed(1),
          s.spiPct.toFixed(1),
          standingLabel(s.standing),
          s.attendancePct,
        ]),
      );
      return;
    }
    if (selectedCampus && sections.length > 0) {
      exportCsv(
        `spi-record-${selectedCampus}-sections.csv`,
        ["Section", "Students", "Avg SPI Score", "Avg SPI %"],
        sections.map((s) => [
          s.name,
          s.studentCount,
          s.avgSpiPoints.toFixed(1),
          s.avgSpiPct.toFixed(1),
        ]),
      );
    }
  };

  const canExport =
    (selectedSection && sectionStudents.length > 0) ||
    (!selectedSection && selectedCampus && sections.length > 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">SPI Record</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Campus → section → student. SPI uses classroom (10%) + module (15%);
            skill &amp; final assessments are not in this feed yet (count as 0).
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isFetching && (
            <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
          )}
          <Button
            variant="outline"
            className="h-9 gap-2 border-slate-200"
            onClick={handleExport}
            disabled={!canExport}
          >
            <Download className="h-4 w-4" />
            Export to Sheet
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-xl" />
          ))}
        </div>
      ) : campuses.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-6 py-12 text-center text-sm text-slate-500 shadow-sm">
          No student data available for SPI Record.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {campuses.map((c) => {
            const selected = c.name === selectedCampus;
            return (
              <button
                key={c.name}
                type="button"
                onClick={() => setSelectedCampus(c.name)}
                className={cn(
                  "rounded-xl border bg-white p-4 text-left shadow-sm transition-all",
                  selected
                    ? "border-brand-500 ring-2 ring-brand-500/20"
                    : "border-slate-200 hover:border-brand-200 hover:shadow-md",
                )}
              >
                <p className="line-clamp-2 text-sm font-semibold text-slate-900">
                  {c.name}
                </p>
                <p
                  className="mt-3 font-serif text-2xl font-semibold tabular-nums"
                  style={{ color: pctTextColor(c.avgSpiPct) }}
                >
                  {c.avgSpiPoints.toFixed(1)}
                  <span className="text-sm font-medium text-slate-400">
                    {" "}
                    / 10
                  </span>
                </p>
                <p className="mt-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">
                  Avg SPI
                </p>
                <div className="mt-3 flex gap-3 text-xs text-slate-500">
                  <span>
                    <span className="font-semibold text-slate-700">
                      {c.sectionCount}
                    </span>{" "}
                    sections
                  </span>
                  <span>
                    <span className="font-semibold text-slate-700">
                      {c.studentCount.toLocaleString()}
                    </span>{" "}
                    students
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {selectedCampus && !isLoading && (
        <TableShell>
          <div className="border-b border-slate-200 px-4 py-3">
            <h3 className="text-sm font-semibold text-slate-900">
              Sections · {selectedCampus}
            </h3>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-b border-slate-200 bg-slate-50 hover:bg-slate-50">
                  <TableHead className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Section
                  </TableHead>
                  <TableHead className="text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Students
                  </TableHead>
                  <TableHead className="text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Avg SPI
                  </TableHead>
                  <TableHead className="w-[200px] text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Score
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sections.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="h-20 text-center text-sm text-slate-500"
                    >
                      No sections in this campus.
                    </TableCell>
                  </TableRow>
                ) : (
                  sections.map((sec) => {
                    const active = sec.name === selectedSection;
                    return (
                      <TableRow
                        key={sec.name}
                        onClick={() => setSelectedSection(sec.name)}
                        className={cn(
                          "cursor-pointer border-b border-slate-100",
                          active
                            ? "border-l-4 border-l-brand-500 bg-brand-50/40"
                            : "border-l-4 border-l-transparent hover:bg-slate-50",
                        )}
                      >
                        <TableCell className="py-3 font-medium text-slate-900">
                          {sec.name}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-slate-600">
                          {sec.studentCount.toLocaleString()}
                        </TableCell>
                        <TableCell
                          className="text-right font-semibold tabular-nums"
                          style={{ color: pctTextColor(sec.avgSpiPct) }}
                        >
                          {sec.avgSpiPoints.toFixed(1)} / 10
                        </TableCell>
                        <TableCell>
                          <SpiBar pct={sec.avgSpiPct} />
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </TableShell>
      )}

      {selectedSection && (
        <TableShell>
          <div className="border-b border-slate-200 px-4 py-3">
            <h3 className="text-sm font-semibold text-slate-900">
              Students · {selectedSection}
              <span className="ml-2 font-normal text-slate-500">
                · {sectionStudents.length.toLocaleString()} students
              </span>
            </h3>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-b border-slate-200 bg-slate-50 hover:bg-slate-50">
                  <TableHead className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Name
                  </TableHead>
                  <TableHead className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Student ID
                  </TableHead>
                  <TableHead className="text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
                    SPI Score
                  </TableHead>
                  <TableHead className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Status
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sectionStudents.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="h-20 text-center text-sm text-slate-500"
                    >
                      No students in this section.
                    </TableCell>
                  </TableRow>
                ) : (
                  sectionStudents
                    .slice()
                    .sort((a, b) => a.studentName.localeCompare(b.studentName))
                    .map((s) => (
                      <TableRow
                        key={s.studentId}
                        className="border-b border-slate-100"
                      >
                        <TableCell className="py-3 font-medium text-slate-900">
                          {s.studentName}
                        </TableCell>
                        <TableCell className="tabular-nums text-slate-500">
                          {s.studentId}
                        </TableCell>
                        <TableCell
                          className="text-right font-semibold tabular-nums"
                          style={{ color: pctTextColor(s.spiPct) }}
                        >
                          {s.spiPoints.toFixed(1)} / 10
                        </TableCell>
                        <TableCell>
                          <StandingBadge standing={s.standing} />
                        </TableCell>
                      </TableRow>
                    ))
                )}
              </TableBody>
            </Table>
          </div>
        </TableShell>
      )}
    </div>
  );
}

export default function Reports() {
  const [location] = useLocation();
  const path = location.split("?")[0] ?? location;
  const tab = tabFromPath(path);

  return (
    <div className="space-y-4">
      <PageHeader
        badge="Reports"
        title="Reports"
        subtitle="SPI Record, Skill Debt, and Insights for campuses and sections."
      />
      <SubNav items={reportsNav()} />

      {tab === "spi-record" ? (
        <SpiRecordPanel />
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white px-6 py-16 text-center shadow-sm">
          <p className="text-lg font-semibold text-slate-900">
            {PLACEHOLDER[tab].title}
          </p>
          <p className="mt-2 text-sm text-slate-500">Coming soon</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate-400">
            {PLACEHOLDER[tab].description}
          </p>
        </div>
      )}
    </div>
  );
}
