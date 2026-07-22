import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";
import { canManage, type Role } from "./rbac.js";

const JWT_SECRET = process.env.JWT_SECRET ?? "dev-secret-change-me";
const COOKIE_NAME = "niat_session";
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface SessionPayload {
  sub: string;
  email: string;
  name: string;
  role: Role;
  campuses: string[];
  subjects: string[];
  tokenVersion: number;
}

export function signSession(payload: SessionPayload): string {
  return jwt.sign(payload, JWT_SECRET, { algorithm: "HS256", expiresIn: "30d" });
}

export function verifySession(token: string): SessionPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] }) as SessionPayload;
  } catch {
    return null;
  }
}

export function signStateToken(next: string): string {
  const safeNext = next && next.startsWith("/") ? next : "/dashboard";
  return jwt.sign({ next: safeNext }, JWT_SECRET, { expiresIn: "10m" });
}

export function verifyStateToken(token: string): { next: string } | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { next: string };
    return payload;
  } catch {
    return null;
  }
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME, { path: "/" });
}

export function getSessionFromRequest(req: Request): SessionPayload | null {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return null;
  return verifySession(token as string);
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      session?: SessionPayload;
    }
  }
}

export function requireSession(opts: { manage?: boolean } = {}) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const session = getSessionFromRequest(req);
    if (!session) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    // Token version check is done in the route handler via DB lookup when needed
    if (opts.manage && !canManage(session.role)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    req.session = session;
    next();
  };
}
