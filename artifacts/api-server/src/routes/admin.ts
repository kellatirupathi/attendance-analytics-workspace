import { Router } from "express";
import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import {
  usersTable,
  campusesTable,
  recoverySessionsTable,
  recoveryProgressTable,
  sessionTopicsTable,
} from "@workspace/db";
import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { requireSession } from "../lib/auth.js";
import { invalidateSessionCache } from "../lib/sessionCache.js";
import { manageableRoles, ROLE_META, SUBJECTS } from "../lib/rbac.js";
import type { Role } from "../lib/rbac.js";
import {
  getInstitutions,
  getSubjectList,
  setRecoverySessionInstructorIdentity,
  setRecoverySessionIncentivePaid,
} from "../lib/queries.js";
import { omitExcludedInstitutes, isExcludedInstitute } from "../lib/excludedInstitutes.js";
import { cacheDeletePrefix } from "../lib/cache.js";

const router = Router();

const BULK_USER_LIMIT = 200;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SCOPED_ROLES: Role[] = ["capability_manager", "boa", "instructor"];

function toUserDto(u: typeof usersTable.$inferSelect) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    campuses: omitExcludedInstitutes(u.campuses),
    subjects: u.subjects,
    isActive: u.isActive,
    createdBy: u.createdBy,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
  };
}

function normalizeRole(role: string): string {
  return role.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function cleanList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return values.map((value) => String(value ?? "").trim()).filter(Boolean);
}

// All admin routes require manage permission
router.use(requireSession({ manage: true }));
router.use((_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

// Users
router.get("/users", async (req, res): Promise<void> => {
  const users = await db
    .select()
    .from(usersTable)
    .orderBy(usersTable.createdAt);
  res.json(
    users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      campuses: omitExcludedInstitutes(u.campuses),
      subjects: u.subjects,
      isActive: u.isActive,
      createdBy: u.createdBy,
      lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
      createdAt: u.createdAt.toISOString(),
    })),
  );
});

router.post("/users", async (req, res): Promise<void> => {
  const session = req.session!;
  const { name, email, role, password, campuses, subjects, isActive } =
    req.body as {
      name?: string;
      email?: string;
      role?: string;
      password?: string;
      campuses?: string[];
      subjects?: string[];
      isActive?: boolean;
    };
  if (!name || !email || !role || !password) {
    res.status(400).json({ error: "name, email, role, password required" });
    return;
  }
  const allowedRoles = manageableRoles(session.role as Role);
  if (!allowedRoles.includes(role as Role)) {
    res.status(403).json({ error: "Cannot assign this role" });
    return;
  }
  const normalizedEmail = email.trim().toLowerCase();
  const passwordHash = await bcrypt.hash(password, 10);
  const inserted = await db
    .insert(usersTable)
    .values({
      name,
      email: normalizedEmail,
      passwordHash,
      role: role as Role,
      campuses: omitExcludedInstitutes(campuses ?? []),
      subjects: subjects ?? [],
      isActive: isActive ?? true,
      createdBy: session.email,
    })
    .returning();
  res.status(201).json(toUserDto(inserted[0]!));
});

router.post("/users/bulk", async (req, res): Promise<void> => {
  const session = req.session!;
  const body = req.body as {
    password?: string;
    users?: Array<{
      name?: string;
      email?: string;
      role?: string;
      password?: string;
      campuses?: string[];
      subjects?: string[];
    }>;
  };

  const incoming = Array.isArray(body.users) ? body.users : [];
  if (incoming.length === 0) {
    res.status(400).json({ error: "users required" });
    return;
  }
  if (incoming.length > BULK_USER_LIMIT) {
    res.status(400).json({
      error: `Maximum ${BULK_USER_LIMIT} users per import`,
    });
    return;
  }

  const defaultPassword =
    typeof body.password === "string" ? body.password.trim() : "";
  const allowedRoles = manageableRoles(session.role as Role);
  const skipped: Array<{ row: number; email: string; reason: string }> = [];
  const errors: Array<{ row: number; email: string; reason: string }> = [];

  type Prepared = {
    row: number;
    name: string;
    email: string;
    role: Role;
    campuses: string[];
    subjects: string[];
    password: string;
  };
  const prepared: Prepared[] = [];
  const seen = new Set<string>();

  incoming.forEach((raw, index) => {
    const row = index + 1;
    const name = String(raw.name ?? "").trim();
    const email = String(raw.email ?? "").trim().toLowerCase();
    const role = normalizeRole(String(raw.role ?? ""));
    const campuses = omitExcludedInstitutes(cleanList(raw.campuses));
    const subjects = cleanList(raw.subjects);
    const password =
      (typeof raw.password === "string" && raw.password.trim()) ||
      defaultPassword;

    if (!name || !email || !role) {
      errors.push({ row, email, reason: "name, email, and role are required" });
      return;
    }
    if (!EMAIL_RE.test(email)) {
      errors.push({ row, email, reason: "Invalid email" });
      return;
    }
    if (!allowedRoles.includes(role as Role)) {
      errors.push({ row, email, reason: "Cannot assign this role" });
      return;
    }
    if (password.length < 6) {
      errors.push({
        row,
        email,
        reason: "Password must be at least 6 characters",
      });
      return;
    }
    if (SCOPED_ROLES.includes(role as Role) && campuses.length === 0) {
      errors.push({ row, email, reason: "Campus is required for this role" });
      return;
    }
    if (seen.has(email)) {
      errors.push({ row, email, reason: "Duplicate email in this import" });
      return;
    }
    seen.add(email);
    prepared.push({
      row,
      name,
      email,
      role: role as Role,
      campuses,
      subjects,
      password,
    });
  });

  if (prepared.length === 0) {
    res.json({ created: [], skipped, errors });
    return;
  }

  const existing = await db
    .select({ email: usersTable.email })
    .from(usersTable)
    .where(
      inArray(
        usersTable.email,
        prepared.map((user) => user.email),
      ),
    );
  const existingEmails = new Set(existing.map((user) => user.email));
  const toCreate = prepared.filter((user) => {
    if (existingEmails.has(user.email)) {
      skipped.push({
        row: user.row,
        email: user.email,
        reason: "Email already exists",
      });
      return false;
    }
    return true;
  });

  const created: ReturnType<typeof toUserDto>[] = [];
  if (toCreate.length > 0) {
    const passwordHashes = new Map<string, string>();
    for (const user of toCreate) {
      if (!passwordHashes.has(user.password)) {
        passwordHashes.set(user.password, await bcrypt.hash(user.password, 10));
      }
    }

    const inserted = await db
      .insert(usersTable)
      .values(
        toCreate.map((user) => ({
          name: user.name,
          email: user.email,
          passwordHash: passwordHashes.get(user.password)!,
          role: user.role,
          campuses: user.campuses,
          subjects: user.subjects,
          isActive: true,
          createdBy: session.email,
        })),
      )
      .onConflictDoNothing({ target: usersTable.email })
      .returning();

    const insertedEmails = new Set(inserted.map((user) => user.email));
    for (const user of toCreate) {
      if (!insertedEmails.has(user.email)) {
        skipped.push({
          row: user.row,
          email: user.email,
          reason: "Email already exists",
        });
      }
    }
    created.push(...inserted.map(toUserDto));
  }

  res.json({ created, skipped, errors });
});

router.patch("/users/:id", async (req, res): Promise<void> => {
  const session = req.session!;
  const id = String(req.params["id"] ?? "");
  const existing = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, id))
    .limit(1);
  const target = existing[0];
  if (!target) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  if (
    session.role === "admin" &&
    (target.role === "admin" || target.role === "superadmin")
  ) {
    res.status(403).json({ error: "Insufficient permissions" });
    return;
  }
  const { name, email, role, password, campuses, subjects, isActive } =
    req.body as {
      name?: string;
      email?: string;
      role?: string;
      password?: string;
      campuses?: string[];
      subjects?: string[];
      isActive?: boolean;
    };
  const updates: Partial<typeof usersTable.$inferInsert> = {};
  if (name) updates.name = name;
  if (email) updates.email = email.trim().toLowerCase();
  if (role) {
    const allowedRoles = manageableRoles(session.role as Role);
    if (!allowedRoles.includes(role as Role)) {
      res.status(403).json({ error: "Cannot assign this role" });
      return;
    }
    updates.role = role as Role;
    updates.tokenVersion = (target.tokenVersion ?? 0) + 1;
  }
  if (password) updates.passwordHash = await bcrypt.hash(password, 10);
  if (campuses !== undefined) updates.campuses = omitExcludedInstitutes(campuses);
  if (subjects !== undefined) updates.subjects = subjects;
  if (isActive !== undefined) {
    updates.isActive = isActive;
    if (!isActive) {
      updates.tokenVersion =
        (updates.tokenVersion ?? target.tokenVersion ?? 0) + 1;
    }
  }
  updates.updatedAt = new Date();
  const updated = await db
    .update(usersTable)
    .set(updates)
    .where(eq(usersTable.id, id))
    .returning();
  const u = updated[0]!;
  invalidateSessionCache(u.id);
  res.json({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    campuses: omitExcludedInstitutes(u.campuses),
    subjects: u.subjects,
    isActive: u.isActive,
    createdBy: u.createdBy,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
  });
});

router.delete("/users/:id", async (req, res): Promise<void> => {
  const session = req.session!;
  const id = String(req.params["id"] ?? "");
  if (id === session.sub) {
    res.status(400).json({ error: "Cannot delete yourself" });
    return;
  }
  const existing = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, id))
    .limit(1);
  const target = existing[0];
  if (!target) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  if (
    session.role === "admin" &&
    (target.role === "admin" || target.role === "superadmin")
  ) {
    res.status(403).json({ error: "Insufficient permissions" });
    return;
  }
  await db.delete(usersTable).where(eq(usersTable.id, id));
  res.status(204).send();
});

// Campuses
router.get("/campuses", async (_req, res) => {
  const campuses = await db
    .select()
    .from(campusesTable)
    .orderBy(campusesTable.name);
  res.json(
    campuses
      .filter((c) => !isExcludedInstitute(c.name))
      .map((c) => ({
      id: c.id,
      name: c.name,
      instituteId: c.instituteId,
      createdAt: c.createdAt.toISOString(),
    })),
  );
});

router.post("/campuses", async (req, res): Promise<void> => {
  const { name, instituteId } = req.body as {
    name?: string;
    instituteId?: string;
  };
  if (!name) {
    res.status(400).json({ error: "name required" });
    return;
  }
  const inserted = await db
    .insert(campusesTable)
    .values({ name, instituteId })
    .returning();
  const c = inserted[0]!;
  res
    .status(201)
    .json({
      id: c.id,
      name: c.name,
      instituteId: c.instituteId,
      createdAt: c.createdAt.toISOString(),
    });
});

router.patch("/campuses/:id", async (req, res): Promise<void> => {
  const id = String(req.params["id"] ?? "");
  const { name, instituteId } = req.body as {
    name?: string;
    instituteId?: string;
  };
  const updates: Partial<typeof campusesTable.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (name) updates.name = name;
  if (instituteId !== undefined) updates.instituteId = instituteId;
  const updated = await db
    .update(campusesTable)
    .set(updates)
    .where(eq(campusesTable.id, id))
    .returning();
  const c = updated[0];
  if (!c) {
    res.status(404).json({ error: "Campus not found" });
    return;
  }
  res.json({
    id: c.id,
    name: c.name,
    instituteId: c.instituteId,
    createdAt: c.createdAt.toISOString(),
  });
});

router.delete("/campuses/:id", async (req, res): Promise<void> => {
  const id = String(req.params["id"] ?? "");
  await db.delete(campusesTable).where(eq(campusesTable.id, id));
  res.status(204).send();
});

router.patch(
  "/recovery-sessions/:id/instructor-type",
  async (req, res): Promise<void> => {
    const id = String(req.params["id"] ?? "");
    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidPattern.test(id)) {
      res.status(400).json({ error: "Invalid recovery session id" });
      return;
    }

    const instructorType = (req.body as { instructorType?: unknown })
      .instructorType;
    if (
      instructorType !== "campus" &&
      instructorType !== "backup" &&
      instructorType !== "unknown"
    ) {
      res.status(400).json({ error: "Invalid instructor type" });
      return;
    }

    const [updated] = await db
      .update(recoverySessionsTable)
      .set({
        instructorType,
        instructorTypeReviewedAt: new Date(),
        isBackupInstructor: instructorType === "backup",
        updatedAt: new Date(),
      })
      .where(eq(recoverySessionsTable.id, id))
      .returning({
        id: recoverySessionsTable.id,
        instructorType: recoverySessionsTable.instructorType,
      });
    if (!updated) {
      res.status(404).json({ error: "Recovery session not found" });
      return;
    }

    cacheDeletePrefix("session-tracker:");
    res.json(updated);
  },
);

// Reopens a session an admin has determined was wrongly marked
// Completed/Partially Completed (e.g. a test entry, or an instructor error) --
// puts its topic(s) back into "needs recovery" on the tracker rather than
// deleting history. The session itself is kept (status -> "cancelled", so it
// drops out of the tracker's candidate list for that topic) with its
// remarks/QA report link cleared; per-topic recovery_progress is reset to
// "pending" unless some other still-valid conducted/partial session also
// covers that topic, in which case that topic is left alone.
router.post(
  "/recovery-sessions/:id/revert",
  async (req, res): Promise<void> => {
    const id = String(req.params["id"] ?? "");
    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidPattern.test(id)) {
      res.status(400).json({ error: "Invalid recovery session id" });
      return;
    }

    const existing = await db
      .select()
      .from(recoverySessionsTable)
      .where(eq(recoverySessionsTable.id, id))
      .limit(1);
    const session = existing[0];
    if (!session) {
      res.status(404).json({ error: "Recovery session not found" });
      return;
    }
    if (session.status !== "conducted" && session.status !== "partial") {
      res.status(409).json({
        error: "Only a Completed or Partially Completed session can be reverted",
      });
      return;
    }

    const admin = req.session!;
    const now = new Date();

    const reverted = await db.transaction(async (tx) => {
      const updated = await tx
        .update(recoverySessionsTable)
        .set({
          status: "cancelled",
          cancellationReason:
            `Reverted from ${session.status === "conducted" ? "Completed" : "Partially Completed"}` +
            ` by ${admin.email} -- marked as not actually delivered`,
          remarks: "",
          qaReportUrls: [],
          updatedAt: now,
        })
        .where(
          and(
            eq(recoverySessionsTable.id, id),
            inArray(recoverySessionsTable.status, ["conducted", "partial"]),
          ),
        )
        .returning();
      if (!updated[0]) return null;

      const assignedTopics = await tx
        .select({
          topicId: sessionTopicsTable.topicId,
          wasCovered: sessionTopicsTable.wasCovered,
        })
        .from(sessionTopicsTable)
        .where(eq(sessionTopicsTable.sessionId, id));

      for (const { topicId, wasCovered } of assignedTopics) {
        if (wasCovered) {
          await tx
            .update(sessionTopicsTable)
            .set({ wasCovered: false })
            .where(
              and(
                eq(sessionTopicsTable.sessionId, id),
                eq(sessionTopicsTable.topicId, topicId),
              ),
            );
        }

        // If some other completed/partial session still validly covers this
        // topic, leave its progress alone -- only fall back to "pending"
        // when this reverted session was the one carrying it.
        const otherCoverage = await tx
          .select({ sessionId: sessionTopicsTable.sessionId })
          .from(sessionTopicsTable)
          .innerJoin(
            recoverySessionsTable,
            eq(recoverySessionsTable.id, sessionTopicsTable.sessionId),
          )
          .where(
            and(
              eq(sessionTopicsTable.topicId, topicId),
              eq(sessionTopicsTable.wasCovered, true),
              inArray(recoverySessionsTable.status, ["conducted", "partial"]),
              ne(sessionTopicsTable.sessionId, id),
            ),
          )
          .limit(1);
        if (otherCoverage.length > 0) continue;

        const sectionClause =
          session.section == null
            ? isNull(recoveryProgressTable.section)
            : eq(recoveryProgressTable.section, session.section);
        await tx
          .update(recoveryProgressTable)
          .set({ status: "pending", completedAt: null, updatedAt: now })
          .where(
            and(
              eq(recoveryProgressTable.campus, session.campus),
              eq(recoveryProgressTable.subject, session.subject),
              eq(recoveryProgressTable.topicId, topicId),
              sectionClause,
            ),
          );
      }

      return updated[0];
    });

    if (!reverted) {
      res.status(409).json({
        error: "This session was already changed by another request",
      });
      return;
    }

    cacheDeletePrefix("recovery-progress:");
    cacheDeletePrefix("session-tracker:");
    res.json({ id: reverted.id, status: reverted.status });
  },
);

// Admin-only correction for the Incentive Tracker / Session Tracker: rewrites
// one session's stored instructor identity, e.g. to attach the canonical
// BigQuery employee id to a historical session that only ever had a
// free-text name, or to fix an outright mistake. Deliberately per-session
// rather than bulk -- the one-time historical reconciliation is handled by
// the backfill-recovery-instructor-identity script; this is for the
// stragglers it couldn't match, or for one-off corrections afterward.
router.patch(
  "/recovery-sessions/:id/instructor-identity",
  async (req, res): Promise<void> => {
    const id = String(req.params["id"] ?? "");
    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidPattern.test(id)) {
      res.status(400).json({ error: "Invalid recovery session id" });
      return;
    }

    const body = req.body as {
      instructorName?: unknown;
      employeeId?: unknown;
      bigqueryInstructorUserId?: unknown;
      instructorType?: unknown;
    };
    const instructorName =
      typeof body.instructorName === "string" ? body.instructorName.trim() : "";
    if (!instructorName) {
      res.status(400).json({ error: "instructorName is required" });
      return;
    }
    const instructorType = body.instructorType;
    if (
      instructorType !== "campus" &&
      instructorType !== "backup" &&
      instructorType !== "unknown"
    ) {
      res.status(400).json({ error: "Invalid instructor type" });
      return;
    }
    const employeeId =
      typeof body.employeeId === "string" && body.employeeId.trim()
        ? body.employeeId.trim()
        : null;
    const bigqueryInstructorUserId =
      typeof body.bigqueryInstructorUserId === "string" &&
      body.bigqueryInstructorUserId.trim()
        ? body.bigqueryInstructorUserId.trim()
        : null;

    const updated = await setRecoverySessionInstructorIdentity(id, {
      instructorName,
      employeeId,
      bigqueryInstructorUserId,
      instructorType,
    });
    if (!updated) {
      res.status(404).json({ error: "Recovery session not found" });
      return;
    }

    cacheDeletePrefix("session-tracker:");
    res.json({
      id: updated.id,
      instructorName: updated.instructorName,
      employeeId: updated.employeeId,
      bigqueryInstructorUserId: updated.bigqueryInstructorUserId,
      instructorType: updated.instructorType,
    });
  },
);

// Admin/superadmin-only: marks an already-approved session's incentive as
// actually paid out. Kept separate from BOA approval (which only confirms
// the session happened) so "owed" and "already paid" are tracked distinctly.
router.patch(
  "/recovery-sessions/:id/incentive-paid",
  async (req, res): Promise<void> => {
    const id = String(req.params["id"] ?? "");
    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidPattern.test(id)) {
      res.status(400).json({ error: "Invalid recovery session id" });
      return;
    }
    const paid = (req.body as { paid?: unknown }).paid;
    if (typeof paid !== "boolean") {
      res.status(400).json({ error: "paid must be a boolean" });
      return;
    }

    const session = req.session!;
    const result = await setRecoverySessionIncentivePaid(id, paid, session.sub);
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

// Meta — campuses and subjects come live from BigQuery so the assignable
// options exactly match the institutions/subjects present in the data
// warehouse. institute_name is what scope filtering matches on, so that is
// what gets stored on the user. institutions[] additionally carries the
// institute_id for display. Falls back to the Postgres campuses table /
// hardcoded SUBJECTS if BigQuery is unavailable, so the form never breaks.
router.get("/meta", async (req, res) => {
  const session = req.session!;
  const roles = manageableRoles(session.role as Role).map((r) => ({
    value: r,
    label: ROLE_META[r].label,
    description: ROLE_META[r].description,
  }));

  let institutions: { instituteId: string | null; instituteName: string }[] =
    [];
  let subjects: string[] = [];

  try {
    [institutions, subjects] = await Promise.all([
      getInstitutions(),
      getSubjectList(),
    ]);
  } catch (err) {
    req.log.error({ err }, "Failed to load meta from BigQuery, falling back");
  }

  if (institutions.length === 0) {
    const dbCampuses = await db
      .select()
      .from(campusesTable)
      .orderBy(campusesTable.name);
    institutions = dbCampuses.map((c) => ({
      instituteId: c.instituteId ?? null,
      instituteName: c.name,
    }));
  }
  institutions = institutions.filter(
    (item) => !isExcludedInstitute(item.instituteName),
  );
  if (subjects.length === 0) {
    subjects = [...SUBJECTS];
  }

  res.json({
    roles,
    campuses: institutions.map((i) => i.instituteName),
    institutions,
    subjects,
  });
});

export default router;
