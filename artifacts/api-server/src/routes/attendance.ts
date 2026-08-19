import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { db } from "@workspace/db";
import {
  attendanceRequestsTable,
  notificationsTable,
  usersTable,
  type RequestDate,
} from "@workspace/db";
import { and, eq, inArray, or, desc } from "drizzle-orm";
import { requireSession, getSessionFromRequest } from "../lib/auth.js";
import {
  makeCampusAccessToken,
  makeSpiToken,
  verifyCampusAccessToken,
  verifySpiToken,
} from "../lib/spiToken.js";
import { validateStudentId } from "../lib/bigquery.js";
import { cacheGet, cacheSet } from "../lib/cache.js";
import { assertStudentAccess } from "../lib/studentAccess.js";
import {
  getStudentOverview,
  getStudentSubjects,
  getStudentRecentSessions,
  searchStudents,
  getStudentQuizzes,
  getCampusSubjectRecovery,
  getCampusSummary,
} from "../lib/queries.js";
import type { Role } from "../lib/rbac.js";
import { scopeForSession } from "../lib/rbac.js";

const router = Router();

const spiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

function hasSpiTokenAccess(
  req: Parameters<typeof getSessionFromRequest>[0],
  studentId: string,
): boolean {
  const token = (req.query as Record<string, string | undefined>)["t"];
  return Boolean(token && verifySpiToken(studentId, token));
}

function getBearerOrQueryToken(req: Parameters<typeof getSessionFromRequest>[0]): string {
  const header = req.headers.authorization ?? "";
  if (header.startsWith("Bearer ")) {
    return header.slice("Bearer ".length).trim();
  }
  const query = req.query as Record<string, string | undefined>;
  return query["token"] ?? query["access_token"] ?? query["campusToken"] ?? "";
}

router.post(
  "/spi-token",
  requireSession(),
  async (req, res): Promise<void> => {
    const studentId = String((req.body as { studentId?: string } | undefined)?.studentId ?? "");
    if (!studentId || !validateStudentId.test(studentId)) {
      res.status(400).json({ error: "Valid studentId is required" });
      return;
    }

    try {
      const token = makeSpiToken(studentId);
      const exp = Number(token.split(".")[0]);
      res.json({
        studentId,
        token,
        expiresAt: new Date(exp * 1000).toISOString(),
        shareUrl: `/spi/${studentId}?t=${encodeURIComponent(token)}`,
        apiUrl: `/api/attendance/students/${studentId}/overview?t=${encodeURIComponent(token)}`,
      });
    } catch (err) {
      req.log.error({ err }, "Error generating SPI token");
      res.status(500).json({ error: "Failed to generate SPI token" });
    }
  },
);

router.post(
  "/campus-access-token",
  requireSession(),
  async (req, res): Promise<void> => {
    const campus = String((req.body as { campus?: string } | undefined)?.campus ?? "");
    if (!campus) {
      res.status(400).json({ error: "Valid campus is required" });
      return;
    }

    try {
      const token = makeCampusAccessToken(campus);
      const exp = Number(token.split(".")[0]);
      res.json({
        campus,
        token,
        expiresAt: new Date(exp * 1000).toISOString(),
        summaryUrl: `/api/attendance/campus-summary?campus=${encodeURIComponent(campus)}&token=${encodeURIComponent(token)}`,
        recoveryUrl: `/api/attendance/campus-recovery?campus=${encodeURIComponent(campus)}&token=${encodeURIComponent(token)}`,
      });
    } catch (err) {
      req.log.error({ err }, "Error generating campus access token");
      res.status(500).json({ error: "Failed to generate campus access token" });
    }
  },
);

router.get("/campus-summary", async (req, res): Promise<void> => {
  const campus = String((req.query as Record<string, string | undefined>)["campus"] ?? "");
  const token = getBearerOrQueryToken(req as Parameters<typeof getSessionFromRequest>[0]);

  if (!campus) {
    res.status(400).json({ error: "Campus parameter is required" });
    return;
  }

  if (!verifyCampusAccessToken(campus, token)) {
    res.status(403).json({ error: "Forbidden: invalid campus access token" });
    return;
  }

  try {
    const rows = await getCampusSummary({ campuses: [campus] });
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "Error fetching campus summary");
    res.status(500).json({ error: "Failed to fetch campus summary" });
  }
});

router.get("/campus-recovery", async (req, res): Promise<void> => {
  const campus = String((req.query as Record<string, string | undefined>)["campus"] ?? "");
  const token = getBearerOrQueryToken(req as Parameters<typeof getSessionFromRequest>[0]);

  if (!campus) {
    res.status(400).json({ error: "Campus parameter is required" });
    return;
  }

  if (!verifyCampusAccessToken(campus, token)) {
    res.status(403).json({ error: "Forbidden: invalid campus access token" });
    return;
  }

  try {
    const data = await getCampusSubjectRecovery(campus, { campuses: [campus] });
    res.json(data);
  } catch (err) {
    req.log.error({ err }, "Error fetching campus recovery data" );
    res.status(500).json({ error: "Failed to fetch campus recovery data" });
  }
});

async function canAccessStudent(
  req: Parameters<typeof getSessionFromRequest>[0],
  studentId: string,
): Promise<boolean> {
  if (getSessionFromRequest(req)) {
    return assertStudentAccess(req, studentId);
  }
  return hasSpiTokenAccess(req, studentId);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseRequestDates(
  raw: unknown,
): { dates: RequestDate[]; error?: string } {
  if (!Array.isArray(raw)) {
    return { dates: [], error: "dates must be an array" };
  }
  if (raw.length === 0) {
    return { dates: [], error: "At least one date is required" };
  }
  if (raw.length > 10) {
    return { dates: [], error: "Maximum 10 dates per request" };
  }
  const today = new Date().toISOString().slice(0, 10);
  const seen = new Set<string>();
  const dates: RequestDate[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const d = item as { date?: string; reason?: string };
    const date = String(d.date ?? "").slice(0, 10);
    if (!DATE_RE.test(date)) {
      return { dates: [], error: "Each date must be YYYY-MM-DD" };
    }
    if (date > today) {
      return { dates: [], error: "Future dates are not allowed" };
    }
    if (seen.has(date)) continue;
    seen.add(date);
    dates.push({
      date,
      reason: String(d.reason ?? "").slice(0, 500),
      status: "pending",
      decidedBy: null,
      decidedAt: null,
    });
  }
  if (dates.length === 0) {
    return { dates: [], error: "At least one valid date is required" };
  }
  return { dates };
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
    if (!(await canAccessStudent(req, studentId))) {
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
    if (!(await canAccessStudent(req, studentId))) {
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
    if (!(await canAccessStudent(req, studentId))) {
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
    if (!(await canAccessStudent(req, studentId))) {
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

// List attendance-correction requests submitted by a student (SPI report).
router.get(
  "/students/:studentId/requests",
  spiLimiter,
  async (req, res): Promise<void> => {
    const studentId = String(req.params["studentId"] ?? "");
    if (!studentId || !validateStudentId.test(studentId)) {
      res.status(400).json({ error: "Invalid student ID" });
      return;
    }
    if (!(await canAccessStudent(req, studentId))) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    try {
      const rows = await db
        .select()
        .from(attendanceRequestsTable)
        .where(eq(attendanceRequestsTable.studentId, studentId))
        .orderBy(desc(attendanceRequestsTable.createdAt));
      res.json(
        rows.map((r) => ({
          id: r.id,
          studentId: r.studentId,
          studentName: r.studentName,
          campus: r.campus,
          dates: r.dates,
          overallStatus: r.overallStatus,
          createdAt: r.createdAt.toISOString(),
        })),
      );
    } catch (err) {
      req.log.error({ err }, "Error fetching student requests");
      res.status(500).json({ error: "Failed to fetch requests" });
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
    try {
      const studentId = String(req.params["studentId"] ?? "");
      if (!studentId || !validateStudentId.test(studentId)) {
        res.status(400).json({ error: "Invalid student ID" });
        return;
      }
      if (!(await canAccessStudent(req, studentId))) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }

      const body = req.body as { dates?: unknown };
      const parsed = parseRequestDates(body.dates);
      if (parsed.error) {
        res.status(400).json({ error: parsed.error });
        return;
      }
      const dates = parsed.dates;

      const overview = await getStudentOverview(studentId);
      if (!overview) {
        res.status(404).json({ error: "Student not found" });
        return;
      }
      const campus = overview.instituteName ?? "";
      const studentName = overview.studentName ?? "";

      const existing = await db
        .select()
        .from(attendanceRequestsTable)
        .where(eq(attendanceRequestsTable.studentId, studentId));
      for (const reqRow of existing) {
        if (reqRow.overallStatus === "rejected") continue;
        for (const d of dates) {
          if (
            reqRow.dates.some(
              (rd) => rd.date === d.date && rd.status === "pending",
            )
          ) {
            res.status(409).json({
              error: `A pending request already exists for ${d.date}`,
            });
            return;
          }
        }
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
        if (u.role === "boa") {
          return u.campuses.length > 0 && u.campuses.includes(campus);
        }
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
    } catch (err) {
      req.log.error({ err }, "Error submitting attendance request");
      res.status(500).json({ error: "Failed to submit request" });
    }
  },
);

// Recovery dashboard - subject-wise attendance below 80% by campus
router.get("/recovery/subjects", requireSession(), async (req, res): Promise<void> => {
  const session = req.session!;
  const scope = scopeForSession({
    role: session.role as Role,
    campuses: session.campuses,
    subjects: session.subjects,
  });
  const campus = (req.query as Record<string, string>)["campus"] ?? "";
  if (!campus) {
    res.status(400).json({ error: "Campus parameter is required" });
    return;
  }
  try {
    const data = await getCampusSubjectRecovery(campus, scope);
    res.json(data);
  } catch (err) {
    req.log.error({ err }, "Error fetching subject recovery data");
    res.status(500).json({ error: "Failed to fetch subject recovery data" });
  }
});

export default router;
