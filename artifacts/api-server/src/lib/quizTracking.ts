import { and, eq, isNull, sql } from "drizzle-orm";
import { db, spiQuizAttemptsTable } from "@workspace/db";
import { getStudentOverview, getStudentPlacement } from "./queries.js";
import { isTestStudent, studentKey } from "./testStudents.js";

/**
 * Saves a student's SPI quiz progress (spi_quiz_attempts / spi_quiz_answers) for the analytics:
 * opened (first reached the quiz gate), started, each answer with its time, finished with score.
 * The quiz is taken once: finished_at decides "done", so the report opens directly on any device.
 * Staff previews are not saved. A tracking failure is logged and never blocks the student.
 */
const log = (what: string, err: unknown) => console.error(`[quizTracking] ${what} failed`, err);

/** True when the database says this student finished the quiz. */
export async function quizFinished(studentId: string): Promise<boolean> {
  try {
    const [row] = await db
      .select({ finishedAt: spiQuizAttemptsTable.finishedAt })
      .from(spiQuizAttemptsTable)
      .where(eq(spiQuizAttemptsTable.studentId, studentKey(studentId)));
    return Boolean(row?.finishedAt);
  } catch (err) {
    log("quizFinished", err);
    return false;
  }
}

/** First visit to the quiz gate: one row per student with college, batch, section and semester. */
export async function recordOpened(studentId: string): Promise<void> {
  const key = studentKey(studentId);
  try {
    const [existing] = await db.select({ id: spiQuizAttemptsTable.id }).from(spiQuizAttemptsTable).where(eq(spiQuizAttemptsTable.studentId, key));
    if (existing) return;
    const [overview, placement, isTest] = await Promise.all([
      getStudentOverview(studentId).catch(() => null),
      getStudentPlacement(studentId).catch(() => ({ batch: null, semester: null })),
      isTestStudent(key),
    ]);
    await db
      .insert(spiQuizAttemptsTable)
      .values({
        studentId: key,
        isTest,
        college: overview?.instituteName ?? null,
        section: overview?.sectionName ?? null,
        batch: placement.batch,
        semester: placement.semester,
      })
      .onConflictDoNothing();
  } catch (err) {
    log("recordOpened", err);
  }
}

export async function recordStarted(studentId: string): Promise<void> {
  try {
    await db
      .update(spiQuizAttemptsTable)
      .set({ startedAt: sql`COALESCE(${spiQuizAttemptsTable.startedAt}, now())`, updatedAt: sql`now()` })
      .where(and(eq(spiQuizAttemptsTable.studentId, studentKey(studentId)), isNull(spiQuizAttemptsTable.finishedAt)));
  } catch (err) {
    log("recordStarted", err);
  }
}

/** Saves the first answer to a question; time = seconds since the previous answer (or the start). */
export async function recordAnswer(
  studentId: string,
  answer: { questionId: string; option: string; correct: boolean; position: number | null },
): Promise<void> {
  const key = studentKey(studentId);
  try {
    await db.execute(sql`
      INSERT INTO spi_quiz_answers (student_id, question_id, position, option, correct, seconds)
      SELECT ${key}, ${answer.questionId}, ${answer.position}, ${answer.option}, ${answer.correct},
        GREATEST(0, LEAST(3600, EXTRACT(EPOCH FROM now() - COALESCE(
          (SELECT MAX(answered_at) FROM spi_quiz_answers WHERE student_id = ${key}),
          (SELECT started_at FROM spi_quiz_attempts WHERE student_id = ${key}),
          now()))))::int
      WHERE NOT EXISTS (SELECT 1 FROM spi_quiz_attempts WHERE student_id = ${key} AND finished_at IS NOT NULL)
      ON CONFLICT (student_id, question_id) DO NOTHING`);
  } catch (err) {
    log("recordAnswer", err);
  }
}

/** Marks the quiz finished once: score = correct answers saved, total time = finish − start. */
export async function recordFinished(studentId: string, totalQuestions: number): Promise<void> {
  const key = studentKey(studentId);
  try {
    await db.execute(sql`
      UPDATE spi_quiz_attempts SET
        finished_at = now(),
        score = (SELECT COUNT(*) FROM spi_quiz_answers WHERE student_id = ${key} AND correct),
        total_questions = ${totalQuestions},
        total_seconds = GREATEST(0, EXTRACT(EPOCH FROM now() - COALESCE(started_at, opened_at)))::int,
        updated_at = now()
      WHERE student_id = ${key} AND finished_at IS NULL`);
  } catch (err) {
    log("recordFinished", err);
  }
}

