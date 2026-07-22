import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { db } from "@workspace/db";
import {
  attendanceRequestsTable,
  notificationsTable,
  usersTable,
  type RequestDate,
} from "@workspace/db";
import { and, eq, inArray, or } from "drizzle-orm";
import { requireSession, getSessionFromRequest } from "../lib/auth.js";
import { verifySpiToken } from "../lib/spiToken.js";
import { validateStudentId } from "../lib/bigquery.js";
import { cacheGet, cacheSet } from "../lib/cache.js";
import { scopeForSession } from "../lib/rbac.js";
import {
  getStudentOverview,
  getStudentSubjects,
  getStudentRecentSessions,
  searchStudents,
  getStudentQuizzes,
} from "../lib/queries.js";
import type { Role } from "../lib/rbac.js";

const router = Router();

const spiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

function checkStudentAccess(
  req: Parameters<typeof getSessionFromRequest>[0],
  studentId: string,
): boolean {
  const session = getSessionFromRequest(req);
  if (session) return true;
  const token = (req.query as Record<string, string | undefined>)["t"];
  if (token && verifySpiToken(studentId, token)) return true;
  return false;
}

// Search students - staff only, scoped
router.get("/search", requireSession(), async (req, res): Promise<void> => {
  const session = req.session!;
  const scope = scopeForSession({
    role: session.role as Role,
    campuses: session.campuses,
    subjects: session.subjects,
  });
  const q = (req.query as Record<string, string>)["q"] ?? "";
  const limit = Math.min(
    Number((req.query as Record<string, string>)["limit"] ?? "50"),
    50,
  );
  if (!q || q.length < 1) {
    res.json([]);
    return;
  }
  try {
    const results = await searchStudents(q, limit, scope);
    res.json(results);
  } catch (err) {
    req.log.error({ err }, "Error searching students");
    res.status(500).json({ error: "Failed to search students" });
  }
});

// Individual student routes - public via SPI token OR staff
router.get(
  "/students/:studentId/overview",
  spiLimiter,
  async (req, res): Promise<void> => {
    const studentId = String(req.params["studentId"] ?? "");
    if (!studentId || !validateStudentId.test(studentId)) {
      res.status(400).json({ error: "Invalid student ID" });
      return;
    }
    if (!checkStudentAccess(req, studentId)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const cacheKey = `overview:${studentId}`;
    const cached = cacheGet<object>(cacheKey);
    if (cached) {
      res.json(cached);
      return;
    }
    try {
      const data = await getStudentOverview(studentId);
      if (!data) {
        res.status(404).json({ error: "Student not found" });
        return;
      }
      cacheSet(cacheKey, data, 5 * 60 * 1000);
      res.json(data);
    } catch (err) {
      req.log.error({ err }, "Error fetching student overview");
      res.status(500).json({ error: "Failed to fetch student data" });
    }
  },
);

router.get(
  "/students/:studentId/subjects",
  spiLimiter,
  async (req, res): Promise<void> => {
    const studentId = String(req.params["studentId"] ?? "");
    if (!studentId || !validateStudentId.test(studentId)) {
      res.status(400).json({ error: "Invalid student ID" });
      return;
    }
    if (!checkStudentAccess(req, studentId)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const cacheKey = `subjects:${studentId}`;
    const cached = cacheGet<object[]>(cacheKey);
    if (cached) {
      res.json(cached);
      return;
    }
    try {
      const data = await getStudentSubjects(studentId);
      cacheSet(cacheKey, data, 5 * 60 * 1000);
      res.json(data);
    } catch (err) {
      req.log.error({ err }, "Error fetching student subjects");
      res.status(500).json({ error: "Failed to fetch subject data" });
    }
  },
);

router.get(
  "/students/:studentId/recent",
  spiLimiter,
  async (req, res): Promise<void> => {
    const studentId = String(req.params["studentId"] ?? "");
    if (!studentId || !validateStudentId.test(studentId)) {
      res.status(400).json({ error: "Invalid student ID" });
      return;
    }
    if (!checkStudentAccess(req, studentId)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const cacheKey = `recent:${studentId}`;
    const cached = cacheGet<object[]>(cacheKey);
    if (cached) {
      res.json(cached);
      return;
    }
    try {
      const data = await getStudentRecentSessions(studentId);
      cacheSet(cacheKey, data, 5 * 60 * 1000);
      res.json(data);
    } catch (err) {
      req.log.error({ err }, "Error fetching recent sessions");
      res.status(500).json({ error: "Failed to fetch session data" });
    }
  },
);

router.get(
  "/students/:studentId/quizzes",
  spiLimiter,
  async (req, res): Promise<void> => {
    const studentId = String(req.params["studentId"] ?? "");
    if (!studentId || !validateStudentId.test(studentId)) {
      res.status(400).json({ error: "Invalid student ID" });
      return;
    }
    if (!checkStudentAccess(req, studentId)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const cacheKey = `quizzes:${studentId}`;
    const cached = cacheGet<object>(cacheKey);
    if (cached) {
      res.json(cached);
      return;
    }
    try {
      const data = await getStudentQuizzes(studentId);
      cacheSet(cacheKey, data, 5 * 60 * 1000);
      res.json(data);
    } catch (err) {
      req.log.error({ err }, "Error fetching quizzes");
      res.status(500).json({ error: "Failed to fetch quiz data" });
    }
  },
);

// Submit an attendance-correction request from the SPI report. Public via the
// SPI token (or a staff session). Routes to the student's campus BOA + all
// admins/superadmins via notifications.
router.post(
  "/students/:studentId/requests",
  spiLimiter,
  async (req, res): Promise<void> => {
    const studentId = String(req.params["studentId"] ?? "");
    if (!studentId || !validateStudentId.test(studentId)) {
      res.status(400).json({ error: "Invalid student ID" });
      return;
    }
    if (!checkStudentAccess(req, studentId)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const body = req.body as { dates?: { date?: string; reason?: string }[] };
    const dates: RequestDate[] = (Array.isArray(body.dates) ? body.dates : [])
      .filter((d) => d && typeof d.date === "string" && d.date.trim() !== "")
      .map((d) => ({
        date: String(d.date).slice(0, 10),
        reason: String(d.reason ?? "").slice(0, 500),
        status: "pending" as const,
        decidedBy: null,
        decidedAt: null,
      }));
    if (dates.length === 0) {
      res.status(400).json({ error: "At least one date is required" });
      return;
    }

    let campus = "";
    let studentName = "";
    try {
      const overview = await getStudentOverview(studentId);
      campus = overview?.instituteName ?? "";
      studentName = overview?.studentName ?? "";
    } catch (err) {
      req.log.error({ err }, "Failed to resolve student campus for request");
    }

    const inserted = await db
      .insert(attendanceRequestsTable)
      .values({
        studentId,
        studentName,
        campus,
        dates,
        overallStatus: "pending",
      })
      .returning();
    const request = inserted[0]!;

    const staff = await db
      .select()
      .from(usersTable)
      .where(
        and(
          eq(usersTable.isActive, true),
          or(
            inArray(usersTable.role, ["superadmin", "admin"]),
            eq(usersTable.role, "boa"),
          ),
        ),
      );
    const recipients = staff.filter((u) => {
      if (u.role === "superadmin" || u.role === "admin") return true;
      if (u.role === "boa")
        return u.campuses.length === 0 || u.campuses.includes(campus);
      return false;
    });

    if (recipients.length > 0) {
      const dateLabel =
        dates.length === 1 ? dates[0]!.date : `${dates.length} dates`;
      await db.insert(notificationsTable).values(
        recipients.map((u) => ({
          userId: u.id,
          requestId: request.id,
          title: `Attendance request from ${studentName || studentId}`,
          body: `${campus || "Unknown campus"} · ${dateLabel}`,
        })),
      );
    }

    res.status(201).json({
      id: request.id,
      studentId: request.studentId,
      studentName: request.studentName,
      campus: request.campus,
      dates: request.dates,
      overallStatus: request.overallStatus,
      createdAt: request.createdAt.toISOString(),
      notifiedCount: recipients.length,
    });
  },
);

export default router;
