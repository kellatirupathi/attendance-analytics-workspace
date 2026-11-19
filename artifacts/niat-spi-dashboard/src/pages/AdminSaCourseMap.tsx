import React, { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Link2, Search } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useSaCourseMap, useSaveSaCourseMapping, type SaCourseMapRow } from "@/hooks/useSaCourseMap";
import { PageHeader } from "@/components/PageHeader";
import { TableShell } from "@/components/DataTable";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type StatusFilter = "to-confirm" | "mapped" | "all";
const NOT_MAPPED = "__not_mapped__";

const rowKey = (r: Pick<SaCourseMapRow, "college" | "batch" | "saCourse">) => `${r.college}\t${r.batch}\t${r.saCourse}`;
const isToConfirm = (r: SaCourseMapRow) => r.status.trim().toLowerCase() === "to confirm";
const isMapped = (r: SaCourseMapRow) => r.status.trim().toLowerCase() === "mapped";

const HEAD = "h-11 px-3 text-[11px] font-semibold uppercase tracking-wider text-gray-600";

export default function AdminSaCourseMap() {
  const { data, isLoading, isError, error } = useSaCourseMap();
  const rows = data?.rows ?? [];
  const [status, setStatus] = useState<StatusFilter | null>(null);
  const [currentOnly, setCurrentOnly] = useState(true);
  const [search, setSearch] = useState("");

  // Open on "To confirm" when something is waiting, else on every row.
  useEffect(() => {
    if (status === null && data) setStatus(data.toConfirm > 0 ? "to-confirm" : "all");
  }, [data, status]);
  const active = status ?? "to-confirm";

  const scoped = useMemo(() => rows.filter((r) => !currentOnly || r.current), [rows, currentOnly]);
  const counts = useMemo(
    () => ({ "to-confirm": scoped.filter(isToConfirm).length, mapped: scoped.filter(isMapped).length, all: scoped.length }),
    [scoped],
  );
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return scoped.filter(
      (r) =>
        (active === "all" || (active === "to-confirm" ? isToConfirm(r) : isMapped(r))) &&
        (!q || [r.college, r.batch, r.saCourse, r.reportCourse ?? ""].some((v) => v.toLowerCase().includes(q))),
    );
  }, [scoped, active, search]);

  return (
    <div className="flex min-w-0 flex-col">
      <PageHeader
        badge="Administration"
        title="Skill Assessment Mapping"
        subtitle="Link each Skill Assessment course to its course on the student report. Changes show on reports after the next report sync."
      />

      <div className="flex flex-wrap items-center gap-3 py-3">
        <div role="group" aria-label="Status" className="inline-flex rounded-md border border-slate-200 bg-white p-0.5">
          {(
            [
              ["to-confirm", "To confirm"],
              ["mapped", "Mapped"],
              ["all", "All"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={active === value}
              onClick={() => setStatus(value)}
              className={cn(
                "min-h-9 rounded px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500",
                active === value ? "bg-brand-600 text-white" : "text-slate-700 hover:bg-slate-100",
              )}
            >
              {label} <span className={cn("tabular-nums", active === value ? "text-white/80" : "text-slate-500")}>({counts[value]})</span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <Switch id="sa-map-current" checked={currentOnly} onCheckedChange={setCurrentOnly} />
          <Label htmlFor="sa-map-current" className="text-sm text-slate-700">
            Current semester only
          </Label>
        </div>

        <div className="relative ml-auto w-full sm:w-72">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <Input
            aria-label="Search college or course"
            placeholder="Search college or course"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
      </div>

      {/* min-w-0: the wide table scrolls inside its box instead of widening the page on phones. */}
      <TableShell className="min-w-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-gray-200 bg-gray-50 hover:bg-gray-50">
                <TableHead className={HEAD}>College</TableHead>
                <TableHead className={HEAD}>Batch</TableHead>
                <TableHead className={HEAD}>Semester</TableHead>
                <TableHead className={HEAD}>SA course (data)</TableHead>
                <TableHead className={cn(HEAD, "text-right")}>Students</TableHead>
                <TableHead className={cn(HEAD, "text-right")}>Rounds</TableHead>
                <TableHead className={HEAD}>Last SA</TableHead>
                <TableHead className={cn(HEAD, "min-w-[18rem]")}>Report course</TableHead>
                <TableHead className={HEAD}>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i} className="border-b border-gray-200">
                    {Array.from({ length: 9 }).map((__, j) => (
                      <TableCell key={j} className="py-3">
                        <Skeleton className="h-5 w-full max-w-[10rem]" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : isError ? (
                <TableRow>
                  <TableCell colSpan={9} className="h-28 text-center text-sm text-red-700" role="alert">
                    {error instanceof Error ? error.message : "Could not load the mapping."}
                  </TableCell>
                </TableRow>
              ) : visible.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="h-32 text-center">
                    <div className="flex flex-col items-center gap-2 text-gray-500">
                      <Link2 className="h-8 w-8 text-gray-400" aria-hidden />
                      <p className="text-sm font-medium text-gray-700">
                        {active === "to-confirm" && !search ? "Nothing to confirm" : "No rows match"}
                      </p>
                      {active === "to-confirm" && !search && (
                        <p className="text-xs text-gray-500">New Skill Assessment courses appear here after a report sync.</p>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                visible.map((r) => <MappingTableRow key={rowKey(r)} row={r} />)
              )}
            </TableBody>
          </Table>
        </div>
      </TableShell>
    </div>
  );
}

function MappingTableRow({ row }: { row: SaCourseMapRow }) {
  const { toast } = useToast();
  const save = useSaveSaCourseMapping();
  const saved = row.reportCourse ?? NOT_MAPPED;
  const [draft, setDraft] = useState(saved);
  useEffect(() => setDraft(saved), [saved]);
  // The saved course may be spelt differently from the reports (older rows): keep it selectable so nothing is lost.
  const options = row.reportCourse && !row.options.includes(row.reportCourse) ? [row.reportCourse, ...row.options] : row.options;
  const canEdit = row.editable && row.options.length > 0;
  const changed = draft !== saved;

  const onSave = () => {
    save.mutate(
      { college: row.college, batch: row.batch, saCourse: row.saCourse, reportCourse: draft === NOT_MAPPED ? null : draft },
      {
        onSuccess: (r) =>
          toast({ title: r.reportCourse ? `Mapped to ${r.reportCourse}` : "Set back to To confirm", description: `${row.college} · ${row.saCourse}` }),
        onError: (err) => toast({ variant: "destructive", title: "Not saved", description: err instanceof Error ? err.message : undefined }),
      },
    );
  };

  return (
    <TableRow className={cn("border-b border-gray-200 hover:bg-gray-50", isToConfirm(row) && row.current && "bg-amber-50/60")}>
      <TableCell className="py-3 font-medium text-gray-900">{row.college}</TableCell>
      <TableCell className="text-sm text-gray-700">{row.batch}</TableCell>
      <TableCell className="whitespace-nowrap text-sm text-gray-700">{row.semester}</TableCell>
      <TableCell className="font-mono text-xs text-gray-700">{row.saCourse}</TableCell>
      <TableCell className="text-right text-sm tabular-nums text-gray-700">{row.students.toLocaleString("en-IN")}</TableCell>
      <TableCell className="text-right text-sm tabular-nums text-gray-700">{row.mainSaCount}</TableCell>
      <TableCell className="whitespace-nowrap text-sm text-gray-600">
        {row.lastSaDate ? format(new Date(`${row.lastSaDate}T00:00:00`), "d MMM yyyy") : "—"}
      </TableCell>
      <TableCell>
        {canEdit ? (
          <div className="flex items-center gap-2">
            <Select value={draft} onValueChange={setDraft} disabled={save.isPending}>
              <SelectTrigger className="h-9 min-w-[14rem]" aria-label={`Report course for ${row.saCourse}, ${row.college}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NOT_MAPPED}>Not mapped</SelectItem>
                {options.map((o) => (
                  <SelectItem key={o} value={o}>
                    {o}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {changed && (
              <Button size="sm" className="h-9 bg-brand-600 text-white hover:bg-brand-700" onClick={onSave} disabled={save.isPending}>
                {save.isPending ? "Saving…" : "Save"}
              </Button>
            )}
          </div>
        ) : (
          <div className="text-sm">
            <span className="text-gray-900">{row.reportCourse ?? "—"}</span>
            <p className="text-xs text-gray-500">{row.editable ? "No saved report for this semester" : "Needs a course name in the data"}</p>
          </div>
        )}
      </TableCell>
      <TableCell>
        <StatusLabel status={row.status} />
      </TableCell>
    </TableRow>
  );
}

function StatusLabel({ status }: { status: string }) {
  const s = status.trim().toLowerCase();
  const tone =
    s === "mapped"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : s === "to confirm"
        ? "border-amber-200 bg-amber-50 text-amber-900"
        : "border-slate-200 bg-slate-50 text-slate-700";
  return <span className={cn("inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium", tone)}>{status}</span>;
}
