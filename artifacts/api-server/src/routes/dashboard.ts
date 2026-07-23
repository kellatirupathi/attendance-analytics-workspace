import { Router } from "express";
import { requireSession } from "../lib/auth.js";
import { scopeForSession } from "../lib/rbac.js";
import {
  getCampusSummary,
  getSectionSummary,
  getSubjectSummary,
  getStudentsList,
  getDashboardFilterOptions,
} from "../lib/queries.js";
import { cacheGet, cacheSet } from "../lib/cache.js";
import { spiSharePath } from "../lib/spiToken.js";
import type { Role } from "../lib/rbac.js";

const router = Router();

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
  const campus = (req.query["campus"] as string | undefined) || undefined;
  const cacheKey = `subjects:${session.role}:${JSON.stringify(scope)}:${campus ?? ""}`;
  const cached = cacheGet<object>(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }
  try {
    const subjects = await getSubjectSummary(scope, { campus });
    cacheSet(cacheKey, subjects, 60 * 1000);
    res.json(subjects);
  } catch (err) {
    req.log.error({ err }, "Error fetching subject attendance");
    res.status(500).json({ error: "Failed to fetch subject attendance" });
  }
});

router.get("/students", requireSession(), async (req, res): Promise<void> => {
  const session = req.session!;
  const scope = scopeForSession({
    role: session.role as Role,
    campuses: session.campuses,
    subjects: session.subjects,
  });
  const q = req.query as Record<string, string | undefined>;
  const search = q["search"];
  const limit = Math.min(Number(q["limit"] ?? 200), 5000);
  const campus = q["campus"] || undefined;
  const section = q["section"] || undefined;
  const attendanceBand = q["attendanceBand"] || undefined;
  try {
    const students = await getStudentsList(scope, {
      search,
      limit,
      campus,
      section,
      attendanceBand,
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

export default router;
