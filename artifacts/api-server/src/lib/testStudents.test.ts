import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import bcrypt from "bcryptjs";

const dir = mkdtempSync(path.join(tmpdir(), "niat-test-students-"));
const file = path.join(dir, "test-students.json");
process.env["TEST_STUDENTS_PATH"] = file;
const write = (students: unknown[]) => writeFileSync(file, JSON.stringify({ students }));
after(() => rmSync(dir, { recursive: true, force: true }));

const { checkTestStudentLogin, signStudentToken, studentIdFromToken } = await import("./testStudents.js");

const ID = "fd977eae-360d-47f6-b86c-2a096c05b51d";
const hash = bcrypt.hashSync("right-password", 4);

test("right id and password logs in; hyphens and case do not matter", async () => {
  write([{ studentId: ID, passwordHash: hash }]);
  assert.equal(await checkTestStudentLogin(ID, "right-password"), true);
  assert.equal(await checkTestStudentLogin(ID.replaceAll("-", "").toUpperCase(), "right-password"), true);
});

test("wrong password, unknown id and an expired login are refused", async () => {
  write([
    { studentId: ID, passwordHash: hash },
    { studentId: "11111111-2222-3333-4444-555555555555", passwordHash: hash, expiresAt: "2020-01-01" },
  ]);
  assert.equal(await checkTestStudentLogin(ID, "wrong"), false);
  assert.equal(await checkTestStudentLogin("99999999-2222-3333-4444-555555555555", "right-password"), false);
  assert.equal(await checkTestStudentLogin("11111111-2222-3333-4444-555555555555", "right-password"), false);
});

test("the cookie names only its own student and stops working once the row is removed", () => {
  write([{ studentId: ID, passwordHash: hash }]);
  const token = signStudentToken(ID);
  assert.equal(studentIdFromToken(token), ID.replaceAll("-", ""));
  assert.equal(studentIdFromToken(undefined), null);
  assert.equal(studentIdFromToken(`${token}x`), null);
  write([]);
  assert.equal(studentIdFromToken(token), null);
});
