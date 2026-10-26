// Writes the spi_quiz_questions table of the database in DATABASE_URL to lib/db/seed/spi-quiz-questions.json,
// so questions edited in one database (e.g. Development) can be loaded into another (Production).
// Run in the Replit Shell (DATABASE_URL = Development):
//   node lib/db/scripts/export-quiz-questions.mjs
// Read-only on the database.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL must be set.");

const out = fileURLToPath(new URL("../seed/spi-quiz-questions.json", import.meta.url));
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const { rows } = await client.query(
    `SELECT id, position, topic, question, options, correct, explanation, is_active
     FROM spi_quiz_questions ORDER BY position, id`,
  );
  writeFileSync(out, JSON.stringify({ rows }, null, 1) + "\n");
  console.log(`Exported ${rows.length} questions (${rows.filter((r) => r.is_active).length} active) to lib/db/seed/spi-quiz-questions.json`);
} finally {
  await client.end();
}
