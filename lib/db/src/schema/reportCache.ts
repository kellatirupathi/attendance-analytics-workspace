import { pgTable, text, integer, real, jsonb, timestamp, serial } from "drizzle-orm/pg-core";

/**
 * Every current-semester student's SPI report, built from BigQuery by the report sync
 * (api-server lib/spiReportSync.ts) so a report opens from here instead of live BigQuery.
 * Quiz status is not stored here; it is always read live from spi_quiz_attempts.
 */
export const spiReportCacheTable = pgTable("spi_report_cache", {
  /** Student id without hyphens, lower-cased. */
  studentId: text("student_id").primaryKey(),
  college: text("college"),
  semester: text("semester"),
  section: text("section"),
  batch: text("batch"),
  attendancePct: real("attendance_pct"),
  /** Out of 10; null until it can be calculated. */
  spi: real("spi"),
  /** Courses in Skill Debt (below 50%). */
  needsAttention: integer("needs_attention"),
  /** The full report, exactly as GET /api/attendance/students/:id/scorecard returns it. */
  report: jsonb("report").notNull(),
  builtAt: timestamp("built_at", { withTimezone: true }).notNull().defaultNow(),
});

/** One row per sync run: when, how many students, and why it failed if it did. */
export const spiReportSyncRunsTable = pgTable("spi_report_sync_runs", {
  id: serial("id").primaryKey(),
  /** schedule | startup | manual | config */
  trigger: text("trigger").notNull(),
  /** running | success | failed | skipped */
  status: text("status").notNull(),
  students: integer("students"),
  /** Course credits, removed courses, SA map and attendance rules the reports were built with. */
  configVersion: text("config_version"),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  durationMs: integer("duration_ms"),
});
