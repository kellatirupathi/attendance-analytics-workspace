import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

/**
 * Test student logins: a student UUID (or the test email given to it) plus a password opens that one student's report.
 * For testing until the Learning Portal SSO passes the UUID in. No database change, and the
 * cookie opens nothing but the report of the student it was issued for.
 *
 * Read from config/test-students.json ({ students: [{ studentId, passwordHash, email?, expiresAt? }] }),
 * or TEST_STUDENTS_PATH. The file is re-read when it changes, so removing a row or passing
 * its expiresAt ends that login at once (the cookie is checked against the file on every request).
 * Ids are matched without hyphens, lower-cased.
 */
const FILE_NAME = "test-students.json";
export const STUDENT_COOKIE_NAME = "niat_student";
const STUDENT_COOKIE_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // same as the staff session
const STUDENT_AUDIENCE = "student-report";
const JWT_SECRET = process.env["JWT_SECRET"] ?? "dev-secret-change-me";

export const studentKey = (id: string) => id.trim().toLowerCase().replace(/-/g, "");

interface TestStudent {
  studentId: string;
  passwordHash: string;
  email?: string;
  expiresAt?: string;
}

function candidatePaths(): string[] {
  const fromEnv = process.env["TEST_STUDENTS_PATH"]?.trim();
  if (fromEnv) return [path.resolve(fromEnv)];
  return [
    path.resolve(process.cwd(), "config", FILE_NAME),
    path.resolve(process.cwd(), "artifacts", "api-server", "config", FILE_NAME),
  ];
}

let cached: { key: string; students: Map<string, TestStudent> } | null = null;

function loadTestStudents(): Map<string, TestStudent> {
  const file = candidatePaths().find((candidate) => existsSync(candidate));
  if (!file) return new Map();
  try {
    const key = `${file}:${statSync(file).mtimeMs}`;
    if (cached?.key === key) return cached.students;
    const json = JSON.parse(readFileSync(file, "utf8")) as { students?: unknown[] };
    const students = new Map<string, TestStudent>();
    for (const entry of json.students ?? []) {
      const row = entry as Partial<TestStudent> | null;
      if (typeof row?.studentId !== "string" || typeof row.passwordHash !== "string") continue;
      students.set(studentKey(row.studentId), {
        studentId: row.studentId,
        passwordHash: row.passwordHash,
        email: typeof row.email === "string" && row.email.trim() ? row.email.trim().toLowerCase() : undefined,
        expiresAt: typeof row.expiresAt === "string" ? row.expiresAt : undefined,
      });
    }
    cached = { key, students };
    return students;
  } catch (err) {
    console.error(`[testStudents] could not read ${file}; keeping the last good list`, err);
    return cached?.students ?? new Map();
  }
}

/** The row for a login that is a student id or a test email, if it is in the file. */
function findTestStudent(login: string): TestStudent | undefined {
  const students = loadTestStudents();
  const byId = students.get(studentKey(login));
  if (byId) return byId;
  const email = login.trim().toLowerCase();
  return [...students.values()].find((row) => row.email === email);
}

/** Active = in the file and not past its expiresAt (end of that day, UTC). */
function activeTestStudent(login: string, now = Date.now()): TestStudent | null {
  const row = findTestStudent(login);
  if (!row) return null;
  if (row.expiresAt) {
    const end = Date.parse(`${row.expiresAt.slice(0, 10)}T23:59:59Z`);
    if (Number.isFinite(end) && now > end) return null;
  }
  return row;
}

// Compared when the id is unknown, so a wrong id and a wrong password take the same time.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 10);

/** The student id (no hyphens) when the login is an active test student and the password matches; otherwise null. */
export async function checkTestStudentLogin(login: string, password: string): Promise<string | null> {
  const row = activeTestStudent(login);
  const ok = await bcrypt.compare(password, row?.passwordHash ?? DUMMY_HASH);
  return row && ok ? studentKey(row.studentId) : null;
}

export function signStudentToken(studentId: string): string {
  return jwt.sign({ kind: "student", sid: studentKey(studentId) }, JWT_SECRET, {
    algorithm: "HS256",
    audience: STUDENT_AUDIENCE,
    expiresIn: "30d",
  });
}

/** The student id in a valid student cookie that is still an active test student; otherwise null. */
export function studentIdFromToken(token: string | undefined): string | null {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET, {
      algorithms: ["HS256"],
      audience: STUDENT_AUDIENCE,
    }) as { kind?: string; sid?: string };
    if (payload.kind !== "student" || !payload.sid) return null;
    return activeTestStudent(payload.sid) ? payload.sid : null;
  } catch {
    return null;
  }
}

export const studentCookieOptions = (production: boolean) => ({
  httpOnly: true,
  secure: production,
  sameSite: "lax" as const,
  path: "/",
});

export const studentCookieMaxAge = STUDENT_COOKIE_MAX_AGE;
