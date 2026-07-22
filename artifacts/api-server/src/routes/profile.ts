import { Router } from "express";
import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireSession, signSession, setSessionCookie } from "../lib/auth.js";
import type { Role } from "../lib/rbac.js";

const router = Router();

router.get("/", requireSession(), async (req, res): Promise<void> => {
  const session = req.session!;
  const users = await db.select().from(usersTable).where(eq(usersTable.id, session.sub)).limit(1);
  const user = users[0];
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  res.json({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    campuses: user.campuses,
    subjects: user.subjects,
    isActive: user.isActive,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
  });
});

router.patch("/", requireSession(), async (req, res): Promise<void> => {
  const session = req.session!;
  const { name, currentPassword, newPassword } = req.body as {
    name?: string;
    currentPassword?: string;
    newPassword?: string;
  };
  const users = await db.select().from(usersTable).where(eq(usersTable.id, session.sub)).limit(1);
  const user = users[0];
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  const updates: Partial<typeof usersTable.$inferInsert> = { updatedAt: new Date() };
  if (name) updates.name = name;
  if (newPassword) {
    if (!currentPassword) {
      res.status(400).json({ error: "Current password required" });
      return;
    }
    if (newPassword.length < 6) {
      res.status(400).json({ error: "New password must be at least 6 characters" });
      return;
    }
    const valid = user.passwordHash ? await bcrypt.compare(currentPassword, user.passwordHash) : false;
    if (!valid) {
      res.status(400).json({ error: "Current password is incorrect" });
      return;
    }
    updates.passwordHash = await bcrypt.hash(newPassword, 10);
  }
  const updated = await db.update(usersTable).set(updates).where(eq(usersTable.id, session.sub)).returning();
  const u = updated[0]!;
  const token = signSession({
    sub: u.id,
    email: u.email,
    name: u.name,
    role: u.role as Role,
    campuses: u.campuses,
    subjects: u.subjects,
    tokenVersion: u.tokenVersion,
  });
  setSessionCookie(res, token);
  res.json({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    campuses: u.campuses,
    subjects: u.subjects,
    isActive: u.isActive,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
  });
});

export default router;
