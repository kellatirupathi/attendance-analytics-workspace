// Creates the SPI quiz tracking tables if missing (no data; rows come from students taking the quiz):
//   spi_quiz_attempts, spi_quiz_answers
// Run where DATABASE_URL points at the database (Replit Shell for Development):
//   node lib/db/scripts/create-quiz-tracking.mjs
// Safe to run again. Same columns and constraint names as lib/db/src/schema/quizTracking.ts.
import pg from "pg";

const { Client } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
}

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

try {
  await client.query("BEGIN");
  await client.query(`CREATE TABLE IF NOT EXISTS "spi_quiz_attempts" (
    "id" serial PRIMARY KEY NOT NULL,
    "student_id" text NOT NULL,
    "is_test" boolean DEFAULT false NOT NULL,
    "college" text,
    "batch" text,
    "section" text,
    "semester" text,
    "opened_at" timestamp with time zone DEFAULT now() NOT NULL,
    "started_at" timestamp with time zone,
    "finished_at" timestamp with time zone,
    "score" integer,
    "total_questions" integer,
    "total_seconds" integer,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "spi_quiz_attempts_student_unique" UNIQUE ("student_id")
  )`);
  await client.query(`CREATE TABLE IF NOT EXISTS "spi_quiz_answers" (
    "id" serial PRIMARY KEY NOT NULL,
    "student_id" text NOT NULL,
    "question_id" text NOT NULL,
    "position" integer,
    "option" text NOT NULL,
    "correct" boolean NOT NULL,
    "seconds" integer,
    "answered_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "spi_quiz_answers_student_question_unique" UNIQUE ("student_id", "question_id")
  )`);
  await client.query("COMMIT");
  for (const t of ["spi_quiz_attempts", "spi_quiz_answers"]) {
    const n = (await client.query(`SELECT COUNT(*)::int AS n FROM "${t}"`)).rows[0].n;
    console.log(`${t}: ready (${n} rows).`);
  }
} catch (err) {
  await client.query("ROLLBACK").catch(() => {});
  console.error("Rolled back, nothing changed:", err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
