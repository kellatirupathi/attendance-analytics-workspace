// Adds (or replaces) a test student login in config/test-students.json.
// Usage: pnpm --filter @workspace/api-server run add:test-student -- <student-uuid> [days=14] [password] [email]
// Prints the password once; only its hash is stored. Remove the row to end that login.
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const [studentId, daysArg, passwordArg, emailArg] = process.argv.slice(2);
if (!studentId || !/^[a-zA-Z0-9_-]{4,64}$/.test(studentId)) {
  console.error("Usage: add-test-student <student-uuid> [days=14] [password] [email]");
  process.exit(1);
}
const days = Number(daysArg ?? 14);
if (!Number.isFinite(days) || days < 1 || days > 90) {
  console.error("days must be 1 to 90");
  process.exit(1);
}
const password = passwordArg ?? randomBytes(6).toString("base64url");
const file = join(dirname(fileURLToPath(import.meta.url)), "config", "test-students.json");
const json = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { students: [] };
const key = (id) => id.toLowerCase().replaceAll("-", "");
const expiresAt = new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
json.students = [
  ...(json.students ?? []).filter((s) => key(s.studentId) !== key(studentId)),
  { studentId: studentId.toLowerCase(), ...(emailArg ? { email: emailArg.toLowerCase() } : {}), passwordHash: bcrypt.hashSync(password, 10), expiresAt },
];
writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
console.log(`Student: ${studentId}\n${emailArg ? `Email: ${emailArg.toLowerCase()}\n` : ""}Password: ${password}\nExpires: ${expiresAt} (end of day, UTC)`);
