import { pgTable, text, timestamp, serial, boolean, integer, primaryKey, index } from "drizzle-orm/pg-core";

/**
 * Chat on top of "Raise a query" (api-server lib/queryChat.ts creates these tables when missing).
 * One chat per category: spi_student_queries is the chat's header row, its `details` is the first message,
 * and the rows here are everything after it.
 */
export const spiQueryMessagesTable = pgTable(
  "spi_query_messages",
  {
    id: serial("id").primaryKey(),
    queryId: integer("query_id").notNull(),
    /** student | ops | system (a line the app adds, such as "Added Calculus") */
    author: text("author").notNull(),
    /** Staff member's name; never sent to the student. */
    authorName: text("author_name"),
    /** Key of the problem the student picked, on a message that raised one. */
    problem: text("problem"),
    body: text("body").notNull(),
    /** A staff-only note: the student never sees it. */
    internal: boolean("internal").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("spi_query_messages_query_idx").on(t.queryId, t.createdAt)],
);

/** Per chat: received | in_progress | waiting_on_student | resolved, who is on it, and when the student last read. */
export const spiQueryStateTable = pgTable("spi_query_state", {
  queryId: integer("query_id").primaryKey(),
  status: text("status").notNull().default("received"),
  assignedTo: text("assigned_to"),
  firstReplyAt: timestamp("first_reply_at", { withTimezone: true }),
  studentReadAt: timestamp("student_read_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** The subjects a student ticked in a chat, in the order they were added. */
export const spiQuerySubjectsTable = pgTable(
  "spi_query_subjects",
  {
    queryId: integer("query_id").notNull(),
    subject: text("subject").notNull(),
    ord: serial("ord"),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.queryId, t.subject] })],
);

/**
 * Screenshots: details only; the image itself is in the private Cloudflare R2 bucket under `storageKey`.
 * `queryId` is null until the student sends the message that attaches it, and `messageId` is null for a chat's first message.
 */
export const spiQueryAttachmentsTable = pgTable(
  "spi_query_attachments",
  {
    id: serial("id").primaryKey(),
    token: text("token").notNull().unique(),
    studentId: text("student_id").notNull(),
    queryId: integer("query_id"),
    messageId: integer("message_id"),
    storageKey: text("storage_key").notNull(),
    mime: text("mime").notNull(),
    size: integer("size").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("spi_query_attachments_query_idx").on(t.queryId)],
);

/** Per admin: when they last opened the queries bell. */
export const spiQueryOpsSeenTable = pgTable("spi_query_ops_seen", {
  adminSub: text("admin_sub").primaryKey(),
  seenAt: timestamp("seen_at", { withTimezone: true }).notNull().defaultNow(),
});
