import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { dbSnapshot, rowsVersion } from "./dbSnapshot.js";

/**
 * Test student logins: a student UUID (or the test email given to it) plus a password opens that one student's report.
 * For testing until the Learning Portal SSO passes the UUID in. No database change, and the
 * cookie opens nothing but the report of the student it was issued for.
 *
 * Read from the test_students table (student_id, email, password_hash bcrypt, expires_at), re-read
 * at most once a minute, so removing a row or passing its expires_at ends that login within a
 * minute (the cookie is checked against the table on every request). TEST_STUDENTS_PATH (a JSON
 * file { students: [{ studentId, passwordHash, email?, expiresAt? }] }, used by the tests)
 * replaces the table when it is set. Ids are matched without hyphens, lower-cased.
 */
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

function toStudents(rows: Partial<TestStudent>[]): Map<string, TestStudent> {
  const students = new Map<string, TestStudent>();
  for (const row of rows) {
    if (typeof row?.studentId !== "string" || typeof row.passwordHash !== "string") continue;
    students.set(studentKey(row.studentId), {
      studentId: row.studentId,
      passwordHash: row.passwordHash,
      email: typeof row.email === "string" && row.email.trim() ? row.email.trim().toLowerCase() : undefined,
      expiresAt: typeof row.expiresAt === "string" ? row.expiresAt : undefined,
    });
  }
  return students;
}

const fromDb = dbSnapshot<Map<string, TestStudent>>(
  "testStudents",
  async () => {
    const { db, testStudentsTable } = await import("@workspace/db");
    const rows = await db.select().from(testStudentsTable);
    return {
      value: toStudents(rows.map((r) => ({ studentId: r.studentId, passwordHash: r.passwordHash, email: r.email ?? undefined, expiresAt: r.expiresAt ?? undefined }))),
      version: rowsVersion("test-students", rows),
    };
  },
  { value: new Map(), version: "none" },
);

async function loadTestStudents(): Promise<Map<string, TestStudent>> {
  const file = process.env["TEST_STUDENTS_PATH"]?.trim();
  if (file) {
    const full = path.resolve(file);
    if (!existsSync(full)) return new Map();
    try {
      const json = JSON.parse(readFileSync(full, "utf8")) as { students?: Partial<TestStudent>[] };
      return toStudents(json.students ?? []);
    } catch (err) {
      console.error(`[testStudents] could not read ${full}`, err);
      return new Map();
    }
  }
  return (await fromDb()).value;
}

/** The row for a login that is a student id or a test email, if it is in the list. */
async function findTestStudent(login: string): Promise<TestStudent | undefined> {
  const students = await loadTestStudents();
  const byId = students.get(studentKey(login));
  if (byId) return byId;
  const email = login.trim().toLowerCase();
  return [...students.values()].find((row) => row.email === email);
}

/** Active = in the list and not past its expiresAt (end of that day, UTC). */
async function activeTestStudent(login: string, now = Date.now()): Promise<TestStudent | null> {
  const row = await findTestStudent(login);
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
  const row = await activeTestStudent(login);
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
export async function studentIdFromToken(token: string | undefined): Promise<string | null> {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET, {
      algorithms: ["HS256"],
      audience: STUDENT_AUDIENCE,
    }) as { kind?: string; sid?: string };
    if (payload.kind !== "student" || !payload.sid) return null;
    return (await activeTestStudent(payload.sid)) ? payload.sid : null;
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
