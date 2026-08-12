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

const MANAGER_ROLES: Role[] = ["superadmin", "admin", "boa"];
const VIEW_ROLES: Role[] = [...MANAGER_ROLES, "hod"];

function canManageRequests(role: Role): boolean {
  return MANAGER_ROLES.includes(role);
}

function canViewRequests(role: Role): boolean {
  return VIEW_ROLES.includes(role);
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

function campusAllowed(
  session: { role: Role; campuses: string[] },
  campus: string,
): boolean {
  if (session.role === "superadmin" || session.role === "admin") return true;
  if (session.role === "hod") return true;
  if (session.role === "boa") {
    return session.campuses.length > 0 && session.campuses.includes(campus);
  }
  return false;
}

router.use(requireSession());
router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  if (!canViewRequests(req.session!.role as Role)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
});

router.get("/count", async (req, res): Promise<void> => {
  try {
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
  } catch (err) {
    req.log.error({ err }, "Error fetching notification count");
    res.status(500).json({ error: "Failed to fetch count" });
  }
});

router.get("/", async (req, res): Promise<void> => {
  try {
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
    const canManage = canManageRequests(session.role as Role);

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
          canManage,
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
  } catch (err) {
    req.log.error({ err }, "Error listing notifications");
    res.status(500).json({ error: "Failed to fetch notifications" });
  }
});

router.post("/:id/read", async (req, res): Promise<void> => {
  try {
    const session = req.session!;
    const id = String(req.params["id"] ?? "");
    const result = await db
      .update(notificationsTable)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notificationsTable.id, id),
          eq(notificationsTable.userId, session.sub),
        ),
      )
      .returning({ id: notificationsTable.id });
    if (result.length === 0) {
      res.status(404).json({ error: "Notification not found" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Error marking notification read");
    res.status(500).json({ error: "Failed to mark read" });
  }
});

router.post("/read-all", async (req, res): Promise<void> => {
  try {
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
  } catch (err) {
    req.log.error({ err }, "Error marking all read");
    res.status(500).json({ error: "Failed to mark all read" });
  }
});

async function applyDateDecision(
  req: import("express").Request,
  res: import("express").Response,
  id: string,
  index: number,
  status: "approved" | "rejected",
): Promise<void> {
  const session = req.session!;

  if (!canManageRequests(session.role as Role)) {
    res.status(403).json({ error: "Read-only access" });
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

  if (!campusAllowed(session, request.campus)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const dates = [...request.dates];
  if (index < 0 || index >= dates.length) {
    res.status(400).json({ error: "Invalid date index" });
    return;
  }

  if (dates[index]!.status !== "pending") {
    res.status(409).json({ error: "This date was already decided" });
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
    .where(
      and(
        eq(attendanceRequestsTable.id, id),
        eq(attendanceRequestsTable.updatedAt, request.updatedAt),
      ),
    )
    .returning();

  if (updated.length === 0) {
    res.status(409).json({ error: "Request was updated by someone else. Refresh and retry." });
    return;
  }

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
}

router.patch("/requests/:id/dates/:index", async (req, res): Promise<void> => {
  try {
    const id = String(req.params["id"] ?? "");
    const index = Number(req.params["index"] ?? -1);
    const { status } = req.body as { status?: "approved" | "rejected" };
    if (status !== "approved" && status !== "rejected") {
      res.status(400).json({ error: "status must be approved or rejected" });
      return;
    }
    await applyDateDecision(req, res, id, index, status);
  } catch (err) {
    req.log.error({ err }, "Error deciding request date");
    res.status(500).json({ error: "Failed to update request" });
  }
});

router.patch("/requests/:id/decision", async (req, res): Promise<void> => {
  try {
    const session = req.session!;
    const id = String(req.params["id"] ?? "");
    const { status } = req.body as { status?: "approved" | "rejected" };
    if (status !== "approved" && status !== "rejected") {
      res.status(400).json({ error: "status must be approved or rejected" });
      return;
    }

    if (!canManageRequests(session.role as Role)) {
      res.status(403).json({ error: "Read-only access" });
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
    if (!campusAllowed(session, request.campus)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const now = new Date().toISOString();
    const dates = request.dates.map((d) =>
      d.status === "pending"
        ? {
            ...d,
            status,
            decidedBy: session.email,
            decidedAt: now,
          }
        : d,
    );

    const updated = await db
      .update(attendanceRequestsTable)
      .set({
        dates,
        overallStatus: rollupStatus(dates),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(attendanceRequestsTable.id, id),
          eq(attendanceRequestsTable.updatedAt, request.updatedAt),
        ),
      )
      .returning();

    if (updated.length === 0) {
      res.status(409).json({ error: "Request was updated by someone else. Refresh and retry." });
      return;
    }

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
  } catch (err) {
    req.log.error({ err }, "Error deciding request");
    res.status(500).json({ error: "Failed to update request" });
  }
});

export default router;
