// Creates the report settings tables (if missing) and loads lib/db/seed/*.json into them:
//   skill_assessment_course_map, report_removed_courses, spi_quiz_questions, test_students
// Run where DATABASE_URL points at the database to fill (Replit Shell for Development):
//   node lib/db/scripts/seed-report-config.mjs
// Safe to run again: rows already in a table are left as they are (ON CONFLICT DO NOTHING), so
// edits made in the database are never overwritten. All four tables in one transaction.
import { readFileSync } from "node:fs";
import pg from "pg";

const { Client } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
}

const seed = (name) => JSON.parse(readFileSync(new URL(`../seed/${name}.json`, import.meta.url), "utf8")).rows;

// Same columns and constraint names as lib/db/src/schema/reportConfig.ts.
const TABLES = [
  {
    name: "skill_assessment_course_map",
    create: `CREATE TABLE IF NOT EXISTS "skill_assessment_course_map" (
      "college" text NOT NULL,
      "batch" text NOT NULL,
      "skill_assessment_course_name" text NOT NULL,
      "report_course_name" text,
      "status" text,
      "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT "skill_assessment_course_map_pk" PRIMARY KEY ("college", "batch", "skill_assessment_course_name")
    )`,
    columns: ["college", "batch", "skill_assessment_course_name", "report_course_name", "status"],
    rows: seed("skill-assessment-course-map"),
  },
  {
    name: "report_removed_courses",
    create: `CREATE TABLE IF NOT EXISTS "report_removed_courses" (
      "id" serial PRIMARY KEY NOT NULL,
      "campus" text DEFAULT '*' NOT NULL,
      "course" text NOT NULL,
      "reason" text,
      "removed_on" date,
      "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT "report_removed_courses_campus_course_unique" UNIQUE ("campus", "course")
    )`,
    columns: ["campus", "course", "reason", "removed_on"],
    rows: seed("report-removed-courses"),
  },
  {
    name: "spi_quiz_questions",
    create: `CREATE TABLE IF NOT EXISTS "spi_quiz_questions" (
      "id" text PRIMARY KEY NOT NULL,
      "position" integer NOT NULL,
      "topic" text,
      "question" text NOT NULL,
      "options" jsonb NOT NULL,
      "correct" text NOT NULL,
      "explanation" jsonb DEFAULT '[]'::jsonb NOT NULL,
      "is_active" boolean DEFAULT true NOT NULL,
      "updated_at" timestamp with time zone DEFAULT now() NOT NULL
    )`,
    columns: ["id", "position", "topic", "question", "options", "correct", "explanation"],
    json: ["options", "explanation"],
    rows: seed("spi-quiz-questions"),
  },
  {
    name: "test_students",
    create: `CREATE TABLE IF NOT EXISTS "test_students" (
      "student_id" text PRIMARY KEY NOT NULL,
      "email" text,
      "password_hash" text NOT NULL,
      "college" text,
      "expires_at" date,
      "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT "test_students_email_unique" UNIQUE ("email")
    )`,
    columns: ["student_id", "email", "password_hash", "college", "expires_at"],
    rows: seed("test-students"),
  },
];

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

try {
  await client.query("BEGIN");
  for (const t of TABLES) {
    await client.query(t.create);
    const before = (await client.query(`SELECT COUNT(*)::int AS n FROM "${t.name}"`)).rows[0].n;
    for (const row of t.rows) {
      const values = t.columns.map((c) => (t.json?.includes(c) ? JSON.stringify(row[c]) : row[c] ?? null));
      const marks = t.columns.map((_, i) => `$${i + 1}`).join(",");
      await client.query(
        `INSERT INTO "${t.name}" (${t.columns.map((c) => `"${c}"`).join(",")}) VALUES (${marks}) ON CONFLICT DO NOTHING`,
        values,
      );
    }
    const after = (await client.query(`SELECT COUNT(*)::int AS n FROM "${t.name}"`)).rows[0].n;
    console.log(`${t.name}: ${before} rows before, ${after} after; seed file has ${t.rows.length} rows.`);
  }
  await client.query("COMMIT");
} catch (err) {
  await client.query("ROLLBACK").catch(() => {});
  console.error("Rolled back, nothing changed:", err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
