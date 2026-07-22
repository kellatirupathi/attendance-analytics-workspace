import { Router } from "express";
import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import { usersTable, campusesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireSession } from "../lib/auth.js";
import { manageableRoles, ROLE_META, SUBJECTS } from "../lib/rbac.js";
import type { Role } from "../lib/rbac.js";
import { getInstitutions, getSubjectList } from "../lib/queries.js";

const router = Router();

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
      campuses: u.campuses,
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
      campuses: campuses ?? [],
      subjects: subjects ?? [],
      isActive: isActive ?? true,
      createdBy: session.email,
    })
    .returning();
  const u = inserted[0]!;
  res.status(201).json({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    campuses: u.campuses,
    subjects: u.subjects,
    isActive: u.isActive,
    createdBy: u.createdBy,
    lastLoginAt: null,
    createdAt: u.createdAt.toISOString(),
  });
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
  if (campuses !== undefined) updates.campuses = campuses;
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
  res.json({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    campuses: u.campuses,
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
    campuses.map((c) => ({
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
