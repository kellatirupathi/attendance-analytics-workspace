import { pgTable, text, timestamp, serial, boolean, integer, index } from "drizzle-orm/pg-core";

/**
 * Chat on top of "Raise a query" (api-server lib/queryChat.ts creates these tables when missing).
 * A query's first message is spi_student_queries.details; the rows here are the replies after it.
 */
export const spiQueryMessagesTable = pgTable(
  "spi_query_messages",
  {
    id: serial("id").primaryKey(),
    queryId: integer("query_id").notNull(),
    /** student | ops */
    author: text("author").notNull(),
    /** Staff member's name; never sent to the student. */
    authorName: text("author_name"),
    body: text("body").notNull(),
    /** A staff-only note: the student never sees it. */
    internal: boolean("internal").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("spi_query_messages_query_idx").on(t.queryId, t.createdAt)],
);

/** Per query: received | in_progress | waiting_on_student | resolved, who is on it, and when the student last read. */
export const spiQueryStateTable = pgTable("spi_query_state", {
  queryId: integer("query_id").primaryKey(),
  status: text("status").notNull().default("received"),
  assignedTo: text("assigned_to"),
  firstReplyAt: timestamp("first_reply_at", { withTimezone: true }),
  studentReadAt: timestamp("student_read_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Per admin: when they last opened the queries bell. */
export const spiQueryOpsSeenTable = pgTable("spi_query_ops_seen", {
  adminSub: text("admin_sub").primaryKey(),
  seenAt: timestamp("seen_at", { withTimezone: true }).notNull().defaultNow(),
});
