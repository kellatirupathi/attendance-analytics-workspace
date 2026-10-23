import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";

/**
 * Course credits = course weights for the SPI (NIAT-SPI Execution Plan §3.3), one row per
 * semester course. semester_course_id is stored without hyphens, lower-cased, as BigQuery's
 * prod sequence ids are matched. institute_name / semester_title / course_title are for
 * reading only (taken from BigQuery when the row was loaded); matching uses the id alone.
 */
export const courseCreditsTable = pgTable("course_credits", {
  semesterCourseId: text("semester_course_id").primaryKey(),
  credits: integer("credits").notNull(),
  instituteName: text("institute_name"),
  semesterTitle: text("semester_title"),
  courseTitle: text("course_title"),
  source: text("source"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CourseCredit = typeof courseCreditsTable.$inferSelect;
