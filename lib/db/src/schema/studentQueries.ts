import { pgTable, text, timestamp, serial, boolean, index } from "drizzle-orm/pg-core";

/**
 * Queries students raise from their SPI report ("Raise a query"): a category, one of the
 * subjects their report shows, and the issue in their own words. One row per submission;
 * college, semester and section are copied from the synced report when it is saved.
 */
export const spiStudentQueriesTable = pgTable(
  "spi_student_queries",
  {
    id: serial("id").primaryKey(),
    /** Student id without hyphens, lower-cased. */
    studentId: text("student_id").notNull(),
    isTest: boolean("is_test").notNull().default(false),
    college: text("college"),
    semester: text("semester"),
    section: text("section"),
    /** attendance | classroom_quiz | module_quiz | skill_assessment | final_skill_assessment */
    category: text("category").notNull(),
    subject: text("subject").notNull(),
    details: text("details").notNull(),
    /** open | closed */
    status: text("status").notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("spi_student_queries_student_idx").on(t.studentId, t.createdAt)],
);
