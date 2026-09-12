import { Router, type IRouter } from "express";
import {
  db,
  recoveryProgressTable,
  recoverySessionsTable,
  recoveryTopicsTable,
  sessionTopicsTable,
} from "@workspace/db";
import {
  ReportRecoverySessionBody,
  ReportRecoverySessionParams,
} from "@workspace/api-zod";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { requireSession } from "../lib/auth.js";
import { cacheDeletePrefix } from "../lib/cache.js";
import { scopeForSession, type Role } from "../lib/rbac.js";
import { BIGQUERY_TO_CURRICULUM_SUBJECT } from "../seed/cdu-curriculum.js";

const router: IRouter = Router();

function curriculumSubjects(subjects: string[]): string[] {
  return subjects.map((subject) => BIGQUERY_TO_CURRICULUM_SUBJECT[subject] ?? subject);
}

function canAccess(session: NonNullable<Express.Request["session"]>, campus: string, subject: string): boolean {
  const scope = scopeForSession(session);
  return Boolean(
    scope.instructorId === session.sub &&
    scope.campuses?.includes(campus) &&
    curriculumSubjects(scope.subjects ?? []).includes(subject),
  );
}

router.get("/instructor/curriculum", requireSession(), async (req, res): Promise<void> => {
  const session = req.session!;
  if (session.role !== "instructor") {
    res.status(403).json({ error: "Instructor access required" });
    return;
  }
  const scope = scopeForSession(session);
  const campuses = scope.campuses ?? ["__none__"];
  const subjects = curriculumSubjects(scope.subjects ?? ["__none__"]);
  const topics = await db.select({
    id: recoveryTopicsTable.id,
    campus: recoveryTopicsTable.campus,
    subject: recoveryTopicsTable.subject,
    sequenceNo: recoveryTopicsTable.sequenceNo,
    weekNo: recoveryTopicsTable.weekNo,
    title: recoveryTopicsTable.topicTitle,
  }).from(recoveryTopicsTable).where(and(
    inArray(recoveryTopicsTable.campus, campuses),
    inArray(recoveryTopicsTable.subject, subjects),
    eq(recoveryTopicsTable.isActive, true),
  )).orderBy(
    asc(recoveryTopicsTable.campus),
    asc(recoveryTopicsTable.subject),
    asc(recoveryTopicsTable.sequenceNo),
  );

  const groups = new Map<string, {
    campus: string;
    subject: string;
    topics: Array<{ id: string; sequenceNo: number; weekNo: number | null; title: string }>;
  }>();
  for (const topic of topics) {
    const key = `${topic.campus}\u0000${topic.subject}`;
    const group = groups.get(key) ?? {
      campus: topic.campus,
      subject: topic.subject,
      topics: [],
    };
    group.topics.push({
      id: topic.id,
      sequenceNo: topic.sequenceNo,
      weekNo: topic.weekNo,
      title: topic.title,
    });
    groups.set(key, group);
  }
  res.json([...groups.values()]);
});

router.get("/instructor/sessions", requireSession(), async (req, res): Promise<void> => {
  const session = req.session!;
  if (session.role !== "instructor") {
    res.status(403).json({ error: "Instructor access required" });
    return;
  }
  const date = typeof req.query["date"] === "string"
    ? req.query["date"]
    : new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ error: "date must be YYYY-MM-DD" });
    return;
  }

  const sessions = await db
    .select()
    .from(recoverySessionsTable)
    .where(and(
      eq(recoverySessionsTable.instructorId, session.sub),
      eq(recoverySessionsTable.scheduledDate, date),
      eq(recoverySessionsTable.status, "planned"),
    ))
    .orderBy(asc(recoverySessionsTable.startTime));
  const permitted = sessions.filter((item) => canAccess(session, item.campus, item.subject));
  const ids = permitted.map((item) => item.id);
  const topics = ids.length === 0 ? [] : await db
    .select({
      sessionId: sessionTopicsTable.sessionId,
      id: recoveryTopicsTable.id,
      sequenceNo: recoveryTopicsTable.sequenceNo,
      title: recoveryTopicsTable.topicTitle,
      order: sessionTopicsTable.orderInSession,
    })
    .from(sessionTopicsTable)
    .innerJoin(recoveryTopicsTable, eq(recoveryTopicsTable.id, sessionTopicsTable.topicId))
    .where(inArray(sessionTopicsTable.sessionId, ids))
    .orderBy(asc(sessionTopicsTable.orderInSession), asc(recoveryTopicsTable.sequenceNo));

  res.json(permitted.map((item) => ({
    id: item.id,
    campus: item.campus,
    subject: item.subject,
    section: item.section,
    scheduledDate: item.scheduledDate,
    startTime: item.startTime,
    endTime: item.endTime,
    studentsExpected: item.studentsExpected,
    topics: topics.filter((topic) => topic.sessionId === item.id).map(({ sessionId: _sessionId, ...topic }) => topic),
  })));
});

router.post("/sessions/:id/report", requireSession(), async (req, res): Promise<void> => {
  const session = req.session!;
  if (session.role !== "instructor") {
    res.status(403).json({ error: "Instructor access required" });
    return;
  }
  const params = ReportRecoverySessionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid session id" });
    return;
  }
  const id = params.data.id;
  const parsed = ReportRecoverySessionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid report" });
    return;
  }
  const body = parsed.data;
  if (
    body.studentsAttended != null &&
    !Number.isInteger(body.studentsAttended)
  ) {
    res.status(400).json({ error: "studentsAttended must be an integer" });
    return;
  }

  const existing = await db.select().from(recoverySessionsTable)
    .where(and(eq(recoverySessionsTable.id, id), eq(recoverySessionsTable.instructorId, session.sub))).limit(1);
  const recoverySession = existing[0];
  if (!recoverySession || !canAccess(session, recoverySession.campus, recoverySession.subject)) {
    res.status(403).json({ error: "You can only report your assigned sessions" });
    return;
  }
  if (recoverySession.status !== "planned") {
    res.status(409).json({ error: "This session has already been reported or is no longer reportable" });
    return;
  }

  const assigned = await db.select({ topicId: sessionTopicsTable.topicId })
    .from(sessionTopicsTable).where(eq(sessionTopicsTable.sessionId, id));
  if (assigned.length === 0) {
    res.status(409).json({ error: "This session has no assigned topics to report" });
    return;
  }
  const assignedIds = new Set(assigned.map((item) => item.topicId));
  const coveredIds = [...new Set(body.coveredTopicIds)];
  if (coveredIds.some((topicId) => !assignedIds.has(topicId))) {
    res.status(400).json({ error: "Reports can only include topics assigned to this session" });
    return;
  }
  const covered = new Set(coveredIds);
  // The instructor now picks the session outcome themselves (Completed /
  // Partially Completed / Not Completed) rather than having it inferred
  // from the topic checkboxes -- the checkboxes still drive per-topic
  // progress tracking below, independently of this status.
  const status = body.status;
  const now = new Date();

  const reported = await db.transaction(async (tx) => {
    const updated = await tx.update(recoverySessionsTable).set({
      status,
      studentsAttended: body.studentsAttended as number | undefined,
      remarks: body.remarks?.trim() || "",
      qaReportUrls: body.qaReportUrl?.trim() ? [body.qaReportUrl.trim()] : [],
      reportedBy: session.sub,
      reportedAt: now,
      updatedAt: now,
    }).where(and(eq(recoverySessionsTable.id, id), eq(recoverySessionsTable.status, "planned"))).returning();
    if (!updated[0]) return null;

    for (const { topicId } of assigned) {
      const wasCovered = covered.has(topicId);
      await tx.update(sessionTopicsTable).set({ wasCovered })
        .where(and(eq(sessionTopicsTable.sessionId, id), eq(sessionTopicsTable.topicId, topicId)));
      const sectionClause = recoverySession.section == null
        ? isNull(recoveryProgressTable.section)
        : eq(recoveryProgressTable.section, recoverySession.section);
      const progressClause = and(
        eq(recoveryProgressTable.campus, recoverySession.campus),
        eq(recoveryProgressTable.subject, recoverySession.subject),
        eq(recoveryProgressTable.topicId, topicId),
        sectionClause,
      );
      const progress = await tx.select({ id: recoveryProgressTable.id }).from(recoveryProgressTable)
        .where(progressClause).limit(1);
      const progressValues = {
        status: wasCovered ? "completed" as const : "pending" as const,
        completedAt: wasCovered ? now : null,
        updatedAt: now,
      };
      if (progress[0]) {
        await tx.update(recoveryProgressTable).set(progressValues)
          .where(progressClause);
      } else {
        await tx.insert(recoveryProgressTable).values({
          campus: recoverySession.campus,
          subject: recoverySession.subject,
          topicId,
          section: recoverySession.section,
          ...progressValues,
        });
      }
    }
    return updated[0];
  });
  if (!reported) {
    res.status(409).json({ error: "This session was reported in another submission" });
    return;
  }
  cacheDeletePrefix("recovery-progress:");
  cacheDeletePrefix("session-tracker:");
  res.json({ id: reported.id, status: reported.status, reportedAt: reported.reportedAt?.toISOString() ?? now.toISOString() });
});

export default router;