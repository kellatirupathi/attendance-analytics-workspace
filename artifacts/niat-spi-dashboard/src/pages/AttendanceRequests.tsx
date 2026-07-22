import { useCallback, useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/PageHeader";
import { TableShell } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  Bell,
  Check,
  X,
  Calendar,
  Building2,
  ChevronRight,
} from "lucide-react";
import { format } from "date-fns";

type ReqDate = {
  date: string;
  reason: string;
  status: "pending" | "approved" | "rejected";
  decidedBy?: string | null;
  decidedAt?: string | null;
};
type RequestObj = {
  id: string;
  studentId: string;
  studentName: string;
  campus: string;
  dates: ReqDate[];
  overallStatus: string;
  createdAt: string;
};
type Notification = {
  id: string;
  requestId: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
  request: RequestObj | null;
};

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-amber-50 text-amber-700 border-amber-200",
  approved: "bg-emerald-50 text-emerald-700 border-emerald-200",
  rejected: "bg-red-50 text-red-700 border-red-200",
  partial: "bg-blue-50 text-blue-700 border-blue-200",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "rounded-full border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide",
        STATUS_STYLE[status] ?? STATUS_STYLE.pending,
      )}
    >
      {status}
    </span>
  );
}

const REQUEST_ROLES = ["superadmin", "admin", "boa"];

export default function AttendanceRequests() {
  const { user, isLoading: authLoading } = useAuth();
  const [, setLocation] = useLocation();
  const [notifs, setNotifs] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<Notification | null>(null);

  const canAccess = REQUEST_ROLES.includes(user?.role ?? "");

  useEffect(() => {
    if (!authLoading && user && !canAccess) {
      setLocation("/dashboard");
    }
  }, [authLoading, user, canAccess, setLocation]);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications", {
        credentials: "include",
      });
      if (res.ok) setNotifs((await res.json()) as Notification[]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!canAccess) return;
    load();
    fetch("/api/notifications/read-all", {
      method: "POST",
      credentials: "include",
    }).catch(() => {});
  }, [load, canAccess]);

  // Approve/reject a single date within a request, then refresh.
  const decideDate = async (
    requestId: string,
    index: number,
    status: "approved" | "rejected",
  ) => {
    const res = await fetch(
      `/api/notifications/requests/${requestId}/dates/${index}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status }),
      },
    );
    if (res.ok) {
      const updated = (await res.json()) as RequestObj;
      setNotifs((prev) =>
        prev.map((n) =>
          n.requestId === requestId ? { ...n, request: updated } : n,
        ),
      );
      setDetail((d) =>
        d && d.requestId === requestId ? { ...d, request: updated } : d,
      );
    }
  };

  // Approve/reject the whole request at once.
  const decideAll = async (
    requestId: string,
    status: "approved" | "rejected",
  ) => {
    const res = await fetch(
      `/api/notifications/requests/${requestId}/decision`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status }),
      },
    );
    if (res.ok) {
      const updated = (await res.json()) as RequestObj;
      setNotifs((prev) =>
        prev.map((n) =>
          n.requestId === requestId ? { ...n, request: updated } : n,
        ),
      );
    }
  };

  if (authLoading || !canAccess) return null;

  return (
    <div>
      <PageHeader
        title="Request Inbox"
        subtitle="Review and act on attendance-correction requests from students."
      />

      <TableShell>
        {loading ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-xl" />
            ))}
          </div>
        ) : notifs.length === 0 ? (
          <div className="flex flex-col items-center px-5 py-16 text-center">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
              <Bell className="h-6 w-6 text-gray-400" />
            </div>
            <p className="text-sm font-semibold text-gray-700">
              No attendance requests
            </p>
            <p className="mt-1 text-xs text-gray-500">
              New requests from students will appear here.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-200">
            {notifs.map((n) => {
              const r = n.request;
              const isMulti = (r?.dates.length ?? 0) > 1;
              return (
                <li key={n.id} className="px-5 py-4 hover:bg-gray-50">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-gray-900">
                          {r?.studentName || n.title}
                        </p>
                        {r && <StatusBadge status={r.overallStatus} />}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                        <span className="inline-flex items-center gap-1">
                          <Building2 className="h-3.5 w-3.5" />
                          {r?.campus || "—"}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Calendar className="h-3.5 w-3.5" />
                          {r?.dates.length ?? 0} date
                          {(r?.dates.length ?? 0) === 1 ? "" : "s"}
                        </span>
                        <span>
                          {format(
                            new Date(n.createdAt),
                            "MMM d, yyyy · h:mm a",
                          )}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {isMulti ? (
                        <Button
                          variant="outline"
                          className="h-9 gap-1.5 border-gray-200"
                          onClick={() => setDetail(n)}
                        >
                          Update <ChevronRight className="h-4 w-4" />
                        </Button>
                      ) : (
                        <>
                          <Button
                            className="h-9 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
                            disabled={r?.dates[0]?.status !== "pending"}
                            onClick={() => r && decideAll(r.id, "approved")}
                          >
                            <Check className="h-4 w-4" /> Update
                          </Button>
                          <Button
                            variant="outline"
                            className="h-9 gap-1.5 border-red-200 text-red-600 hover:bg-red-50"
                            disabled={r?.dates[0]?.status !== "pending"}
                            onClick={() => r && decideAll(r.id, "rejected")}
                          >
                            <X className="h-4 w-4" /> Reject
                          </Button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Single-date reason inline */}
                  {r && !isMulti && r.dates[0] && (
                    <p className="mt-2 text-sm text-gray-600">
                      <span className="font-medium text-gray-800">
                        {r.dates[0].date}
                      </span>
                      {r.dates[0].reason && <> — {r.dates[0].reason}</>}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </TableShell>

      {/* Multi-date update dialog: each date has its own Update / Reject */}
      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {detail?.request?.studentName || "Attendance request"}
            </DialogTitle>
            <DialogDescription>
              {detail?.request?.campus} · Decide each date individually.
            </DialogDescription>
          </DialogHeader>

          <ul className="space-y-3">
            {detail?.request?.dates.map((d, i) => (
              <li key={i} className="rounded-xl border border-gray-200 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-900">{d.date}</p>
                    {d.reason && (
                      <p className="mt-0.5 text-sm text-gray-500">{d.reason}</p>
                    )}
                  </div>
                  <StatusBadge status={d.status} />
                </div>
                <div className="mt-3 flex gap-2">
                  <Button
                    className="h-8 flex-1 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
                    disabled={d.status !== "pending"}
                    onClick={() =>
                      detail?.request &&
                      decideDate(detail.request.id, i, "approved")
                    }
                  >
                    <Check className="h-3.5 w-3.5" /> Update
                  </Button>
                  <Button
                    variant="outline"
                    className="h-8 flex-1 gap-1.5 border-red-200 text-red-600 hover:bg-red-50"
                    disabled={d.status !== "pending"}
                    onClick={() =>
                      detail?.request &&
                      decideDate(detail.request.id, i, "rejected")
                    }
                  >
                    <X className="h-3.5 w-3.5" /> Reject
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </div>
  );
}
