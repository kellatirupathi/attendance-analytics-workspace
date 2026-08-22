import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  integer,
  numeric,
  date,
  pgEnum,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./brave.js";

/**
 * Recovery (remedial class) tracking.
 *
 * Attendance itself lives in BigQuery; these tables own everything about the
 * remedial classes — the curriculum they work through, which topics have been
 * re-taught, and when. Postgres is the source of truth for all of it.
 */

export const topicStatusEnum = pgEnum("recovery_topic_status", [
  "pending",
  "scheduled",
  "completed",
]);

export const recoverySessionStatusEnum = pgEnum("recovery_session_status", [
  "planned",
  "conducted",
  "partial",
  "cancelled",
  "no_show",
]);

/**
 * Master curriculum: the ordered lecture sequence for a campus + subject,
 * seeded from the prod-sequence exports. Only rows with Slot Type = 'Lecture'
 * belong here — quizzes, reading material and coding practice are excluded,
 * because recovery classes re-teach lectures only.
 *
 * Sections all follow this same order, at their own pace, so the sequence is
 * shared and only progress differs.
 */
export const recoveryTopicsTable = pgTable(
  "recovery_topics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campus: text("campus").notNull(),
    // canonical: DSA | Backend | Aptitude | Math | English | GenAI
    subject: text("subject").notNull(),
    sequenceNo: integer("sequence_no").notNull(),
    weekNo: integer("week_no"),
    moduleName: text("module_name"),
    topicTitle: text("topic_title").notNull(),
    /** Platform unit id. Joins to BigQuery where the export supplied one. */
    unitId: uuid("unit_id"),
    /**
     * Resolved once at seed time against BigQuery's session titles, so queries
     * join on a stored exact string instead of re-running fuzzy matching per
     * request. Null means unresolved — surface these for manual mapping rather
     * than letting them silently report 0% attendance.
     */
    bigquerySessionTitle: text("bigquery_session_title"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("recovery_topics_seq_idx").on(
      table.campus,
      table.subject,
      table.sequenceNo,
    ),
    index("recovery_topics_campus_subject_idx").on(table.campus, table.subject),
    index("recovery_topics_bq_title_idx").on(table.bigquerySessionTitle),
  ],
);

/**
 * Which curriculum topics have been recovered, and where each section stands.
 * `section` is nullable: recovery classes are currently run pooled across all
 * sections, so a null row means "recovered for the whole campus".
 */
export const recoveryProgressTable = pgTable(
  "recovery_progress",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campus: text("campus").notNull(),
    subject: text("subject").notNull(),
    section: text("section"),
    topicId: uuid("topic_id")
      .notNull()
      .references(() => recoveryTopicsTable.id, { onDelete: "cascade" }),
    status: topicStatusEnum("status").notNull().default("pending"),
    /** Lecture attendance for this topic, recomputed from BigQuery. */
    attendancePct: numeric("attendance_pct", { precision: 5, scale: 2 }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("recovery_progress_campus_subject_idx").on(
      table.campus,
      table.subject,
    ),
    index("recovery_progress_topic_idx").on(table.topicId),
  ],
);

/** One remedial class: typically 90 minutes covering one to three topics. */
export const recoverySessionsTable = pgTable(
  "recovery_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campus: text("campus").notNull(),
    subject: text("subject").notNull(),
    /** Null when students are pooled across sections, which is the norm today. */
    section: text("section"),
    instructorId: uuid("instructor_id").references(() => usersTable.id),
    /** Free text: backup instructors are not always platform users. */
    instructorName: text("instructor_name").notNull().default(""),
    isBackupInstructor: boolean("is_backup_instructor").notNull().default(false),
    scheduledDate: date("scheduled_date").notNull(),
    startTime: text("start_time").notNull().default(""),
    endTime: text("end_time").notNull().default(""),
    status: recoverySessionStatusEnum("status").notNull().default("planned"),
    cancellationReason: text("cancellation_reason"),
    remarks: text("remarks").notNull().default(""),
    qaReportUrls: text("qa_report_urls").array().notNull().default([]),
    studentsExpected: integer("students_expected"),
    studentsAttended: integer("students_attended"),
    reportedBy: uuid("reported_by").references(() => usersTable.id),
    reportedAt: timestamp("reported_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("recovery_sessions_campus_subject_idx").on(
      table.campus,
      table.subject,
    ),
    index("recovery_sessions_date_idx").on(table.scheduledDate),
    index("recovery_sessions_status_idx").on(table.status),
  ],
);

/**
 * Topics assigned to a session, and whether they were actually covered.
 * `wasCovered = false` returns the topic to the queue; `carriedForwardFrom`
 * records which session missed it, so repeat slippage is visible.
 */
export const sessionTopicsTable = pgTable(
  "recovery_session_topics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => recoverySessionsTable.id, { onDelete: "cascade" }),
    topicId: uuid("topic_id")
      .notNull()
      .references(() => recoveryTopicsTable.id, { onDelete: "cascade" }),
    /** Null until the instructor files their report. */
    wasCovered: boolean("was_covered"),
    carriedForwardFrom: uuid("carried_forward_from"),
    orderInSession: integer("order_in_session").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("recovery_session_topics_unique_idx").on(
      table.sessionId,
      table.topicId,
    ),
    index("recovery_session_topics_topic_idx").on(table.topicId),
  ],
);

export const insertRecoveryTopicSchema = createInsertSchema(
  recoveryTopicsTable,
).omit({ id: true, createdAt: true, updatedAt: true });

export const selectRecoveryTopicSchema =
  createSelectSchema(recoveryTopicsTable);

export const insertRecoverySessionSchema = createInsertSchema(
  recoverySessionsTable,
).omit({ id: true, createdAt: true, updatedAt: true });

export const selectRecoverySessionSchema =
  createSelectSchema(recoverySessionsTable);

export type RecoveryTopic = typeof recoveryTopicsTable.$inferSelect;
export type InsertRecoveryTopic = z.infer<typeof insertRecoveryTopicSchema>;
export type RecoveryProgress = typeof recoveryProgressTable.$inferSelect;
export type InsertRecoveryProgress = typeof recoveryProgressTable.$inferInsert;
export type RecoverySession = typeof recoverySessionsTable.$inferSelect;
export type InsertRecoverySession = z.infer<typeof insertRecoverySessionSchema>;
export type SessionTopic = typeof sessionTopicsTable.$inferSelect;
export type InsertSessionTopic = typeof sessionTopicsTable.$inferInsert;