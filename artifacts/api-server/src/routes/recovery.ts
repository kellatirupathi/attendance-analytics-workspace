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
import {
  getIncentiveTracker,
  getRecoverySessionScope,
  setRecoverySessionIncentiveApproval,
  RECOVERY_INCENTIVE_PER_SESSION,
} from "../lib/queries.js";

const router: IRouter = Router();

// View: superadmin/admin/hod see every campus; boa is scope-limited to their
// own (enforced below via scopeForSession, same as the rest of this router).
const INCENTIVE_VIEW_ROLES: Role[] = ["superadmin", "admin", "boa", "hod"];
// Approve/reject is the BOA's actual job here -- hod stays read-only.
const INCENTIVE_APPROVE_ROLES: Role[] = ["superadmin", "admin", "boa"];

function curriculumSubjects(subjects: string[]): string[] {
  return subjects.map((subject) => BIGQUERY_TO_CURRICULUM_SUBJECT[subject] ?? subject);
}

// Scope-based access check: does this signed-in session (which may be a
// single shared campus login used by many real instructors -- e.g.
// cdu.instructor@nxtwave.co.in -- rather than one specific person) have
// permission to see/act on this campus+subject? This intentionally does
// NOT compare against any specific recovery session's stored instructorId:
// a shared campus account's whole point is that any instructor signed into
// it (English, Math, Frontend, etc.) can act on any session at that campus.
function canAccess(session: NonNullable<Express.Request["session"]>, campus: string, subject: string): boolean {
  const scope = scopeForSession(session);
  if (!scope.campuses?.includes(campus)) return false;
  const assigned = scope.subjects ?? [];
  if (assigned.length === 0) return true;
  return curriculumSubjects(assigned).includes(subject);
}

router.get("/instructor/curriculum", requireSession(), async (req, res): Promise<void> => {
  const session = req.session!;
  if (session.role !== "instructor") {
    res.status(403).json({ error: "Instructor access required" });
    return;
  }
  const scope = scopeForSession(session);
  const campuses = scope.campuses?.length ? scope.campuses : ["__none__"];
  const assignedSubjects = scope.subjects ?? [];
  const topicFilters = [
    inArray(recoveryTopicsTable.campus, campuses),
    eq(recoveryTopicsTable.isActive, true),
  ];
  if (assignedSubjects.length > 0) {
    topicFilters.push(
      inArray(
        recoveryTopicsTable.subject,
        curriculumSubjects(assignedSubjects),
      ),
    );
  }
  const topics = await db.select({
    id: recoveryTopicsTable.id,
    campus: recoveryTopicsTable.campus,
    subject: recoveryTopicsTable.subject,
    sequenceNo: recoveryTopicsTable.sequenceNo,
    weekNo: recoveryTopicsTable.weekNo,
    title: recoveryTopicsTable.topicTitle,
  }).from(recoveryTopicsTable).where(and(...topicFilters)).orderBy(
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
    const key = `${topic.campus} ${topic.subject}`;
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

  // Scoped to this session's campuses (not to a specific matched
  // instructorId) so a shared campus login sees every session at its
  // campus(es), regardless of which real instructor it was scheduled for.
  const scope = scopeForSession(session);
  const campuses = scope.campuses?.length ? scope.campuses : ["__none__"];

  const sessions = await db
    .select()
    .from(recoverySessionsTable)
    .where(and(
      inArray(recoverySessionsTable.campus, campuses),
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

// Fetch one assigned session's full detail (including its topics), regardless
// of scheduled date -- unlike GET /instructor/sessions (today only), this
// backs the "Mark complete" action instructors can now trigger straight from
// the Recovery tab's Session Tracker, including for an overdue session from
// a previous day. Access is scope-based (campus + subject), not tied to a
// specific matched instructorId, so a shared campus login can act on any
// session at that campus.
router.get("/instructor/sessions/:id", requireSession(), async (req, res): Promise<void> => {
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

  const existing = await db.select().from(recoverySessionsTable)
    .where(eq(recoverySessionsTable.id, id)).limit(1);
  const recoverySession = existing[0];
  if (!recoverySession || !canAccess(session, recoverySession.campus, recoverySession.subject)) {
    res.status(403).json({ error: "You can only view sessions at your assigned campus" });
    return;
  }
  if (recoverySession.status !== "planned") {
    res.status(409).json({ error: "This session has already been reported or is no longer reportable" });
    return;
  }

  const topics = await db
    .select({
      id: recoveryTopicsTable.id,
      sequenceNo: recoveryTopicsTable.sequenceNo,
      title: recoveryTopicsTable.topicTitle,
      order: sessionTopicsTable.orderInSession,
    })
    .from(sessionTopicsTable)
    .innerJoin(recoveryTopicsTable, eq(recoveryTopicsTable.id, sessionTopicsTable.topicId))
    .where(eq(sessionTopicsTable.sessionId, id))
    .orderBy(asc(sessionTopicsTable.orderInSession), asc(recoveryTopicsTable.sequenceNo));

  res.json({
    id: recoverySession.id,
    campus: recoverySession.campus,
    subject: recoverySession.subject,
    section: recoverySession.section,
    scheduledDate: recoverySession.scheduledDate,
    startTime: recoverySession.startTime,
    endTime: recoverySession.endTime,
    studentsExpected: recoverySession.studentsExpected,
    topics,
  });
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
  // QA report link is mandatory for any session actually delivered -- there's
  // nothing to attach a report to for a session marked "not completed".
  if (
    (body.status === "conducted" || body.status === "partial") &&
    !body.qaReportUrl?.trim()
  ) {
    res.status(400).json({ error: "A QA report link is required to submit this report" });
    return;
  }

  // Scope-based (campus + subject), not tied to a specific matched
  // instructorId -- see canAccess() above.
  const existing = await db.select().from(recoverySessionsTable)
    .where(eq(recoverySessionsTable.id, id)).limit(1);
  const recoverySession = existing[0];
  if (!recoverySession || !canAccess(session, recoverySession.campus, recoverySession.subject)) {
    res.status(403).json({ error: "You can only report sessions at your assigned campus" });
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

// The Incentive Tracker: every Completed/Partially Completed session, grouped
// by campus then instructor, with sessions-completed / approved / paid counts
// and the money owed at the fixed per-session rate. A BOA sees only their own
// campus(es); superadmin/admin/hod see every campus -- the frontend's own
// campus picker (defaulting to whichever campus the page was opened from,
// e.g. a specific college's Recovery pages) narrows the view from there
// without needing a fresh request per campus.
router.get("/incentives", requireSession(), async (req, res): Promise<void> => {
  const session = req.session!;
  if (!INCENTIVE_VIEW_ROLES.includes(session.role as Role)) {
    res.status(403).json({ error: "Not permitted to view the incentive tracker" });
    return;
  }
  const scope = scopeForSession(session);
  // scope.campuses is undefined for superadmin/admin/hod (see all), or an
  // array for boa -- including the ["__none__"] sentinel for a boa with no
  // assigned campuses, which getIncentiveTracker's inArray filter naturally
  // resolves to zero rows since no real campus is named "__none__".
  const tracker = await getIncentiveTracker(scope.campuses);
  res.json({ ratePerSession: RECOVERY_INCENTIVE_PER_SESSION, campuses: tracker });
});

// The BOA's "yes/no, was this session actually delivered" confirmation.
// Approving is what makes a session's incentive count as money owed;
// revoking approval also un-pays it (enforced in setRecoverySessionIncentiveApproval).
router.patch(
  "/sessions/:id/incentive-approval",
  requireSession(),
  async (req, res): Promise<void> => {
    const session = req.session!;
    if (!INCENTIVE_APPROVE_ROLES.includes(session.role as Role)) {
      res.status(403).json({ error: "Not permitted to approve incentives" });
      return;
    }
    const id = String(req.params["id"] ?? "");
    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidPattern.test(id)) {
      res.status(400).json({ error: "Invalid recovery session id" });
      return;
    }
    const approved = (req.body as { approved?: unknown }).approved;
    if (typeof approved !== "boolean") {
      res.status(400).json({ error: "approved must be a boolean" });
      return;
    }

    // BOA is scope-limited to their own campus(es); admin/superadmin/hod
    // (who never hit this route per INCENTIVE_APPROVE_ROLES, but kept
    // symmetric with the rest of the router) pass through unchecked.
    const scopeCampuses = scopeForSession(session).campuses;
    if (scopeCampuses) {
      const scoped = await getRecoverySessionScope(id);
      if (!scoped || !scopeCampuses.includes(scoped.campus)) {
        res.status(403).json({ error: "Not permitted for this campus" });
        return;
      }
    }

    const result = await setRecoverySessionIncentiveApproval(id, approved, session.sub);
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.json({
      id: result.session.id,
      incentiveApproved: result.session.incentiveApproved,
      incentivePaid: result.session.incentivePaid,
    });
  },
);

export default router;
