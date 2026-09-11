import { Router } from "express";
import { requireSession } from "../lib/auth.js";
import { scopeForSession } from "../lib/rbac.js";
import {
  getCampusSummary,
  getSectionSummary,
  getSubjectSummary,
  getStudentsList,
  getDashboardFilterOptions,
  getSubjectSessions,
  getSessionStudents,
  getCampusSessions,
  getSubjectProdSequence,
  getRecoveryProgress,
  getAttendanceBySessionId,
  getProdSequenceSessionTracker,
  scheduleRecoverySession,
  getAssessmentCampusSummary,
  getAssessmentSubjects,
  getAssessmentStudents,
  parseDateRange,
  dateRangeCacheKey,
} from "../lib/queries.js";
import { REQUIRED_PCT } from "../lib/rbac.js";
import { cacheDeletePrefix, cacheGet, cacheSet } from "../lib/cache.js";
import { spiSharePath } from "../lib/spiToken.js";
import type { Role } from "../lib/rbac.js";
import { BIGQUERY_TO_CURRICULUM_SUBJECT } from "../seed/cdu-curriculum.js";

const router = Router();

router.use(requireSession());
router.use((req, res, next) => {
  if (req.session?.role === "instructor") {
    res.status(403).json({
      error: "Instructors can only view their assigned recovery sessions",
    });
    return;
  }
  next();
});

router.get("/summary", requireSession(), async (req, res): Promise<void> => {
  const session = req.session!;
  const scope = scopeForSession({
    role: session.role as Role,
    campuses: session.campuses,
    subjects: session.subjects,
  });
  const cacheKey = `summary:${session.role}:${JSON.stringify(scope)}`;
  const cached = cacheGet<object>(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }
  try {
    const [campusBreakdown, sectionBreakdown, subjectBreakdown, worstStudents] =
      await Promise.all([
        getCampusSummary(scope),
        getSectionSummary(scope),
        getSubjectSummary(scope),
        getStudentsList(scope, { limit: 5 }),
      ]);
    const totalStudents = campusBreakdown.reduce(
      (s, c) => s + c.studentCount,
      0,
    );
    const totalPresent = campusBreakdown.reduce(
      (s, c) => s + c.presentCount,
      0,
    );
    const totalSessions = campusBreakdown.reduce((s, c) => s + c.totalCount, 0);
    const avgPct =
      totalSessions > 0
        ? Math.round((totalPresent / totalSessions) * 1000) / 10
        : 0;
    const subjectsBelow80 = subjectBreakdown.filter((s) => s.pct < 80).length;
    const summary = {
      totalStudents,
      totalCampuses: campusBreakdown.length,
      avgAttendancePct: avgPct,
      subjectsBelow80,
      subjectBreakdown,
      campusBreakdown,
      sectionBreakdown,
      needsAttention: worstStudents,
      updatedAt: new Date().toISOString(),
    };
    cacheSet(cacheKey, summary, 60 * 1000);
    res.json(summary);
  } catch (err) {
    req.log.error({ err }, "Error fetching dashboard summary");
    res.status(500).json({ error: "Failed to fetch dashboard data" });
  }
});

router.get("/filters", requireSession(), async (req, res): Promise<void> => {
  const session = req.session!;
  const scope = scopeForSession({
    role: session.role as Role,
    campuses: session.campuses,
    subjects: session.subjects,
  });
  const campus = req.query["campus"] as string | undefined;
  const cacheKey = `filters:${session.role}:${JSON.stringify(scope)}:${campus ?? ""}`;
  const cached = cacheGet<object>(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }
  try {
    const options = await getDashboardFilterOptions(scope, {
      campus: campus || undefined,
    });
    cacheSet(cacheKey, options, 60 * 1000);
    res.json(options);
  } catch (err) {
    req.log.error({ err }, "Error fetching dashboard filters");
    res.status(500).json({ error: "Failed to fetch filter options" });
  }
});

router.get("/subjects", requireSession(), async (req, res): Promise<void> => {
  const session = req.session!;
  const scope = scopeForSession({
    role: session.role as Role,
    campuses: session.campuses,
    subjects: session.subjects,
  });
  const q = req.query as Record<string, string | undefined>;
  const campus = q["campus"] || undefined;
  const dateRange = parseDateRange(q);
  const cacheKey = `subjects:${session.role}:${JSON.stringify(scope)}:${campus ?? ""}:${dateRangeCacheKey(dateRange)}`;
  const cached = cacheGet<object>(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }
  try {
    const subjects = await getSubjectSummary(scope, { campus, dateRange });
    cacheSet(cacheKey, subjects, 60 * 1000);
    res.json(subjects);
  } catch (err) {
    req.log.error({ err }, "Error fetching subject attendance");
    res.status(500).json({ error: "Failed to fetch subject attendance" });
  }
});

router.get(
  "/prod-sequence",
  requireSession(),
  async (req, res): Promise<void> => {
    const session = req.session!;
    const scope = scopeForSession({
      role: session.role as Role,
      campuses: session.campuses,
      subjects: session.subjects,
    });
    const query = req.query as Record<string, string | undefined>;
    const campus = query["campus"];
    const subject = query["subject"];
    const semester = query["semester"] || undefined;
    if (!campus || !subject) {
      res.status(400).json({ error: "campus and subject required" });
      return;
    }
    if (scope.campuses?.length && !scope.campuses.includes(campus)) {
      res.status(403).json({ error: "Not permitted for this campus" });
      return;
    }
    if (scope.subjects?.length && !scope.subjects.includes(subject)) {
      res.status(403).json({ error: "Not permitted for this subject" });
      return;
    }

    const cacheKey = `prod-sequence:${session.role}:${JSON.stringify(scope)}:${campus}:${subject}:${semester ?? ""}`;
    const cached = cacheGet<object>(cacheKey);
    if (cached) {
      res.json(cached);
      return;
    }
    try {
      const rows = await getSubjectProdSequence(campus, subject, semester);
      cacheSet(cacheKey, rows, 60 * 1000);
      res.json(rows);
    } catch (err) {
      req.log.error({ err }, "Error fetching subject prod sequence");
      res.status(500).json({ error: "Failed to fetch subject prod sequence" });
    }
  },
);

// Campus rollup for the Campus-wise Stats view. Scope-filtered like every
// other dashboard route, so a BOA only ever sees their own campuses.
router.get("/campuses", requireSession(), async (req, res): Promise<void> => {
  const session = req.session!;
  const scope = scopeForSession({
    role: session.role as Role,
    campuses: session.campuses,
    subjects: session.subjects,
  });
  const dateRange = parseDateRange(req.query as Record<string, string | undefined>);
  const cacheKey = `campuses:${session.role}:${JSON.stringify(scope)}:${dateRangeCacheKey(dateRange)}`;
  const cached = cacheGet<object>(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }
  try {
    const campuses = await getCampusSummary(scope, { dateRange });
    const payload = campuses.map((c) => ({
      ...c,
      belowRequirement: c.pct < REQUIRED_PCT,
    }));
    cacheSet(cacheKey, payload, 60 * 1000);
    res.json(payload);
  } catch (err) {
    req.log.error({ err }, "Error fetching campus stats");
    res.status(500).json({ error: "Failed to fetch campus stats" });
  }
});

// Every session at one campus, flattened across subjects — powers the
// campus drill-down table.
router.get(
  "/campus-sessions",
  requireSession(),
  async (req, res): Promise<void> => {
    const session = req.session!;
    if (session.role === "instructor") {
      res.status(403).json({ error: "Instructors can only view their assigned recovery sessions" });
      return;
    }
    const scope = scopeForSession({
      role: session.role as Role,
      campuses: session.campuses,
      subjects: session.subjects,
    });
    const q = req.query as Record<string, string | undefined>;
    const campus = q["campus"];
    if (!campus) {
      res.status(400).json({ error: "campus required" });
      return;
    }
    const section = q["section"] || undefined;
    const dateRange = parseDateRange(q);
    const cacheKey = `campus-sessions:${session.role}:${JSON.stringify(scope)}:${campus}:${section ?? ""}:${dateRangeCacheKey(dateRange)}`;
    const cached = cacheGet<object>(cacheKey);
    if (cached) {
      res.json(cached);
      return;
    }
    try {
      const rows = await getCampusSessions(scope, { campus, section, dateRange });
      cacheSet(cacheKey, rows, 60 * 1000);
      res.json(rows);
    } catch (err) {
      req.log.error({ err }, "Error fetching campus sessions");
      res.status(500).json({ error: "Failed to fetch campus sessions" });
    }
  },
);

// Session (unit) rollup inside one subject.
router.get("/sessions", requireSession(), async (req, res): Promise<void> => {
  const session = req.session!;
  const scope = scopeForSession({
    role: session.role as Role,
    campuses: session.campuses,
    subjects: session.subjects,
  });
  const q = req.query as Record<string, string | undefined>;
  const subject = q["subject"];
  if (!subject) {
    res.status(400).json({ error: "subject required" });
    return;
  }
  const campus = q["campus"] || undefined;
  const section = q["section"] || undefined;
  const dateRange = parseDateRange(q);
  const cacheKey = `sessions:${session.role}:${JSON.stringify(scope)}:${subject}:${campus ?? ""}:${section ?? ""}:${dateRangeCacheKey(dateRange)}`;
  const cached = cacheGet<object>(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }
  try {
    const sessions = await getSubjectSessions(scope, {
      subject,
      campus,
      section,
      dateRange,
    });
    cacheSet(cacheKey, sessions, 60 * 1000);
    res.json(sessions);
  } catch (err) {
    req.log.error({ err }, "Error fetching subject sessions");
    res.status(500).json({ error: "Failed to fetch sessions" });
  }
});

// Per-student attendance for a single session of a subject.
router.get(
  "/session-students",
  requireSession(),
  async (req, res): Promise<void> => {
    const session = req.session!;
    if (session.role === "instructor") {
      res.status(403).json({ error: "Instructors can only view their assigned recovery sessions" });
      return;
    }
    const scope = scopeForSession({
      role: session.role as Role,
      campuses: session.campuses,
      subjects: session.subjects,
    });
    const q = req.query as Record<string, string | undefined>;
    const subject = q["subject"];
    const sessionTitle = q["sessionTitle"];
    if (!subject || !sessionTitle) {
      res.status(400).json({ error: "subject and sessionTitle required" });
      return;
    }
    try {
      const students = await getSessionStudents(scope, {
        subject,
        sessionTitle,
        date: q["date"] || undefined,
        campus: q["campus"] || undefined,
        section: q["section"] || undefined,
      });
      const withPaths = students.map((s) => ({
        ...s,
        spiPath: spiSharePath(s.studentId),
      }));
      res.json(withPaths);
    } catch (err) {
      req.log.error({ err }, "Error fetching session students");
      res.status(500).json({ error: "Failed to fetch session students" });
    }
  },
);

router.get("/students", requireSession(), async (req, res): Promise<void> => {
  const session = req.session!;
  const scope = scopeForSession({
    role: session.role as Role,
    campuses: session.campuses,
    subjects: session.subjects,
  });
  const q = req.query as Record<string, string | undefined>;
  const search = q["search"];
  const rawLimit = Number(q["limit"] ?? 200);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(rawLimit, 1), 5000)
    : 200;
  const campus = q["campus"] || undefined;
  const section = q["section"] || undefined;
  const subject = q["subject"] || undefined;
  const attendanceBand = q["attendanceBand"] || undefined;
  const dateRange = parseDateRange(q);
  try {
    const students = await getStudentsList(scope, {
      search,
      limit,
      campus,
      section,
      subject,
      attendanceBand,
      dateRange,
    });
    const withPaths = students.map((s) => ({
      studentId: s.studentId,
      studentName: s.studentName,
      instituteName: s.instituteName ?? "",
      sectionName: s.sectionName ?? null,
      presentCount: s.presentCount ?? 0,
      totalCount: s.totalCount ?? 0,
      attendancePct: s.attendancePct ?? 0,
      classroomAvg: s.classroomAvg ?? null,
      moduleAvg: s.moduleAvg ?? null,
      spiPath: spiSharePath(s.studentId),
    }));
    res.json(withPaths);
  } catch (err) {
    req.log.error({ err }, "Error fetching dashboard students");
    res.status(500).json({ error: "Failed to fetch student list" });
  }
});

// Recovery progress for one subject at one campus.
router.get(
  "/recovery-progress",
  requireSession(),
  async (req, res): Promise<void> => {
    const session = req.session!;
    if (session.role === "instructor") {
      res.status(403).json({ error: "Instructors can only view their assigned recovery sessions" });
      return;
    }
    const scope = scopeForSession({
      role: session.role as Role,
      campuses: session.campuses,
      subjects: session.subjects,
    });
    const q = req.query as Record<string, string | undefined>;
    const campus = q["campus"];
    const bigQuerySubject = q["subject"];
    const section = q["section"] || undefined;
    const semester = q["semester"] || undefined;
    if (!campus || !bigQuerySubject) {
      res.status(400).json({ error: "campus and subject required" });
      return;
    }

    if (scope.campuses?.length && !scope.campuses.includes(campus)) {
      res.status(403).json({ error: "Not permitted for this campus" });
      return;
    }
    if (scope.subjects?.length && !scope.subjects.includes(bigQuerySubject)) {
      res.status(403).json({ error: "Not permitted for this subject" });
      return;
    }

    const cacheKey = `recovery-progress:${session.role}:${JSON.stringify(scope)}:${campus}:${bigQuerySubject}:${section ?? ""}:${semester ?? ""}`;
    const cached = cacheGet<object>(cacheKey);
    if (cached) {
      res.json(cached);
      return;
    }

    try {
      // Same source as the session-tracker table below this card: completed
      // lecture sessions from the live BigQuery prod sequence, matched to
      // their recovery status by curriculum subject. Attendance percentages
      // aren't needed for this card's counts, so an empty map is fine.
      const recoverySubject =
        BIGQUERY_TO_CURRICULUM_SUBJECT[bigQuerySubject] ?? bigQuerySubject;
      const tracker = await getProdSequenceSessionTracker(
        campus,
        bigQuerySubject,
        new Map(),
        section,
        semester,
        recoverySubject,
      );
      const totalTopics = tracker.length;
      const topicsRecovered = tracker.filter(
        (row) => row.status === "recovered",
      ).length;

      const progress = await getRecoveryProgress(
        campus,
        recoverySubject,
        totalTopics,
        topicsRecovered,
      );
      cacheSet(cacheKey, progress, 60 * 1000);
      res.json(progress);
    } catch (err) {
      req.log.error({ err }, "Error fetching recovery progress");
      res.status(500).json({ error: "Failed to fetch recovery progress" });
    }
  },
);

// Full curriculum delivery state for one subject at one campus. Topics and
// their delivery status come straight from the live BigQuery prod sequence
// (not the Postgres recovery_topics cache, which only reflects whatever the
// sync:recovery-curriculum script last wrote); attendance is joined by
// session_id, not title, since the attendance and prod-sequence tables name
// sessions differently. See getAttendanceBySessionId / getProdSequenceSessionTracker
// in lib/queries.ts for why.
router.get(
  "/session-tracker",
  requireSession(),
  async (req, res): Promise<void> => {
    const session = req.session!;
    const scope = scopeForSession({
      role: session.role as Role,
      campuses: session.campuses,
      subjects: session.subjects,
    });
    const q = req.query as Record<string, string | undefined>;
    const campus = q["campus"];
    const bigQuerySubject = q["subject"];
    const section = q["section"] || undefined;
    const semester = q["semester"] || undefined;
    if (!campus || !bigQuerySubject) {
      res.status(400).json({ error: "campus and subject required" });
      return;
    }

    if (scope.campuses?.length && !scope.campuses.includes(campus)) {
      res.status(403).json({ error: "Not permitted for this campus" });
      return;
    }
    if (scope.subjects?.length && !scope.subjects.includes(bigQuerySubject)) {
      res.status(403).json({ error: "Not permitted for this subject" });
      return;
    }

    const cacheKey = `session-tracker:${session.role}:${JSON.stringify(scope)}:${campus}:${bigQuerySubject}:${section ?? ""}:${semester ?? ""}`;
    const cached = cacheGet<object>(cacheKey);
    if (cached) {
      res.json(cached);
      return;
    }

    try {
      const recoverySubject =
        BIGQUERY_TO_CURRICULUM_SUBJECT[bigQuerySubject] ?? bigQuerySubject;
      const attendanceBySessionId = await getAttendanceBySessionId(
        campus,
        bigQuerySubject,
        semester,
        section,
      );
      const tracker = await getProdSequenceSessionTracker(
        campus,
        bigQuerySubject,
        attendanceBySessionId,
        section,
        semester,
        recoverySubject,
      );
      cacheSet(cacheKey, tracker, 60 * 1000);
      res.json(tracker);
    } catch (err) {
      req.log.error({ err }, "Error fetching recovery session tracker");
      res.status(500).json({ error: "Failed to fetch recovery session tracker" });
    }
  },
);

// Books a future recovery session for a set of not-yet-recovered topics.
// campus/subject follow the same conventions as session-tracker above: the
// caller passes the raw BigQuery subject_title, which is resolved here to
// the curriculum subject before touching recovery_sessions/recovery_topics.
router.post(
  "/recovery-sessions",
  requireSession(),
  async (req, res): Promise<void> => {
    const session = req.session!;
    if (session.role === "instructor") {
      res.status(403).json({
        error: "Instructors can only view their assigned recovery sessions",
      });
      return;
    }
    const scope = scopeForSession({
      role: session.role as Role,
      campuses: session.campuses,
      subjects: session.subjects,
    });
    const body = req.body as {
      campus?: string;
      subject?: string;
      section?: string;
      scheduledDate?: string;
      startTime?: string;
      endTime?: string;
      instructorName?: string;
      studentsExpected?: number;
      topicTitles?: string[];
    };
    const campus = body.campus;
    const bigQuerySubject = body.subject;
    if (!campus || !bigQuerySubject) {
      res.status(400).json({ error: "campus and subject required" });
      return;
    }
    if (scope.campuses?.length && !scope.campuses.includes(campus)) {
      res.status(403).json({ error: "Not permitted for this campus" });
      return;
    }
    if (scope.subjects?.length && !scope.subjects.includes(bigQuerySubject)) {
      res.status(403).json({ error: "Not permitted for this subject" });
      return;
    }

    const scheduledDate = body.scheduledDate ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate)) {
      res.status(400).json({ error: "scheduledDate must be YYYY-MM-DD" });
      return;
    }
    const instructorName = (body.instructorName ?? "").trim();
    if (!instructorName) {
      res.status(400).json({ error: "instructorName required" });
      return;
    }
    const topicTitles = Array.isArray(body.topicTitles)
      ? body.topicTitles.filter(
          (t): t is string => typeof t === "string" && t.trim().length > 0,
        )
      : [];
    if (topicTitles.length === 0) {
      res.status(400).json({ error: "Select at least one topic" });
      return;
    }
    const studentsExpected =
      typeof body.studentsExpected === "number" &&
      Number.isFinite(body.studentsExpected)
        ? Math.max(0, Math.round(body.studentsExpected))
        : undefined;

    const recoverySubject =
      BIGQUERY_TO_CURRICULUM_SUBJECT[bigQuerySubject] ?? bigQuerySubject;

    try {
      const result = await scheduleRecoverySession({
        campus,
        subject: recoverySubject,
        section: body.section,
        scheduledDate,
        startTime: body.startTime,
        endTime: body.endTime,
        instructorName,
        studentsExpected,
        topicTitles,
      });
      if (!result.ok) {
        res.status(400).json({ error: result.error });
        return;
      }
      cacheDeletePrefix("session-tracker:");
      cacheDeletePrefix("recovery-progress:");
      res.status(201).json(result.session);
    } catch (err) {
      req.log.error({ err }, "Error scheduling recovery session");
      res.status(500).json({ error: "Failed to schedule recovery session" });
    }
  },
);

router.get(
  "/assessment-campuses",
  requireSession(),
  async (req, res): Promise<void> => {
    const session = req.session!;
    const scope = scopeForSession({
      role: session.role as Role,
      campuses: session.campuses,
      subjects: session.subjects,
    });
    const q = req.query as Record<string, string | undefined>;
    const campus = q["campus"] || undefined;
    const semester = q["semester"] || undefined;
    const cacheKey = `assessment-campuses:${session.role}:${JSON.stringify(scope)}:${campus ?? ""}:${semester ?? ""}`;
    const cached = cacheGet<object>(cacheKey);
    if (cached) {
      res.json(cached);
      return;
    }
    try {
      const campuses = await getAssessmentCampusSummary(scope, {
        campus,
        semester,
      });
      cacheSet(cacheKey, campuses, 60 * 1000);
      res.json(campuses);
    } catch (err) {
      req.log.error({ err }, "Error fetching assessment campus stats");
      res.status(500).json({ error: "Failed to fetch assessment campus stats" });
    }
  },
);

router.get(
  "/assessment-subjects",
  requireSession(),
  async (req, res): Promise<void> => {
    const session = req.session!;
    const scope = scopeForSession({
      role: session.role as Role,
      campuses: session.campuses,
      subjects: session.subjects,
    });
    const q = req.query as Record<string, string | undefined>;
    const campus = q["campus"];
    const semester = q["semester"] || undefined;
    if (!campus) {
      res.status(400).json({ error: "campus required" });
      return;
    }
    const cacheKey = `assessment-subjects:${session.role}:${JSON.stringify(scope)}:${campus}:${semester ?? ""}`;
    const cached = cacheGet<object>(cacheKey);
    if (cached) {
      res.json(cached);
      return;
    }
    try {
      const subjects = await getAssessmentSubjects(scope, { campus, semester });
      cacheSet(cacheKey, subjects, 60 * 1000);
      res.json(subjects);
    } catch (err) {
      req.log.error({ err }, "Error fetching assessment subjects");
      res.status(500).json({ error: "Failed to fetch assessment subjects" });
    }
  },
);

router.get(
  "/assessment-students",
  requireSession(),
  async (req, res): Promise<void> => {
    const session = req.session!;
    const scope = scopeForSession({
      role: session.role as Role,
      campuses: session.campuses,
      subjects: session.subjects,
    });
    const q = req.query as Record<string, string | undefined>;
    const campus = q["campus"] || undefined;
    const subject = q["subject"] || undefined;
    const semester = q["semester"] || undefined;
    const search = q["search"] || undefined;
    const rawLimit = Number(q["limit"] ?? 2000);
    const limit = Number.isFinite(rawLimit)
      ? Math.min(Math.max(rawLimit, 1), 5000)
      : 2000;
    const cacheKey = `assessment-students:${session.role}:${JSON.stringify(scope)}:${campus ?? ""}:${subject ?? ""}:${semester ?? ""}:${search ?? ""}:${limit}`;
    const cached = cacheGet<object>(cacheKey);
    if (cached) {
      res.json(cached);
      return;
    }
    try {
      const students = await getAssessmentStudents(scope, {
        campus,
        subject,
        semester,
        search,
        limit,
      });
      const payload = students.map((s) => ({
        ...s,
        spiPath: spiSharePath(s.studentId),
      }));
      cacheSet(cacheKey, payload, 60 * 1000);
      res.json(payload);
    } catch (err) {
      req.log.error({ err }, "Error fetching assessment students");
      res.status(500).json({ error: "Failed to fetch assessment students" });
    }
  },
);

export default router;
