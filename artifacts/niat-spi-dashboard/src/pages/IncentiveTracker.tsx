import { Fragment, useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { PageLoader } from "@/components/PageLoader";
import { ErrorState } from "@/components/PageStates";
import { SubNav, recoveryNav } from "@/components/SubNav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Loader2,
  Wallet,
  Wrench,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useQueryParams } from "@/hooks/useQueryParams";

type IncentiveSessionStatus = "conducted" | "partial" | "cancelled" | "no_show";
type IncentiveProcessed = "yes" | "no" | "na";

interface IncentiveSessionRow {
  id: string;
  campus: string;
  subject: string;
  topics: string[];
  scheduledDate: string;
  status: IncentiveSessionStatus;
  instructorName: string;
  employeeId: string | null;
  bigqueryInstructorUserId: string | null;
  instructorType: "campus" | "backup" | "unknown";
  amount: number;
  incentiveApproved: boolean;
  incentiveApprovedByName: string | null;
  incentiveApprovedAt: string | null;
  incentivePaid: boolean;
  incentivePaidByName: string | null;
  incentivePaidAt: string | null;
  /** yes = paid, no = earned but not yet paid, na = cancelled/not taken. */
  incentiveProcessed: IncentiveProcessed;
}

interface IncentiveInstructorSummary {
  key: string;
  employeeId: string | null;
  bigqueryInstructorUserId: string | null;
  instructorName: string;
  instructorType: "campus" | "backup" | "unknown";
  needsIdentityReview: boolean;
  sessionsCompleted: number;
  sessionsApproved: number;
  sessionsPaid: number;
  amountPendingApproval: number;
  amountOwed: number;
  amountPaid: number;
  sessions: IncentiveSessionRow[];
}

interface IncentiveCampusGroup {
  campus: string;
  instructors: IncentiveInstructorSummary[];
  totals: {
    sessionsCompleted: number;
    amountPendingApproval: number;
    amountOwed: number;
    amountPaid: number;
  };
}

interface IncentiveTrackerResponse {
  ratePerSession: number;
  campuses: IncentiveCampusGroup[];
}

interface RosterInstructor {
  instructorUserId: string;
  employeeId: string;
  name: string;
  category: string;
  role: string;
  institute: string;
}

function formatRupees(amount: number): string {
  return `₹${amount.toLocaleString("en-IN")}`;
}

function formatDate(date: string): string {
  try {
    const d = new Date(`${date}T00:00:00`);
    if (isNaN(d.getTime())) return date;
    return new Intl.DateTimeFormat(undefined, {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(d);
  } catch {
    return date;
  }
}

function StatusPill({ status }: { status: IncentiveSessionStatus }) {
  switch (status) {
    case "conducted":
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700">
          Completed
        </span>
      );
    case "partial":
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700">
          Partially Completed
        </span>
      );
    case "cancelled":
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-500">
          Cancelled
        </span>
      );
    case "no_show":
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-rose-100 text-rose-600">
          Not Completed
        </span>
      );
  }
}

function IncentiveProcessedBadge({ value }: { value: IncentiveProcessed }) {
  if (value === "yes")
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-emerald-100 text-emerald-700">
        Yes
      </span>
    );
  if (value === "no")
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-rose-100 text-rose-700">
        No
      </span>
    );
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-slate-100 text-slate-500">
      NA
    </span>
  );
}

function InstructorTypeBadge({ type }: { type: "campus" | "backup" | "unknown" }) {
  if (type === "campus")
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600 border border-slate-200 uppercase tracking-wider">
        Campus
      </span>
    );
  if (type === "backup")
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-purple-100 text-purple-700 border border-purple-200 uppercase tracking-wider">
        Backup
      </span>
    );
  return <span className="text-slate-400 text-xs">-</span>;
}

export default function IncentiveTracker() {
  const { toast } = useToast();
  const { user } = useAuth();
  const canApprove = user?.role === "superadmin" || user?.role === "admin" || user?.role === "boa";
  const canManage = user?.role === "superadmin" || user?.role === "admin";

  // When opened from a specific college's Recovery pages (?campus=...), the
  // tracker defaults to that campus instead of whichever one happens to
  // sort first -- see the sync effect below.
  const queryParams = useQueryParams();
  const urlCampus = queryParams.get("campus") ?? "";

  const [data, setData] = useState<IncentiveTrackerResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retryCount, setRetryCount] = useState(0);

  const [selectedCampus, setSelectedCampus] = useState<string>("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [pendingSessionId, setPendingSessionId] = useState<string | null>(null);

  const [fixTarget, setFixTarget] = useState<{
    campus: string;
    instructor: IncentiveInstructorSummary;
  } | null>(null);
  const [roster, setRoster] = useState<RosterInstructor[] | null>(null);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterAll, setRosterAll] = useState(false);
  const [selectedRosterId, setSelectedRosterId] = useState("");
  const [fixSubmitting, setFixSubmitting] = useState(false);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/recovery/incentives", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to load the incentive tracker");
      const result = (await response.json()) as IncentiveTrackerResponse;
      setData(result);
      setSelectedCampus((current) => {
        if (urlCampus && result.campuses.some((c) => c.campus === urlCampus)) return urlCampus;
        if (current && result.campuses.some((c) => c.campus === current)) return current;
        return result.campuses[0]?.campus ?? "";
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load the incentive tracker");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryCount]);

  // Re-apply the URL's campus if it changes while this page stays mounted
  // (e.g. following a different college's "Incentive Tracker" banner without
  // a full page reload) -- everything's already fetched, so this just swaps
  // which campus's group is shown, no refetch needed.
  useEffect(() => {
    if (!data || !urlCampus) return;
    if (data.campuses.some((c) => c.campus === urlCampus)) {
      setSelectedCampus(urlCampus);
    }
  }, [urlCampus, data]);

  useEffect(() => {
    if (!fixTarget) return;
    const controller = new AbortController();
    let active = true;
    async function fetchRoster() {
      setRosterLoading(true);
      try {
        const params = rosterAll
          ? new URLSearchParams({ all: "true" })
          : new URLSearchParams({ campus: fixTarget!.campus });
        const response = await fetch(`/api/dashboard/recovery-instructors?${params}`, {
          credentials: "include",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Failed to load instructor roster");
        const result = (await response.json()) as RosterInstructor[];
        if (active) setRoster(result);
      } catch (err) {
        if (!active || (err instanceof DOMException && err.name === "AbortError")) return;
        toast({ variant: "destructive", title: "Could not load instructor roster" });
      } finally {
        if (active) setRosterLoading(false);
      }
    }
    void fetchRoster();
    return () => {
      active = false;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixTarget, rosterAll]);

  const campusGroup = useMemo(
    () => data?.campuses.find((c) => c.campus === selectedCampus) ?? null,
    [data, selectedCampus],
  );

  function toggleExpanded(key: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function setApproval(session: IncentiveSessionRow, approved: boolean) {
    setPendingSessionId(session.id);
    try {
      const response = await fetch(
        `/api/recovery/sessions/${encodeURIComponent(session.id)}/incentive-approval`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ approved }),
        },
      );
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error ?? "Could not update approval");
      toast({
        title: approved ? "Session approved" : "Approval revoked",
        description: approved
          ? "This session's incentive now counts toward what's owed."
          : "This session no longer counts toward what's owed.",
      });
      await load();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Could not update approval",
        description: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setPendingSessionId(null);
    }
  }

  async function setPaid(session: IncentiveSessionRow, paid: boolean) {
    setPendingSessionId(session.id);
    try {
      const response = await fetch(
        `/api/admin/recovery-sessions/${encodeURIComponent(session.id)}/incentive-paid`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paid }),
        },
      );
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error ?? "Could not update payment status");
      toast({ title: paid ? "Marked as paid" : "Marked as unpaid" });
      await load();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Could not update payment status",
        description: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setPendingSessionId(null);
    }
  }

  function openFixDialog(campus: string, instructor: IncentiveInstructorSummary) {
    setFixTarget({ campus, instructor });
    setRoster(null);
    setRosterAll(false);
    setSelectedRosterId("");
  }

  async function submitFix() {
    if (!fixTarget || !roster) return;
    const match = roster.find((r) => r.instructorUserId === selectedRosterId);
    if (!match) {
      toast({ variant: "destructive", title: "Select an instructor from the roster" });
      return;
    }
    setFixSubmitting(true);
    try {
      const sessionIds = fixTarget.instructor.sessions.map((s) => s.id);
      const results = await Promise.all(
        sessionIds.map((id) =>
          fetch(`/api/admin/recovery-sessions/${encodeURIComponent(id)}/instructor-identity`, {
            method: "PATCH",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              instructorName: match.name,
              employeeId: match.employeeId || null,
              bigqueryInstructorUserId: match.instructorUserId,
              instructorType: rosterAll ? "backup" : "campus",
            }),
          }),
        ),
      );
      const failed = results.filter((r) => !r.ok).length;
      if (failed > 0) {
        toast({
          variant: "destructive",
          title: "Some sessions could not be updated",
          description: `${sessionIds.length - failed} of ${sessionIds.length} updated.`,
        });
      } else {
        toast({
          title: "Instructor identity fixed",
          description: `${sessionIds.length} session${sessionIds.length === 1 ? "" : "s"} now linked to ${match.name} (${match.employeeId || "no employee id"}).`,
        });
      }
      setFixTarget(null);
      await load();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Could not fix instructor identity",
        description: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setFixSubmitting(false);
    }
  }

  if (loading && !data) {
    return (
      <div className="flex flex-col">
        <SubNav items={recoveryNav(selectedCampus || undefined, undefined, true)} />
        <PageLoader />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="flex flex-col">
        <SubNav items={recoveryNav(selectedCampus || undefined, undefined, true)} />
        <div className="p-6">
          <ErrorState message={error} onRetry={() => setRetryCount((c) => c + 1)} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <SubNav items={recoveryNav(selectedCampus || undefined, undefined, true)} />
      <div className="flex flex-col gap-6 p-6 animate-in fade-in duration-300">
      <PageHeader
        title="Incentive Tracker"
        subtitle="Every Completed or Partially Completed recovery session earns the instructor a fixed incentive once the BOA confirms it was actually delivered."
        right={
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-sm font-semibold text-emerald-700">
            <Wallet className="h-3.5 w-3.5" />
            {formatRupees(data?.ratePerSession ?? 500)} per session
          </span>
        }
      />

      {!data || data.campuses.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-12 text-center">
          <AlertCircle className="mx-auto mb-4 h-12 w-12 text-slate-400" />
          <p className="text-slate-600 font-medium">
            No Completed or Partially Completed recovery sessions yet.
          </p>
        </div>
      ) : (
        <>
          {data.campuses.length > 1 && (
            <div className="flex-1 max-w-sm">
              <label id="incentive-campus-label" className="mb-2 block text-sm font-medium text-slate-700">
                Select Campus
              </label>
              <Select value={selectedCampus} onValueChange={setSelectedCampus}>
                <SelectTrigger aria-labelledby="incentive-campus-label" className="bg-white">
                  <SelectValue placeholder="Choose a campus..." />
                </SelectTrigger>
                <SelectContent>
                  {data.campuses.map((c) => (
                    <SelectItem key={c.campus} value={c.campus}>
                      {c.campus}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {campusGroup && (
            <>
              <div className="grid gap-4 md:grid-cols-4">
                <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Sessions completed
                  </p>
                  <p className="mt-2 text-3xl font-bold text-slate-900 tabular-nums">
                    {campusGroup.totals.sessionsCompleted}
                  </p>
                </div>
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-wider text-amber-700">
                    Pending BOA approval
                  </p>
                  <p className="mt-2 text-3xl font-bold text-amber-800 tabular-nums">
                    {formatRupees(campusGroup.totals.amountPendingApproval)}
                  </p>
                </div>
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-5 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-wider text-rose-700">
                    Approved, owed
                  </p>
                  <p className="mt-2 text-3xl font-bold text-rose-800 tabular-nums">
                    {formatRupees(campusGroup.totals.amountOwed)}
                  </p>
                </div>
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">
                    Already paid
                  </p>
                  <p className="mt-2 text-3xl font-bold text-emerald-800 tabular-nums">
                    {formatRupees(campusGroup.totals.amountPaid)}
                  </p>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <caption className="sr-only">
                      Incentive summary by instructor for {campusGroup.campus}.
                    </caption>
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50">
                        <th className="w-8 px-3 py-3" />
                        <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-600">Instructor</th>
                        <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-600">Employee ID</th>
                        <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-600">Type</th>
                        <th className="px-5 py-3 text-center text-xs font-semibold uppercase tracking-wider text-slate-600">Sessions</th>
                        <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-600">Pending</th>
                        <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-600">Owed</th>
                        <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-600">Paid</th>
                        {canManage && (
                          <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-600">Fix</th>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {campusGroup.instructors.map((instructor) => {
                        const isOpen = expanded.has(instructor.key);
                        return (
                          <Fragment key={instructor.key}>
                            <tr
                              key={instructor.key}
                              className="hover:bg-slate-50/50 transition-colors cursor-pointer"
                              onClick={() => toggleExpanded(instructor.key)}
                            >
                              <td className="px-3 py-3.5 text-slate-400">
                                {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                              </td>
                              <td className="px-5 py-3.5 font-medium text-slate-900">
                                {instructor.instructorName || "Unnamed instructor"}
                                {instructor.needsIdentityReview && (
                                  <Badge variant="secondary" className="ml-2 bg-amber-100 text-amber-700 hover:bg-amber-100">
                                    Needs review
                                  </Badge>
                                )}
                              </td>
                              <td className="px-5 py-3.5 font-mono text-xs text-slate-600">
                                {instructor.employeeId || "—"}
                              </td>
                              <td className="px-5 py-3.5">
                                <InstructorTypeBadge type={instructor.instructorType} />
                              </td>
                              <td className="px-5 py-3.5 text-center tabular-nums text-slate-700 font-medium">
                                {instructor.sessionsCompleted}
                              </td>
                              <td className="px-5 py-3.5 text-right tabular-nums text-amber-700 font-medium">
                                {formatRupees(instructor.amountPendingApproval)}
                              </td>
                              <td className="px-5 py-3.5 text-right tabular-nums text-rose-700 font-medium">
                                {formatRupees(instructor.amountOwed)}
                              </td>
                              <td className="px-5 py-3.5 text-right tabular-nums text-emerald-700 font-medium">
                                {formatRupees(instructor.amountPaid)}
                              </td>
                              {canManage && (
                                <td className="px-5 py-3.5">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="gap-1.5"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      openFixDialog(campusGroup.campus, instructor);
                                    }}
                                  >
                                    <Wrench className="h-3.5 w-3.5" />
                                    Fix instructor
                                  </Button>
                                </td>
                              )}
                            </tr>
                            {isOpen && (
                              <tr>
                                <td colSpan={canManage ? 9 : 8} className="bg-slate-50/60 px-5 py-4">
                                  <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                                    <table className="w-full text-xs">
                                      <thead>
                                        <tr className="border-b border-slate-200 bg-slate-50">
                                          <th className="px-4 py-2 text-left font-semibold uppercase tracking-wider text-slate-500">Date</th>
                                          <th className="px-4 py-2 text-left font-semibold uppercase tracking-wider text-slate-500">Subject</th>
                                          <th className="px-4 py-2 text-left font-semibold uppercase tracking-wider text-slate-500">Topic</th>
                                          <th className="px-4 py-2 text-left font-semibold uppercase tracking-wider text-slate-500">Status</th>
                                          <th className="px-4 py-2 text-center font-semibold uppercase tracking-wider text-slate-500">Incentive Processed</th>
                                          <th className="px-4 py-2 text-right font-semibold uppercase tracking-wider text-slate-500">Amount</th>
                                          {canApprove && (
                                            <th className="px-4 py-2 text-center font-semibold uppercase tracking-wider text-slate-500">BOA Approved</th>
                                          )}
                                          {canManage && (
                                            <th className="px-4 py-2 text-center font-semibold uppercase tracking-wider text-slate-500">Paid</th>
                                          )}
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-slate-100">
                                        {instructor.sessions.map((session) => (
                                          <tr key={session.id}>
                                            <td className="px-4 py-2.5 whitespace-nowrap text-slate-700">
                                              {formatDate(session.scheduledDate)}
                                            </td>
                                            <td className="px-4 py-2.5 text-slate-700">{session.subject}</td>
                                            <td className="px-4 py-2.5 text-slate-700">
                                              {session.topics.length > 0 ? session.topics.join(", ") : "—"}
                                            </td>
                                            <td className="px-4 py-2.5">
                                              <StatusPill status={session.status} />
                                            </td>
                                            <td className="px-4 py-2.5 text-center">
                                              <IncentiveProcessedBadge value={session.incentiveProcessed} />
                                            </td>
                                            <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">
                                              {session.incentiveProcessed === "na" ? "—" : formatRupees(session.amount)}
                                            </td>
                                            {canApprove && (
                                              <td className="px-4 py-2.5">
                                                {session.incentiveProcessed === "na" ? (
                                                  <div className="flex justify-center text-slate-300">—</div>
                                                ) : (
                                                  <div className="flex flex-col items-center gap-1">
                                                    <Switch
                                                      checked={session.incentiveApproved}
                                                      disabled={pendingSessionId === session.id}
                                                      onCheckedChange={(checked) => void setApproval(session, checked)}
                                                    />
                                                    {session.incentiveApproved && session.incentiveApprovedByName && (
                                                      <span className="text-[10px] text-slate-400">
                                                        by {session.incentiveApprovedByName}
                                                      </span>
                                                    )}
                                                  </div>
                                                )}
                                              </td>
                                            )}
                                            {canManage && (
                                              <td className="px-4 py-2.5">
                                                {session.incentiveProcessed === "na" ? (
                                                  <div className="flex justify-center text-slate-300">—</div>
                                                ) : (
                                                  <div className="flex flex-col items-center gap-1">
                                                    <Switch
                                                      checked={session.incentivePaid}
                                                      disabled={pendingSessionId === session.id || !session.incentiveApproved}
                                                      onCheckedChange={(checked) => void setPaid(session, checked)}
                                                    />
                                                    {session.incentivePaid && session.incentivePaidByName && (
                                                      <span className="text-[10px] text-slate-400">
                                                        by {session.incentivePaidByName}
                                                      </span>
                                                    )}
                                                  </div>
                                                )}
                                              </td>
                                            )}
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </>
      )}

      <Dialog open={fixTarget !== null} onOpenChange={(open) => !open && setFixTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Fix instructor identity</DialogTitle>
            <DialogDescription>
              {fixTarget && (
                <>
                  Re-link all {fixTarget.instructor.sessions.length} session
                  {fixTarget.instructor.sessions.length === 1 ? "" : "s"} currently recorded under "
                  {fixTarget.instructor.instructorName || "Unnamed instructor"}" to the correct instructor
                  from the BigQuery staff roster. This does not change anything already marked paid.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Checkbox
                id="fix-roster-all"
                checked={rosterAll}
                onCheckedChange={(checked) => {
                  setRosterAll(checked === true);
                  setSelectedRosterId("");
                }}
              />
              <Label htmlFor="fix-roster-all" className="text-sm font-normal">
                Search all campuses (backup instructor)
              </Label>
            </div>
            {rosterLoading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-brand-600" />
              </div>
            ) : (
              <Select value={selectedRosterId} onValueChange={setSelectedRosterId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose an instructor..." />
                </SelectTrigger>
                <SelectContent>
                  {(roster ?? []).map((r) => (
                    <SelectItem key={r.instructorUserId} value={r.instructorUserId}>
                      {r.name} {r.employeeId ? `— ${r.employeeId}` : ""}
                      {rosterAll && r.institute ? ` (${r.institute})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFixTarget(null)}>
              Cancel
            </Button>
            <Button onClick={() => void submitFix()} disabled={!selectedRosterId || fixSubmitting}>
              {fixSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save correction"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </div>
    </div>
  );
}
