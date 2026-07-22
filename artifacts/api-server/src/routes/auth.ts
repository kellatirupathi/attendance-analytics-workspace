import { Router } from "express";
import bcrypt from "bcryptjs";
import { rateLimit } from "express-rate-limit";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  signSession,
  setSessionCookie,
  clearSessionCookie,
  getSessionFromRequest,
  signStateToken,
  verifyStateToken,
} from "../lib/auth.js";
import type { Role } from "../lib/rbac.js";

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

router.post("/login", loginLimiter, async (req, res): Promise<void> => {
  res.set("Cache-Control", "no-store");
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) {
    res.status(400).json({ error: "Email and password required" });
    return;
  }
  const normalizedEmail = email.trim().toLowerCase();
  const users = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, normalizedEmail))
    .limit(1);
  const user = users[0];
  if (!user || !user.isActive || !user.passwordHash) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }
  await db
    .update(usersTable)
    .set({ lastLoginAt: new Date() })
    .where(eq(usersTable.id, user.id));
  const token = signSession({
    sub: user.id,
    email: user.email,
    name: user.name,
    role: user.role as Role,
    campuses: user.campuses,
    subjects: user.subjects,
    tokenVersion: user.tokenVersion,
  });
  setSessionCookie(res, token);
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

router.post("/logout", (_req, res) => {
  res.set("Cache-Control", "no-store");
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get("/me", async (req, res): Promise<void> => {
  res.set("Cache-Control", "no-store");
  const session = getSessionFromRequest(req);
  if (!session) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const users = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, session.sub))
    .limit(1);
  const user = users[0];
  if (!user || !user.isActive || user.tokenVersion !== session.tokenVersion) {
    clearSessionCookie(res);
    res.status(401).json({ error: "Session expired" });
    return;
  }
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

// Google OAuth start
router.get("/google/start", (req, res) => {
  const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
  const APP_URL = process.env.APP_URL ?? `https://${process.env.REPLIT_DEV_DOMAIN}`;
  if (!GOOGLE_CLIENT_ID) {
    res.status(503).json({ error: "Google OAuth not configured" });
    return;
  }
  const next = (req.query as Record<string, string>)["next"] ?? "/dashboard";
  const state = signStateToken(next);
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: `${APP_URL}/api/auth/google/callback`,
    response_type: "code",
    scope: "openid email profile",
    state,
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

// Google OAuth callback
router.get("/google/callback", async (req, res): Promise<void> => {
  res.set("Cache-Control", "no-store");
  const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
  const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
  const APP_URL = process.env.APP_URL ?? `https://${process.env.REPLIT_DEV_DOMAIN}`;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    res.status(503).send("Google OAuth not configured");
    return;
  }
  const query = req.query as Record<string, string>;
  const code = query["code"];
  const state = query["state"];
  if (!code || !state) {
    res.status(400).send("Missing code or state");
    return;
  }
  const statePayload = verifyStateToken(state);
  const next = statePayload?.next ?? "/dashboard";

  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: `${APP_URL}/api/auth/google/callback`,
        grant_type: "authorization_code",
      }),
    });
    const tokenData = (await tokenRes.json()) as { id_token?: string };
    if (!tokenData.id_token) {
      res.redirect("/staff-login?error=oauth_failed");
      return;
    }
    const parts = tokenData.id_token.split(".");
    const payload = JSON.parse(
      Buffer.from(parts[1]!, "base64url").toString()
    ) as { email?: string; name?: string; email_verified?: boolean };
    if (!payload.email || !payload.email_verified) {
      res.redirect("/staff-login?error=unverified_email");
      return;
    }
    const normalizedEmail = payload.email.toLowerCase();
    const users = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, normalizedEmail))
      .limit(1);
    const user = users[0];
    if (!user || !user.isActive) {
      res.redirect("/staff-login?error=not_authorized");
      return;
    }
    await db
      .update(usersTable)
      .set({ lastLoginAt: new Date() })
      .where(eq(usersTable.id, user.id));
    const token = signSession({
      sub: user.id,
      email: user.email,
      name: user.name,
      role: user.role as Role,
      campuses: user.campuses,
      subjects: user.subjects,
      tokenVersion: user.tokenVersion,
    });
    setSessionCookie(res, token);
    res.redirect(next);
  } catch {
    res.redirect("/staff-login?error=oauth_failed");
  }
});

export default router;
