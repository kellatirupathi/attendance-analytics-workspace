import { pgTable, text, integer, boolean, timestamp, serial, unique } from "drizzle-orm/pg-core";

/**
 * SPI quick quiz tracking. One attempt per student (the quiz is taken once; after it is finished
 * the report opens directly on any device). Staff previews are not saved. Test logins are marked
 * is_test so the analytics can leave them out.
 */
export const spiQuizAttemptsTable = pgTable("spi_quiz_attempts", {
  id: serial("id").primaryKey(),
  /** Student id without hyphens, lower-cased. */
  studentId: text("student_id").notNull().unique("spi_quiz_attempts_student_unique"),
  isTest: boolean("is_test").notNull().default(false),
  college: text("college"),
  batch: text("batch"),
  section: text("section"),
  semester: text("semester"),
  /** First time the student reached the quiz gate (opened the report). */
  openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  /** Correct answers, counted on the server when the quiz is finished. */
  score: integer("score"),
  totalQuestions: integer("total_questions"),
  totalSeconds: integer("total_seconds"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** One row per question answered; only the first answer to a question counts. */
export const spiQuizAnswersTable = pgTable(
  "spi_quiz_answers",
  {
    id: serial("id").primaryKey(),
    studentId: text("student_id").notNull(),
    questionId: text("question_id").notNull(),
    /** Question order for this student (1–10). */
    position: integer("position"),
    option: text("option").notNull(),
    correct: boolean("correct").notNull(),
    /** Seconds since the previous answer (or since the quiz started, for the first one). */
    seconds: integer("seconds"),
    answeredAt: timestamp("answered_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("spi_quiz_answers_student_question_unique").on(t.studentId, t.questionId)],
);
