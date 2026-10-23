// Creates the course_credits table (if missing) and loads seed/course-credits.json into it.
// Run in the Replit Shell, where DATABASE_URL points at that workspace's database:
//   pnpm --filter @workspace/db run seed:course-credits
// Safe to run again: rows already in the table are left as they are (ON CONFLICT DO NOTHING),
// so edits made in the database are never overwritten. All in one transaction.
import { readFileSync } from "node:fs";
import pg from "pg";

const { Client } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
}

const seed = JSON.parse(readFileSync(new URL("../seed/course-credits.json", import.meta.url), "utf8"));
const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

try {
  await client.query("BEGIN");
  // Same columns as lib/db/src/schema/courseCredits.ts.
  await client.query(`CREATE TABLE IF NOT EXISTS "course_credits" (
    "semester_course_id" text PRIMARY KEY NOT NULL,
    "credits" integer NOT NULL,
    "institute_name" text,
    "semester_title" text,
    "course_title" text,
    "source" text,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
  )`);
  const before = (await client.query(`SELECT COUNT(*)::int AS n FROM course_credits`)).rows[0].n;
  for (let i = 0; i < seed.rows.length; i += 200) {
    const chunk = seed.rows.slice(i, i + 200);
    const values = [];
    const params = [];
    chunk.forEach((r, k) => {
      const b = k * 6;
      values.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6})`);
      params.push(r.semester_course_id, r.credits, r.institute_name, r.semester_title, r.course_title, seed.source);
    });
    await client.query(
      `INSERT INTO course_credits (semester_course_id, credits, institute_name, semester_title, course_title, source)
       VALUES ${values.join(",")} ON CONFLICT (semester_course_id) DO NOTHING`,
      params,
    );
  }
  const after = (await client.query(`SELECT COUNT(*)::int AS n, COALESCE(SUM(credits), 0)::int AS total FROM course_credits`)).rows[0];
  await client.query("COMMIT");
  console.log(`course_credits: ${before} rows before, ${after.n} after (credits sum ${after.total}); seed file has ${seed.rows.length} rows.`);
} catch (err) {
  await client.query("ROLLBACK").catch(() => {});
  console.error("Rolled back, nothing changed:", err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
