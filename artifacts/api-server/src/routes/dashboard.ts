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
  cancelRecoverySession,
  getRecoverySessionScope,
  getCampusInstructorRoster,
  getAllActiveInstructors,
  getAssessmentCampusSummary,
  getAssessmentSubjects,
  getAssessmentStudents,
  parseDateRange,
  parseSemester,
  dateRangeCacheKey,
  getAttendanceSemesters,
  getInstituteDirectory,
  getSpiAveragesByCampus,
  getSpiAveragesBySection,
  getSpiRecord,
  type SpiRecordGrain,
  getAttendanceGroupStats,
  type AttendanceGrain,
} from "../lib/queries.js";
import {
  getColumnSelection,
  sanitizeColumns,
  saveDefaultColumns,
  saveUserColumns,
} from "../lib/attendanceStatsColumns.js";
import { REQUIRED_PCT } from "../lib/rbac.js";
import { cacheDeletePrefix, cacheGet, cacheSet } from "../lib/cache.js";
import { spiSharePath } from "../lib/spiToken.js";
import type { Role } from "../lib/rbac.js";
import { BIGQUERY_TO_CURRICULUM_SUBJECT } from "../seed/cdu-curriculum.js";

const router = Router();

router.use(requireSession());

// Instructors get a narrow, read-only slice of this router: enough to browse
// their own campus/subject's Recovery tab (prod sequence + session tracker,
// scoped by scopeForSession same as everyone else) so they can see what's
// scheduled, who it's assigned to, and what's been completed. Everything
// else here -- student lists, attendance stats, assessments, scheduling,
// deleting sessions, admin actions -- stays off-limits. A new route is
// blocked by default; add it to this set deliberately, never by accident.
const INSTRUCTOR_ALLOWED_PATHS = new Set([
  "/filters",
  "/prod-sequence",
  "/recovery-progress",
  "/session-tracker",
]);
router.use((req, res, next) => {
  if (
    req.session?.role === "instructor" &&
    !INSTRUCTOR_ALLOWED_PATHS.has(req.path)
  ) {
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
  const q = req.query as Record<string, string | undefined>;
  const dateRange = parseDateRange(q);
  const semester = parseSemester(q);
  // lite=1: campus rollup only (Reports / directory counts) — skips the
  // expensive subject + section + worst-student scans.
  const lite = String(req.query["lite"] ?? "") === "1";
  const cacheKey = `summary:v5:${lite ? "lite:" : ""}${session.role}:${JSON.stringify(scope)}:${semester ?? ""}:${dateRangeCacheKey(dateRange)}`;
  const cached = cacheGet<object>(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }
  try {
    if (lite) {
      const campusBreakdown = await getCampusSummary(scope, {
        dateRange,
        semester,
      });
      const totalStudents = campusBreakdown.reduce(
        (s, c) => s + c.studentCount,
        0,
      );
      const totalPresentRecords = campusBreakdown.reduce(
        (s, c) => s + c.presentRecordCount,
        0,
      );
      const totalRecords = campusBreakdown.reduce(
        (s, c) => s + c.totalRecordCount,
        0,
      );
      const avgPct =
        totalRecords > 0
          ? Math.round((totalPresentRecords / totalRecords) * 1000) / 10
          : 0;
      const summary = {
        totalStudents,
        totalCampuses: campusBreakdown.length,
        avgAttendancePct: avgPct,
        subjectsBelow80: 0,
        subjectBreakdown: [],
        campusBreakdown,
        sectionBreakdown: [],
        needsAttention: [],
        updatedAt: new Date().toISOString(),
      };
      cacheSet(cacheKey, summary, 15 * 60 * 1000);
      res.json(summary);
      return;
    }

    const [campusBreakdown, sectionBreakdown, subjectBreakdown, worstStudents] =
      await Promise.all([
        getCampusSummary(scope, { dateRange, semester }),
        getSectionSummary(scope, { dateRange }),
        getSubjectSummary(scope, { dateRange }),
        getStudentsList(scope, { limit: 5, dateRange, semester }),
      ]);
    const totalStudents = campusBreakdown.reduce(
      (s, c) => s + c.studentCount,
      0,
    );
    const totalPresentRecords = campusBreakdown.reduce(
      (s, c) => s + c.presentRecordCount,
      0,
    );
    const totalRecords = campusBreakdown.reduce(
      (s, c) => s + c.totalRecordCount,
      0,
    );
    const avgPct =
      totalRecords > 0
        ? Math.round((totalPresentRecords / totalRecords) * 1000) / 10
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
    cacheSet(cacheKey, summary, 15 * 60 * 1000);
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
    cacheSet(cacheKey, options, 15 * 60 * 1000);
    res.json(options);
  } catch (err) {
    req.log.error({ err }, "Error fetching dashboard filters");
    res.status(500).json({ error: "Failed to fetch filter options" });
  }
});

router.get("/semesters", requireSession(), async (req, res): Promise<void> => {
  const session = req.session!;
  const scope = scopeForSession({
    role: session.role as Role,
    campuses: session.campuses,
    subjects: session.subjects,
  });
  const campus = String(req.query["campus"] ?? "").trim() || undefined;
  if (campus && scope.campuses?.length && !scope.campuses.includes(campus)) {
    res.status(403).json({ error: "Not permitted for this campus" });
    return;
  }
  const cacheKey = `semesters:${session.role}:${JSON.stringify(scope)}:${campus ?? ""}`;
  const cached = cacheGet<string[]>(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }
  try {
    const semesters = await getAttendanceSemesters(scope, campus);
    cacheSet(cacheKey, semesters, 15 * 60 * 1000);
    res.json(semesters);
  } catch (err) {
    req.log.error({ err }, "Error fetching attendance semesters");
    res.status(500).json({ error: "Failed to fetch semesters" });
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
  const semester = parseSemester(q);
  const cacheKey = `subjects:v4:${session.role}:${JSON.stringify(scope)}:${campus ?? ""}:${semester ?? ""}:${dateRangeCacheKey(dateRange)}`;
  const cached = cacheGet<object>(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }
  try {
    const subjects = await getSubjectSummary(scope, { campus, dateRange, semester });
    cacheSet(cacheKey, subjects, 15 * 60 * 1000);
    res.json(subjects);
  } catch (err) {
    req.log.error({ err }, "Error fetching subject attendance");
    res.status(500).json({ error: "Failed to fetch subject attendance" });
  }
});

// Mean SPI (0–10) by campus or by section — avoids shipping 5k student rows
// just to average quiz scores on the client (Reports SPI Record).
router.get("/spi-averages", requireSession(), async (req, res): Promise<void> => {
  const session = req.session!;
  const scope = scopeForSession({
    role: session.role as Role,
    campuses: session.campuses,
    subjects: session.subjects,
  });
  const q = req.query as Record<string, string | undefined>;
  const semester = parseSemester(q);
  const campus = q["campus"]?.trim() || undefined;
  const group = q["group"] === "section" ? "section" : "campus";

  if (group === "section") {
    if (!campus) {
      res.status(400).json({ error: "campus required when group=section" });
      return;
    }
    if (scope.campuses?.length && !scope.campuses.includes(campus)) {
      res.status(403).json({ error: "Not permitted for this campus" });
      return;
    }
  }

  const cacheKey = `spi-avg:v3:${session.role}:${JSON.stringify(scope)}:${group}:${campus ?? ""}:${semester ?? ""}`;
  const cached = cacheGet<object>(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }
  try {
    const payload =
      group === "section"
        ? {
            group: "section" as const,
            campus,
            rows: await getSpiAveragesBySection(scope, { campus: campus!, semester }),
          }
        : {
            group: "campus" as const,
            rows: await getSpiAveragesByCampus(scope, { semester }),
          };
    cacheSet(cacheKey, payload, 15 * 60 * 1000);
    res.json(payload);
  } catch (err) {
    req.log.error({ err }, "Error fetching SPI averages");
    res.status(500).json({ error: "Failed to fetch SPI averages" });
  }
});

const SPI_RECORD_GRAINS = new Set<SpiRecordGrain>([
  "all",
  "campus",
  "semester",
  "section",
  "student",
]);

router.get("/spi-record", requireSession(), async (req, res): Promise<void> => {
  const session = req.session!;
  const scope = scopeForSession({
    role: session.role as Role,
    campuses: session.campuses,
    subjects: session.subjects,
  });
  const q = req.query as Record<string, string | undefined>;
  const grain = (q["group"] || "campus") as SpiRecordGrain;
  if (!SPI_RECORD_GRAINS.has(grain)) {
    res.status(400).json({ error: "Invalid group" });
    return;
  }
  const campus = q["campus"]?.trim() || undefined;
  const section = q["section"]?.trim() || undefined;
  if ((grain === "section" || grain === "student") && !campus) {
    res.status(400).json({ error: "campus required for this group" });
    return;
  }
  if (campus && scope.campuses?.length && !scope.campuses.includes(campus)) {
    res.status(403).json({ error: "Not permitted for this campus" });
    return;
  }
  const allSemesters = q["scope"] === "all";
  const semester = allSemesters ? undefined : parseSemester(q);
  const cacheKey = `spi-record:v5:${session.role}:${JSON.stringify(scope)}:${grain}:${campus ?? ""}:${section ?? ""}:${semester ?? ""}:${allSemesters}`;
  const cached = cacheGet<object>(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }
  try {
    const payload = await getSpiRecord(scope, {
      grain,
      semester,
      allSemesters,
      campus,
      section,
    });
    const body = {
      ...payload,
      rows: payload.rows.map((row) => ({
        ...row,
        spiPath: row.studentId ? spiSharePath(row.studentId) : null,
      })),
    };
    cacheSet(cacheKey, body, 15 * 60 * 1000);
    res.json(body);
  } catch (err) {
    req.log.error({ err }, "Error fetching SPI record");
    res.status(500).json({ error: "Failed to fetch SPI record" });
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

// Staff-only institute directory: running semesters, subjects, sections,
// and student counts. Scope-filtered so a BOA only sees their campuses.
router.get(
  "/institute-directory",
  requireSession(),
  async (req, res): Promise<void> => {
    const session = req.session!;
    const scope = scopeForSession({
      role: session.role as Role,
      campuses: session.campuses,
      subjects: session.subjects,
    });
    const campus =
      (req.query as Record<string, string | undefined>)["campus"] || undefined;
    const cacheKey = `institute-directory:${session.role}:${JSON.stringify(scope)}:${campus ?? ""}`;
    const cached = cacheGet<object>(cacheKey);
    if (cached) {
      res.json(cached);
      return;
    }
    try {
      const rows = await getInstituteDirectory(scope, { campus });
      cacheSet(cacheKey, rows, 60 * 1000);
      res.json(rows);
    } catch (err) {
      req.log.error({ err }, "Error fetching institute directory");
      res.status(500).json({ error: "Failed to fetch institute directory" });
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
  const semester = parseSemester(req.query as Record<string, string | undefined>);
  const cacheKey = `campuses:v4:${session.role}:${JSON.stringify(scope)}:${semester ?? ""}:${dateRangeCacheKey(dateRange)}`;
  const cached = cacheGet<object>(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }
  try {
    const campuses = await getCampusSummary(scope, { dateRange, semester });
    const payload = campuses.map((c) => ({
      ...c,
      belowRequirement: c.pct < REQUIRED_PCT,
    }));
    cacheSet(cacheKey, payload, 15 * 60 * 1000);
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
    const semester = parseSemester(q);
    const cacheKey = `campus-sessions:${session.role}:${JSON.stringify(scope)}:${campus}:${section ?? ""}:${semester ?? ""}:${dateRangeCacheKey(dateRange)}`;
    const cached = cacheGet<object>(cacheKey);
    if (cached) {
      res.json(cached);
      return;
    }
    try {
      const rows = await getCampusSessions(scope, { campus, section, dateRange, semester });
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
  const semester = parseSemester(q);
  const cacheKey = `sessions:${session.role}:${JSON.stringify(scope)}:${subject}:${campus ?? ""}:${section ?? ""}:${semester ?? ""}:${dateRangeCacheKey(dateRange)}`;
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
      semester,
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
        semester: parseSemester(q),
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
  const semester = parseSemester(q);
  const cacheKey = `students:v2:${session.role}:${JSON.stringify(scope)}:${search ?? ""}:${limit}:${campus ?? ""}:${section ?? ""}:${subject ?? ""}:${attendanceBand ?? ""}:${semester ?? ""}:${dateRangeCacheKey(dateRange)}`;
  const cached = cacheGet<object>(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }
  try {
    const students = await getStudentsList(scope, {
      search,
      limit,
      campus,
      section,
      subject,
      attendanceBand,
      dateRange,
      semester,
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
    cacheSet(cacheKey, withPaths, 10 * 60 * 1000);
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

// Active instructor roster for one campus, sourced from BigQuery's
// niat_instructor_details -- what the scheduler's instructor picker lists.
router.get(
  "/recovery-instructors",
  requireSession(),
  async (req, res): Promise<void> => {
    const session = req.session!;
    if (session.role === "instructor") {
      res.status(403).json({
        error: "Instructors can only view their assigned recovery sessions",
      });
      return;
    }
    // `all=true` is the "backup instructor" escape hatch: when a campus's own
    // roster can't cover a session, the BOA team needs to see every active
    // instructor, not just this campus's own. Deliberately not scope-checked
    // against the requester's own campuses -- browsing names for a backup
    // pick doesn't touch any campus's data, and the session itself (which
    // *is* scope-checked) still records its own campus separately.
    const showAll = req.query["all"] === "true";
    const campus = (req.query["campus"] as string | undefined) ?? "";
    if (!showAll) {
      const scope = scopeForSession({
        role: session.role as Role,
        campuses: session.campuses,
        subjects: session.subjects,
      });
      if (!campus) {
        res.status(400).json({ error: "campus required" });
        return;
      }
      if (scope.campuses?.length && !scope.campuses.includes(campus)) {
        res.status(403).json({ error: "Not permitted for this campus" });
        return;
      }
    }
    const cacheKey = showAll
      ? "recovery-instructors:__all__"
      : `recovery-instructors:${campus}`;
    const cached = cacheGet<object>(cacheKey);
    if (cached) {
      res.json(cached);
      return;
    }
    try {
      const instructors = showAll
        ? await getAllActiveInstructors()
        : await getCampusInstructorRoster(campus);
      cacheSet(cacheKey, instructors, 5 * 60 * 1000);
      res.json(instructors);
    } catch (err) {
      req.log.error({ err }, "Error fetching campus instructor roster");
      res.status(500).json({ error: "Failed to fetch instructor roster" });
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
      instructorUserId?: string;
      employeeId?: string;
      isBackupInstructor?: boolean;
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
        instructorUserId: body.instructorUserId || undefined,
        employeeId: body.employeeId || undefined,
        isBackupInstructor: !!body.isBackupInstructor,
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

// Deletes a mistakenly-booked recovery session -- only while it's still
// "planned" (nothing reported on it yet). Its topics revert to "pending" so
// they show back up in the tracker to be rescheduled.
router.delete(
  "/recovery-sessions/:id",
  requireSession(),
  async (req, res): Promise<void> => {
    const session = req.session!;
    if (session.role === "instructor") {
      res.status(403).json({
        error: "Instructors can only view their assigned recovery sessions",
      });
      return;
    }
    const idParam = req.params["id"];
    const id = Array.isArray(idParam) ? (idParam[0] ?? "") : (idParam ?? "");
    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidPattern.test(id)) {
      res.status(400).json({ error: "Invalid recovery session id" });
      return;
    }
    const target = await getRecoverySessionScope(id);
    if (!target) {
      res.status(404).json({ error: "Recovery session not found" });
      return;
    }
    const scope = scopeForSession({
      role: session.role as Role,
      campuses: session.campuses,
      subjects: session.subjects,
    });
    if (scope.campuses?.length && !scope.campuses.includes(target.campus)) {
      res.status(403).json({ error: "Not permitted for this campus" });
      return;
    }
    // scope.subjects carries raw BigQuery subject names (how it's assigned on
    // the user), while a stored session's subject is already resolved to the
    // curriculum code -- map before comparing, same as session-tracker does.
    if (scope.subjects?.length) {
      const allowedCurriculumSubjects = scope.subjects.map(
        (subject) => BIGQUERY_TO_CURRICULUM_SUBJECT[subject] ?? subject,
      );
      if (!allowedCurriculumSubjects.includes(target.subject)) {
        res.status(403).json({ error: "Not permitted for this subject" });
        return;
      }
    }

    try {
      const result = await cancelRecoverySession(id);
      if (!result.ok) {
        res.status(result.status).json({ error: result.error });
        return;
      }
      cacheDeletePrefix("session-tracker:");
      cacheDeletePrefix("recovery-progress:");
      res.status(204).send();
    } catch (err) {
      req.log.error({ err }, "Error deleting recovery session");
      res.status(500).json({ error: "Failed to delete recovery session" });
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

const ATTENDANCE_GRAINS = new Set<AttendanceGrain>([
  "university",
  "university_subject",
  "university_section",
  "university_student",
]);

function closedDateScope(q: Record<string, string | undefined>): {
  semester?: string;
  dateFrom?: string;
  dateTo?: string;
} {
  const from = q["dateFrom"]?.trim();
  const to = q["dateTo"]?.trim();
  const day = q["date"]?.trim();
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  const semester = q["semester"]?.trim() || undefined;
  if (day && iso.test(day)) return { dateFrom: day, dateTo: day, semester };
  if ((from && iso.test(from)) || (to && iso.test(to))) {
    const start = from && iso.test(from) ? from : to!;
    const end = to && iso.test(to) ? to : from!;
    return start <= end
      ? { dateFrom: start, dateTo: end, semester }
      : { dateFrom: end, dateTo: start, semester };
  }
  return semester ? { semester } : {};
}

router.get("/attendance-group", requireSession(), async (req, res): Promise<void> => {
  const session = req.session!;
  const scope = scopeForSession({
    role: session.role as Role,
    campuses: session.campuses,
    subjects: session.subjects,
  });
  const q = req.query as Record<string, string | undefined>;
  const grain = q["group"] as AttendanceGrain;
  if (!ATTENDANCE_GRAINS.has(grain)) {
    res.status(400).json({ error: "group is required" });
    return;
  }
  const campus = q["campus"]?.trim() || undefined;
  if (campus && scope.campuses?.length && !scope.campuses.includes(campus)) {
    res.status(403).json({ error: "Not permitted for this campus" });
    return;
  }
  const dates = closedDateScope(q);
  const cacheKey = `attendance-group:v1:${session.role}:${JSON.stringify(scope)}:${grain}:${campus ?? ""}:${dates.semester ?? ""}:${dates.dateFrom ?? ""}:${dates.dateTo ?? ""}`;
  const cached = cacheGet<object>(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }
  try {
    const rows = await getAttendanceGroupStats(scope, { grain, campus, ...dates });
    const payload = rows.map((row) => ({
      ...row,
      spiPath: row.studentId ? spiSharePath(row.studentId) : null,
    }));
    cacheSet(cacheKey, payload, 10 * 60 * 1000);
    res.json(payload);
  } catch (err) {
    req.log.error({ err }, "Error fetching attendance group stats");
    res.status(500).json({ error: "Failed to fetch attendance stats" });
  }
});

router.get("/attendance-stats/columns", requireSession(), async (req, res): Promise<void> => {
  const session = req.session!;
  try {
    const selection = await getColumnSelection(session.sub);
    res.json({
      columns: selection.columns,
      personalized: selection.personalized,
      canSetDefault: session.role === "superadmin",
    });
  } catch (err) {
    req.log.error({ err }, "Error reading attendance column prefs");
    res.status(500).json({ error: "Failed to load columns" });
  }
});

router.put("/attendance-stats/columns", requireSession(), async (req, res): Promise<void> => {
  const columns = sanitizeColumns(req.body?.columns);
  if (!columns) {
    res.status(400).json({ error: "columns must be a list" });
    return;
  }
  try {
    await saveUserColumns(req.session!.sub, columns);
    res.json({ columns, personalized: true });
  } catch (err) {
    req.log.error({ err }, "Error saving attendance column prefs");
    res.status(500).json({ error: "Failed to save columns" });
  }
});

router.put(
  "/attendance-stats/columns/default",
  requireSession(),
  async (req, res): Promise<void> => {
    if (req.session!.role !== "superadmin") {
      res.status(403).json({ error: "Only a Super Admin can set the default columns" });
      return;
    }
    const columns = sanitizeColumns(req.body?.columns);
    if (!columns) {
      res.status(400).json({ error: "columns must be a list" });
      return;
    }
    try {
      await saveDefaultColumns(columns);
      res.json({ columns });
    } catch (err) {
      req.log.error({ err }, "Error saving default attendance columns");
      res.status(500).json({ error: "Failed to save default columns" });
    }
  },
);

export default router;
