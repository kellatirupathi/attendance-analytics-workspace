import { pgTable, text, integer, boolean, timestamp, date, jsonb, serial, primaryKey, unique } from "drizzle-orm/pg-core";

/**
 * Settings the student SPI report reads, kept in PostgreSQL so they can be changed without a
 * code change (each is re-read by the API at most once a minute). Names match ignoring case and
 * extra spaces in the API.
 */

/**
 * Skill Assessment course code (assessment team's name) → report course, per college, batch and semester.
 * The report uses only rows with a semester and status "Mapped"; rows without a semester (the list before
 * 11 Nov 2026) are kept but not used. Blank report course = not mapped yet. The report sync refreshes
 * is_current_semester, main_sa_count, students and the SA dates, and adds new SA courses as "To confirm".
 */
export const skillAssessmentCourseMapTable = pgTable(
  "skill_assessment_course_map",
  {
    college: text("college").notNull(),
    batch: text("batch").notNull(),
    skillAssessmentCourseName: text("skill_assessment_course_name").notNull(),
    reportCourseName: text("report_course_name"),
    status: text("status"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    /** derived_semester_title in the Skill Assessment data, e.g. "Semester 3". */
    semester: text("semester"),
    /** 1 while this is the batch's current semester (attendance is_current_semester), else 0. */
    isCurrentSemester: integer("is_current_semester"),
    /** MAIN Skill Assessments held for this course (MOCK ones are practice). */
    mainSaCount: integer("main_sa_count"),
    students: integer("students"),
    firstSaDate: date("first_sa_date"),
    lastSaDate: date("last_sa_date"),
  },
  (t) => [primaryKey({ name: "skill_assessment_course_map_pk", columns: [t.college, t.batch, t.skillAssessmentCourseName] })],
);

/** Subjects left off the student report. campus "*" = every campus. */
export const reportRemovedCoursesTable = pgTable(
  "report_removed_courses",
  {
    id: serial("id").primaryKey(),
    campus: text("campus").notNull().default("*"),
    course: text("course").notNull(),
    reason: text("reason"),
    removedOn: date("removed_on"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("report_removed_courses_campus_course_unique").on(t.campus, t.course)],
);

/** The SPI quick quiz shown before the report opens, in position order. */
export const spiQuizQuestionsTable = pgTable("spi_quiz_questions", {
  id: text("id").primaryKey(),
  position: integer("position").notNull(),
  topic: text("topic"),
  question: text("question").notNull(),
  options: jsonb("options").$type<Record<string, string>>().notNull(),
  correct: text("correct").notNull(),
  explanation: jsonb("explanation").$type<string[]>().notNull().default([]),
  isActive: boolean("is_active").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Test student logins: a student id (or test email) + password opens that one student's report. Passwords are bcrypt hashes. */
export const testStudentsTable = pgTable("test_students", {
  studentId: text("student_id").primaryKey(),
  email: text("email").unique("test_students_email_unique"),
  passwordHash: text("password_hash").notNull(),
  college: text("college"),
  expiresAt: date("expires_at"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
