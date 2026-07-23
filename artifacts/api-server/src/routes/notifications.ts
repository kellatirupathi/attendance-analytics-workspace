import { Router } from "express";
import { db } from "@workspace/db";
import {
  attendanceRequestsTable,
  notificationsTable,
  type RequestDate,
} from "@workspace/db";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { requireSession } from "../lib/auth.js";
import { spiSharePath } from "../lib/spiToken.js";
import type { Role } from "../lib/rbac.js";

const router = Router();

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

// Roles that manage attendance requests / receive notifications.
const MANAGER_ROLES: Role[] = ["superadmin", "admin", "boa"];

function canManageRequests(role: Role): boolean {
  return MANAGER_ROLES.includes(role);
}

function rollupStatus(dates: RequestDate[]): string {
  if (dates.length === 0) return "pending";
  const statuses = dates.map((d) => d.status);
  if (statuses.every((s) => s === "pending")) return "pending";
  if (statuses.every((s) => s === "approved")) return "approved";
  if (statuses.every((s) => s === "rejected")) return "rejected";
  if (statuses.some((s) => s === "pending")) return "pending";
  return "partial";
}

/* ------------------------------------------------------------------ */
/* All routes require a staff session with a manager role.            */
/* ------------------------------------------------------------------ */
router.use(requireSession());
router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  if (!canManageRequests(req.session!.role as Role)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
});

// Scope helper: which requests a user may see. superadmin/admin => all;
// boa => their campuses (or all if none set).
function requestScopeWhere(session: { role: Role; campuses: string[] }) {
  if (session.role === "superadmin" || session.role === "admin")
    return undefined;
  if (session.campuses.length === 0) return undefined;
  return inArray(attendanceRequestsTable.campus, session.campuses);
}

/* Unread notification count for the badge. */
router.get("/count", async (req, res): Promise<void> => {
  const session = req.session!;
  const rows = await db
    .select({ n: sql<number>`count(*)` })
    .from(notificationsTable)
    .where(
      and(
        eq(notificationsTable.userId, session.sub),
        isNull(notificationsTable.readAt),
      ),
    );
  res.json({ unread: Number(rows[0]?.n ?? 0) });
});

/* List notifications for the current user, newest first, with the linked
 * request (so the page can render dates + status inline). */
router.get("/", async (req, res): Promise<void> => {
  const session = req.session!;
  const notifs = await db
    .select()
    .from(notificationsTable)
    .where(eq(notificationsTable.userId, session.sub))
    .orderBy(desc(notificationsTable.createdAt))
    .limit(200);

  const requestIds = Array.from(new Set(notifs.map((n) => n.requestId)));
  const requests =
    requestIds.length > 0
      ? await db
          .select()
          .from(attendanceRequestsTable)
          .where(inArray(attendanceRequestsTable.id, requestIds))
      : [];
  const byId = new Map(requests.map((r) => [r.id, r]));

  res.json(
    notifs.map((n) => {
      const r = byId.get(n.requestId);
      return {
        id: n.id,
        requestId: n.requestId,
        title: n.title,
        body: n.body,
        read: Boolean(n.readAt),
        createdAt: n.createdAt.toISOString(),
        request: r
          ? {
              id: r.id,
              studentId: r.studentId,
              studentName: r.studentName,
              campus: r.campus,
              dates: r.dates,
              overallStatus: r.overallStatus,
              createdAt: r.createdAt.toISOString(),
              spiPath: spiSharePath(r.studentId),
            }
          : null,
      };
    }),
  );
});

/* Mark a single notification as read. */
router.post("/:id/read", async (req, res): Promise<void> => {
  const session = req.session!;
  const id = String(req.params["id"] ?? "");
  await db
    .update(notificationsTable)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notificationsTable.id, id),
        eq(notificationsTable.userId, session.sub),
      ),
    );
  res.json({ ok: true });
});

/* Mark all as read. */
router.post("/read-all", async (req, res): Promise<void> => {
  const session = req.session!;
  await db
    .update(notificationsTable)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notificationsTable.userId, session.sub),
        isNull(notificationsTable.readAt),
      ),
    );
  res.json({ ok: true });
});

/* Decide a single date of a request (approve / reject). Index is the position
 * in the request's dates array. */
router.patch("/requests/:id/dates/:index", async (req, res): Promise<void> => {
  const session = req.session!;
  const id = String(req.params["id"] ?? "");
  const index = Number(req.params["index"] ?? -1);
  const { status } = req.body as { status?: "approved" | "rejected" };
  if (status !== "approved" && status !== "rejected") {
    res.status(400).json({ error: "status must be approved or rejected" });
    return;
  }

  const existing = await db
    .select()
    .from(attendanceRequestsTable)
    .where(eq(attendanceRequestsTable.id, id))
    .limit(1);
  const request = existing[0];
  if (!request) {
    res.status(404).json({ error: "Request not found" });
    return;
  }

  // Scope check for BOA.
  const scope = requestScopeWhere(session);
  if (
    scope &&
    session.campuses.length > 0 &&
    !session.campuses.includes(request.campus)
  ) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const dates = [...request.dates];
  if (index < 0 || index >= dates.length) {
    res.status(400).json({ error: "Invalid date index" });
    return;
  }
  dates[index] = {
    ...dates[index]!,
    status,
    decidedBy: session.email,
    decidedAt: new Date().toISOString(),
  };

  const updated = await db
    .update(attendanceRequestsTable)
    .set({
      dates,
      overallStatus: rollupStatus(dates),
      updatedAt: new Date(),
    })
    .where(eq(attendanceRequestsTable.id, id))
    .returning();
  const r = updated[0]!;
  res.json({
    id: r.id,
    studentId: r.studentId,
    studentName: r.studentName,
    campus: r.campus,
    dates: r.dates,
    overallStatus: r.overallStatus,
    createdAt: r.createdAt.toISOString(),
    spiPath: spiSharePath(r.studentId),
  });
});

/* Decide every date of a request at once (approve-all / reject-all). */
router.patch("/requests/:id/decision", async (req, res): Promise<void> => {
  const session = req.session!;
  const id = String(req.params["id"] ?? "");
  const { status } = req.body as { status?: "approved" | "rejected" };
  if (status !== "approved" && status !== "rejected") {
    res.status(400).json({ error: "status must be approved or rejected" });
    return;
  }

  const existing = await db
    .select()
    .from(attendanceRequestsTable)
    .where(eq(attendanceRequestsTable.id, id))
    .limit(1);
  const request = existing[0];
  if (!request) {
    res.status(404).json({ error: "Request not found" });
    return;
  }
  if (
    session.role === "boa" &&
    session.campuses.length > 0 &&
    !session.campuses.includes(request.campus)
  ) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const now = new Date().toISOString();
  const dates = request.dates.map((d) => ({
    ...d,
    status,
    decidedBy: session.email,
    decidedAt: now,
  }));
  const updated = await db
    .update(attendanceRequestsTable)
    .set({ dates, overallStatus: status, updatedAt: new Date() })
    .where(eq(attendanceRequestsTable.id, id))
    .returning();
  const r = updated[0]!;
  res.json({
    id: r.id,
    studentId: r.studentId,
    studentName: r.studentName,
    campus: r.campus,
    dates: r.dates,
    overallStatus: r.overallStatus,
    createdAt: r.createdAt.toISOString(),
    spiPath: spiSharePath(r.studentId),
  });
});

export default router;
