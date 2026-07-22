import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  integer,
  jsonb,
  pgEnum,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const roleEnum = pgEnum("role", [
  "superadmin",
  "admin",
  "hod",
  "capability_manager",
  "boa",
  "instructor",
]);

export const usersTable = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    passwordHash: text("password_hash"),
    role: roleEnum("role").notNull().default("instructor"),
    campuses: text("campuses").array().notNull().default([]),
    subjects: text("subjects").array().notNull().default([]),
    isActive: boolean("is_active").notNull().default(true),
    createdBy: text("created_by"),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    tokenVersion: integer("token_version").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("users_email_idx").on(table.email),
    index("users_role_idx").on(table.role),
  ],
);

export const campusesTable = pgTable("campuses", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  instituteId: text("institute_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Status a single requested date can be in.
export const requestStatusEnum = pgEnum("request_status", [
  "pending",
  "approved",
  "rejected",
]);

// One attendance-correction request submitted from a student's SPI report.
// A request can cover multiple dates; each date carries its own reason and
// status, stored as a JSON array so a single request row holds them all.
export interface RequestDate {
  date: string; // ISO yyyy-mm-dd
  reason: string;
  status: "pending" | "approved" | "rejected";
  decidedBy?: string | null; // email of the staff who approved/rejected
  decidedAt?: string | null; // ISO timestamp
}

export const attendanceRequestsTable = pgTable(
  "attendance_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studentId: text("student_id").notNull(),
    studentName: text("student_name").notNull().default(""),
    campus: text("campus").notNull().default(""),
    dates: jsonb("dates").$type<RequestDate[]>().notNull().default([]),
    // Rolled-up status: pending until every date is decided, then
    // approved (all approved) / rejected (all rejected) / partial (mixed).
    overallStatus: text("overall_status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("attendance_requests_campus_idx").on(table.campus),
    index("attendance_requests_student_idx").on(table.studentId),
  ],
);

// A notification is one recipient's view of an attendance request. Fanned out
// on submission: one row per recipient user (campus BOAs + all admins/
// superadmins). readAt marks when that user opened it.
export const notificationsTable = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    requestId: uuid("request_id")
      .notNull()
      .references(() => attendanceRequestsTable.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("notifications_user_idx").on(table.userId),
    index("notifications_request_idx").on(table.requestId),
  ],
);

export const insertUserSchema = createInsertSchema(usersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  tokenVersion: true,
});

export const selectUserSchema = createSelectSchema(usersTable);

export const insertCampusSchema = createInsertSchema(campusesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const selectCampusSchema = createSelectSchema(campusesTable);

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
export type InsertCampus = z.infer<typeof insertCampusSchema>;
export type Campus = typeof campusesTable.$inferSelect;

export type AttendanceRequest = typeof attendanceRequestsTable.$inferSelect;
export type InsertAttendanceRequest =
  typeof attendanceRequestsTable.$inferInsert;
export type Notification = typeof notificationsTable.$inferSelect;
export type InsertNotification = typeof notificationsTable.$inferInsert;
