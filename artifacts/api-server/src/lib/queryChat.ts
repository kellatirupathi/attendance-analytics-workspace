import { pool } from "@workspace/db";
import { getCachedPlacement } from "./spiReportSync.js";
import { ensureTable as ensureQueriesTable } from "./studentQueries.js";

/**
 * Chat on top of "Raise a query": one conversation per student, one thread per query.
 * The first message of a query is the query's own `details` (spi_student_queries is not altered,
 * so queries raised before the chat existed show up as threads with no replies).
 * Tables (created only when missing, like spi_student_queries):
 *   spi_query_messages  the replies, from the student or the SPI team (`internal` = staff-only note)
 *   spi_query_state     per query: status, who is on it, first reply time, when the student last read
 *   spi_query_ops_seen  per admin: when they last opened the bell
 */

/** received = waiting for the SPI team; waiting_on_student = the team asked the student something. */
export const QUERY_STATUSES = ["received", "in_progress", "waiting_on_student", "resolved"] as const;
export type QueryStatus = (typeof QUERY_STATUSES)[number];
export const MAX_MESSAGE = 2000;
/** The same message sent again within this time (double click, retry) is not saved twice. */
const DUPLICATE_WINDOW = "1 minute";

let tablesReady: Promise<void> | null = null;

function ensureTables(): Promise<void> {
  tablesReady ??= (async () => {
    await ensureQueriesTable();
    await pool.query(`CREATE TABLE IF NOT EXISTS spi_query_messages (
      id serial PRIMARY KEY,
      query_id integer NOT NULL,
      author text NOT NULL,
      author_name text,
      body text NOT NULL,
      internal boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
    await pool.query("CREATE INDEX IF NOT EXISTS spi_query_messages_query_idx ON spi_query_messages (query_id, created_at)");
    await pool.query(`CREATE TABLE IF NOT EXISTS spi_query_state (
      query_id integer PRIMARY KEY,
      status text NOT NULL DEFAULT 'received',
      assigned_to text,
      first_reply_at timestamptz,
      student_read_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS spi_query_ops_seen (
      admin_sub text PRIMARY KEY,
      seen_at timestamptz NOT NULL DEFAULT now()
    )`);
  })().catch((err) => {
    tablesReady = null;
    throw err;
  });
  return tablesReady;
}

/** A query's status: its chat state, else open -> received and closed -> resolved. */
const EFFECTIVE_STATUS = "COALESCE(s.status, CASE WHEN q.status = 'closed' THEN 'resolved' ELSE 'received' END)";

export interface ThreadQuery {
  id: number;
  category: string;
  subCategory: string | null;
  subject: string;
  status: QueryStatus;
  createdAt: string;
  assignedTo?: string | null;
  /** Student side: the team's replies this student has not read yet. */
  unread?: number;
}
export interface ThreadMessage {
  /** Negative = the query's own first message (id is -queryId). */
  id: number;
  queryId: number;
  author: "student" | "ops";
  authorName?: string | null;
  body: string;
  internal?: boolean;
  createdAt: string;
}

interface QueryRow {
  id: number;
  category: string;
  sub_category: string | null;
  subject: string;
  details: string;
  created_at: Date;
  status: QueryStatus;
  assigned_to: string | null;
  unread: string;
}
interface MessageRow {
  id: number;
  query_id: number;
  author: "student" | "ops";
  author_name: string | null;
  body: string;
  internal: boolean;
  created_at: Date;
}

async function loadThread(studentKey: string, forStaff: boolean): Promise<{ queries: ThreadQuery[]; messages: ThreadMessage[] }> {
  const { rows: qs } = await pool.query<QueryRow>(
    `SELECT q.id, q.category, q.sub_category, q.subject, q.details, q.created_at, ${EFFECTIVE_STATUS} AS status, s.assigned_to,
            (SELECT count(*) FROM spi_query_messages m WHERE m.query_id = q.id AND m.author = 'ops' AND NOT m.internal
               AND m.created_at > COALESCE(s.student_read_at, '-infinity')) AS unread
     FROM spi_student_queries q LEFT JOIN spi_query_state s ON s.query_id = q.id
     WHERE q.student_id = $1 ORDER BY q.created_at, q.id`,
    [studentKey],
  );
  const ids = qs.map((q) => q.id);
  const { rows: ms } = ids.length
    ? await pool.query<MessageRow>(
        `SELECT id, query_id, author, author_name, body, internal, created_at FROM spi_query_messages
         WHERE query_id = ANY($1::int[]) ${forStaff ? "" : "AND NOT internal"} ORDER BY created_at, id`,
        [ids],
      )
    : { rows: [] as MessageRow[] };
  const queries: ThreadQuery[] = qs.map((q) => ({
    id: q.id,
    category: q.category,
    subCategory: q.sub_category,
    subject: q.subject,
    status: q.status,
    createdAt: q.created_at.toISOString(),
    ...(forStaff ? { assignedTo: q.assigned_to } : { unread: Number(q.unread) }),
  }));
  const first: ThreadMessage[] = qs.map((q) => ({ id: -q.id, queryId: q.id, author: "student", body: q.details, createdAt: q.created_at.toISOString() }));
  const replies: ThreadMessage[] = ms.map((m) => ({
    id: m.id,
    queryId: m.query_id,
    author: m.author,
    // The student never sees which staff member replied.
    ...(forStaff ? { authorName: m.author_name, internal: m.internal } : {}),
    body: m.body,
    createdAt: m.created_at.toISOString(),
  }));
  const messages = [...first, ...replies].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id);
  return { queries, messages };
}

/* ------------------------------ student side ------------------------------ */

/** The student's whole conversation, plus how many team replies they have not read yet. */
export async function getStudentThread(studentKey: string) {
  await ensureTables();
  const [thread, unread] = await Promise.all([loadThread(studentKey, false), getStudentUnread(studentKey)]);
  return { ...thread, unread };
}

/** Just the unread count (the report page asks for this every minute). */
export async function getStudentUnread(studentKey: string): Promise<number> {
  await ensureTables();
  const { rows } = await pool.query<{ unread: string }>(
    `SELECT count(*) AS unread FROM spi_query_messages m
     JOIN spi_student_queries q ON q.id = m.query_id
     LEFT JOIN spi_query_state s ON s.query_id = q.id
     WHERE q.student_id = $1 AND m.author = 'ops' AND NOT m.internal AND m.created_at > COALESCE(s.student_read_at, '-infinity')`,
    [studentKey],
  );
  return Number(rows[0]?.unread ?? 0);
}

/** The student opened one query's chat (or, without `queryId`, all of them): its replies count as read. */
export async function markStudentRead(studentKey: string, queryId?: number): Promise<void> {
  await ensureTables();
  await pool.query(
    `INSERT INTO spi_query_state (query_id, status, student_read_at)
     SELECT id, CASE WHEN status = 'closed' THEN 'resolved' ELSE 'received' END, now() FROM spi_student_queries
     WHERE student_id = $1 AND ($2::int IS NULL OR id = $2)
     ON CONFLICT (query_id) DO UPDATE SET student_read_at = now()`,
    [studentKey, queryId ?? null],
  );
}

export type PostResult = { ok: true; id: number } | { ok: false; status: 400 | 404; error: string };

/** A student's reply on one of their own queries; it puts the query back in the team's "needs reply" list. */
export async function postStudentMessage(studentKey: string, queryId: number, rawBody: string): Promise<PostResult> {
  const body = rawBody.trim();
  if (!body) return { ok: false, status: 400, error: "Write a message" };
  if (body.length > MAX_MESSAGE) return { ok: false, status: 400, error: `Keep the message within ${MAX_MESSAGE} characters` };
  await ensureTables();
  const { rows: own } = await pool.query<{ id: number }>("SELECT id FROM spi_student_queries WHERE id = $1 AND student_id = $2", [queryId, studentKey]);
  if (!own[0]) return { ok: false, status: 404, error: "Query not found" };

  const { rows: same } = await pool.query<{ id: number }>(
    `SELECT id FROM spi_query_messages WHERE query_id = $1 AND author = 'student' AND body = $2
       AND created_at > now() - interval '${DUPLICATE_WINDOW}' ORDER BY id DESC LIMIT 1`,
    [queryId, body],
  );
  if (same[0]) return { ok: true, id: same[0].id };

  const { rows } = await pool.query<{ id: number }>("INSERT INTO spi_query_messages (query_id, author, body) VALUES ($1, 'student', $2) RETURNING id", [queryId, body]);
  await pool.query(
    `INSERT INTO spi_query_state (query_id, status, student_read_at) VALUES ($1, 'received', now())
     ON CONFLICT (query_id) DO UPDATE SET status = 'received', student_read_at = now(), updated_at = now()`,
    [queryId],
  );
  return { ok: true, id: rows[0]!.id };
}

/* -------------------------------- staff side ------------------------------- */

export interface InboxQuery {
  id: number;
  studentId: string;
  /** Null when the student's report has no name. */
  name: string | null;
  college: string | null;
  section: string | null;
  isTest: boolean;
  category: string;
  subject: string;
  status: QueryStatus;
  assignedTo: string | null;
  /** The last visible message: who sent it and the start of its text. */
  lastAuthor: "student" | "ops";
  preview: string;
  lastAt: string;
}

export const INBOX_PAGE = 50;

/** One row per query, newest activity first; `filter` = needs_reply | open | all. */
export async function listStaffQueries(opts: { filter: string; search: string; page: number }) {
  await ensureTables();
  await getCachedPlacement("-"); // makes sure spi_report_cache exists (the student's name comes from it)
  const conds: string[] = [];
  if (opts.filter === "needs_reply") conds.push("x.st = 'received'");
  else if (opts.filter === "open") conds.push("x.st <> 'resolved'");
  const params: unknown[] = [];
  const search = opts.search.trim().toLowerCase();
  if (search) {
    params.push(`%${search.replace(/[\\%_]/g, "\\$&")}%`);
    conds.push(`(lower(x.student_id) LIKE $1 OR lower(coalesce(x.name, '')) LIKE $1)`);
  }
  params.push(INBOX_PAGE + 1, opts.page * INBOX_PAGE);
  const { rows } = await pool.query<{
    id: number; student_id: string; name: string | null; college: string | null; section: string | null; is_test: boolean;
    category: string; subject: string; st: QueryStatus; assigned_to: string | null; last_author: "student" | "ops"; preview: string; last_at: Date;
  }>(
    `WITH x AS (
       SELECT q.id, q.student_id, q.is_test, q.college, q.section, q.category, q.subject, ${EFFECTIVE_STATUS} AS st, s.assigned_to,
              nullif(trim(r.report->>'studentName'), '') AS name,
              coalesce(lm.author, 'student') AS last_author, left(coalesce(lm.body, q.details), 100) AS preview,
              coalesce(lm.created_at, q.created_at) AS last_at
       FROM spi_student_queries q
       LEFT JOIN spi_query_state s ON s.query_id = q.id
       LEFT JOIN spi_report_cache r ON r.student_id = q.student_id
       LEFT JOIN LATERAL (SELECT m.author, m.body, m.created_at FROM spi_query_messages m
                          WHERE m.query_id = q.id AND NOT m.internal ORDER BY m.created_at DESC, m.id DESC LIMIT 1) lm ON true)
     SELECT * FROM x ${conds.length ? `WHERE ${conds.join(" AND ")}` : ""}
     ORDER BY x.last_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  const queries: InboxQuery[] = rows.slice(0, INBOX_PAGE).map((r) => ({
    id: r.id,
    studentId: r.student_id,
    name: r.name,
    college: r.college,
    section: r.section,
    isTest: r.is_test,
    category: r.category,
    subject: r.subject,
    status: r.st,
    assignedTo: r.assigned_to,
    lastAuthor: r.last_author,
    preview: r.preview,
    lastAt: r.last_at.toISOString(),
  }));
  return { queries, hasMore: rows.length > INBOX_PAGE };
}

/** One query's chat for the staff view (internal notes and who replied included), with the student's details. */
export async function getStaffQuery(queryId: number) {
  await ensureTables();
  const { rows: found } = await pool.query<{ student_id: string }>("SELECT student_id FROM spi_student_queries WHERE id = $1", [queryId]);
  const studentId = found[0]?.student_id;
  if (!studentId) return null;
  const [thread, placement, name] = await Promise.all([
    loadThread(studentId, true),
    getCachedPlacement(studentId),
    pool
      .query<{ name: string | null }>("SELECT nullif(trim(report->>'studentName'), '') AS name FROM spi_report_cache WHERE student_id = $1", [studentId])
      .then((r) => r.rows[0]?.name ?? null)
      .catch(() => null),
  ]);
  const query = thread.queries.find((q) => q.id === queryId)!;
  return {
    query,
    student: { studentId, name, college: placement?.college ?? null, semester: placement?.semester ?? null, section: placement?.section ?? null },
    messages: thread.messages.filter((m) => m.queryId === queryId),
    /** How many other queries this student has raised. */
    otherQueries: thread.queries.length - 1,
  };
}

export type ReplyResult = { ok: true; ids: number[] } | { ok: false; status: 400 | 404; error: string };

/**
 * The team's reply to one query, or the same text to several open queries of that student.
 * A public reply moves each query to `status`; an internal note changes nothing.
 */
export async function postStaffReply(input: {
  studentKey: string;
  queryIds: number[];
  body: string;
  internal: boolean;
  status: string;
  adminName: string;
}): Promise<ReplyResult> {
  const body = input.body.trim();
  if (!body) return { ok: false, status: 400, error: "Write a reply" };
  if (body.length > MAX_MESSAGE) return { ok: false, status: 400, error: `Keep the reply within ${MAX_MESSAGE} characters` };
  if (!input.internal && !QUERY_STATUSES.includes(input.status as QueryStatus)) return { ok: false, status: 400, error: "Choose a status" };
  const queryIds = [...new Set(input.queryIds)];
  if (queryIds.length === 0) return { ok: false, status: 400, error: "Choose a query" };
  await ensureTables();
  const { rows: own } = await pool.query<{ id: number }>("SELECT id FROM spi_student_queries WHERE student_id = $1 AND id = ANY($2::int[])", [input.studentKey, queryIds]);
  if (own.length !== queryIds.length) return { ok: false, status: 404, error: "Query not found" };

  const ids: number[] = [];
  for (const queryId of queryIds) {
    const { rows } = await pool.query<{ id: number }>(
      "INSERT INTO spi_query_messages (query_id, author, author_name, body, internal) VALUES ($1, 'ops', $2, $3, $4) RETURNING id",
      [queryId, input.adminName, body, input.internal],
    );
    ids.push(rows[0]!.id);
    if (!input.internal) {
      await pool.query(
        `INSERT INTO spi_query_state (query_id, status, assigned_to, first_reply_at) VALUES ($1, $2, $3, now())
         ON CONFLICT (query_id) DO UPDATE SET status = $2, assigned_to = coalesce(spi_query_state.assigned_to, $3),
           first_reply_at = coalesce(spi_query_state.first_reply_at, now()), updated_at = now()`,
        [queryId, input.status, input.adminName],
      );
    }
  }
  return { ok: true, ids };
}

/** Changes a query's status; resolving also tells the student in the chat. */
export async function setQueryStatus(queryId: number, status: string, adminName: string): Promise<ReplyResult> {
  if (!QUERY_STATUSES.includes(status as QueryStatus)) return { ok: false, status: 400, error: "Choose a status" };
  await ensureTables();
  const { rows } = await pool.query<{ student_id: string }>("SELECT student_id FROM spi_student_queries WHERE id = $1", [queryId]);
  if (!rows[0]) return { ok: false, status: 404, error: "Query not found" };
  if (status === "resolved") {
    return postStaffReply({ studentKey: rows[0].student_id, queryIds: [queryId], body: "This query has been marked as resolved. If something is still wrong, reply here.", internal: false, status, adminName });
  }
  await pool.query(
    `INSERT INTO spi_query_state (query_id, status, assigned_to) VALUES ($1, $2, $3)
     ON CONFLICT (query_id) DO UPDATE SET status = $2, assigned_to = coalesce(spi_query_state.assigned_to, $3), updated_at = now()`,
    [queryId, status, adminName],
  );
  return { ok: true, ids: [] };
}

/** Counts for the menu badge (needs a reply) and the bell (events since the admin last looked). */
export async function getStaffSummary(adminSub: string) {
  await ensureTables();
  const { rows } = await pool.query<{ needs: string; unread: string }>(
    `WITH seen AS (SELECT coalesce((SELECT seen_at FROM spi_query_ops_seen WHERE admin_sub = $1), now() - interval '7 days') AS at)
     SELECT
       (SELECT count(*) FROM spi_student_queries q LEFT JOIN spi_query_state s ON s.query_id = q.id WHERE ${EFFECTIVE_STATUS} = 'received') AS needs,
       (SELECT count(*) FROM spi_student_queries q, seen WHERE q.created_at > seen.at)
       + (SELECT count(*) FROM spi_query_messages m, seen WHERE m.author = 'student' AND m.created_at > seen.at) AS unread`,
    [adminSub],
  );
  return { needsReply: Number(rows[0]?.needs ?? 0), unread: Number(rows[0]?.unread ?? 0) };
}

export interface BellItem {
  kind: "new_query" | "student_reply";
  studentId: string;
  name: string | null;
  queryId: number;
  category: string;
  subject: string;
  preview: string;
  at: string;
}

/** The latest new queries and student replies, newest first; `unread` ones are those after the admin's last look. */
export async function getStaffBell(adminSub: string) {
  await ensureTables();
  await getCachedPlacement("-");
  const [{ rows: seenRows }, { rows }] = await Promise.all([
    pool.query<{ seen_at: Date }>("SELECT seen_at FROM spi_query_ops_seen WHERE admin_sub = $1", [adminSub]),
    pool.query<{ kind: BellItem["kind"]; student_id: string; name: string | null; query_id: number; category: string; subject: string; preview: string; at: Date }>(
      `SELECT * FROM (
         SELECT 'new_query' AS kind, q.student_id, r.report->>'studentName' AS name, q.id AS query_id, q.category, q.subject, left(q.details, 120) AS preview, q.created_at AS at
         FROM spi_student_queries q LEFT JOIN spi_report_cache r ON r.student_id = q.student_id
         UNION ALL
         SELECT 'student_reply', q.student_id, r.report->>'studentName', q.id, q.category, q.subject, left(m.body, 120), m.created_at
         FROM spi_query_messages m JOIN spi_student_queries q ON q.id = m.query_id LEFT JOIN spi_report_cache r ON r.student_id = q.student_id
         WHERE m.author = 'student'
       ) e ORDER BY at DESC LIMIT 12`,
    ),
  ]);
  const seenAt = seenRows[0]?.seen_at ?? new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const items = rows.map((r) => ({
    kind: r.kind, studentId: r.student_id, name: r.name, queryId: r.query_id, category: r.category, subject: r.subject, preview: r.preview, at: r.at.toISOString(),
    unread: r.at > seenAt,
  }));
  return { items };
}

export async function markStaffSeen(adminSub: string): Promise<void> {
  await ensureTables();
  await pool.query(
    "INSERT INTO spi_query_ops_seen (admin_sub, seen_at) VALUES ($1, now()) ON CONFLICT (admin_sub) DO UPDATE SET seen_at = now()",
    [adminSub],
  );
}
