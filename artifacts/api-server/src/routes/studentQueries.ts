import { Router } from "express";
import { allLimits, perNetworkLimit, perStudentLimit } from "../lib/rateLimits.js";
import { getSessionFromRequest } from "../lib/auth.js";
import { validateStudentId } from "../lib/bigquery.js";
import { saveStudentQuery } from "../lib/studentQueries.js";
import { getStudentThread, getStudentUnread, markStudentRead, postStudentMessage } from "../lib/queryChat.js";
import { studentKey } from "../lib/testStudents.js";

const router = Router();

// A student raises a few queries at most; 10 a minute per student per network, 3,000 per network.
const queryLimiter = allLimits(
  perNetworkLimit(3000),
  perStudentLimit(10, (req) => (req.body as { student?: unknown } | undefined)?.student),
);

/**
 * POST /api/spi-queries { student, category, subCategory, subject, details }: "Raise a query" on the public
 * report (/spi/{student_uid}). A staff session previews the report and saves nothing.
 */
router.post("/", queryLimiter, async (req, res): Promise<void> => {
  res.set("Cache-Control", "no-store");
  const body = (req.body ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  if (getSessionFromRequest(req)) {
    res.json({ saved: false, preview: true });
    return;
  }
  const student = str(body["student"]).trim();
  if (!validateStudentId.test(student)) {
    res.status(400).json({ error: "Student required" });
    return;
  }
  try {
    const result = await saveStudentQuery({
      studentId: student,
      category: str(body["category"]),
      subCategory: str(body["subCategory"]),
      subject: str(body["subject"]),
      details: str(body["details"]),
    });
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.status(201).json({ saved: true, id: result.id });
  } catch (err) {
    req.log.error({ err }, "Saving a student query failed");
    res.status(500).json({ error: "Could not submit your query. Please try again." });
  }
});

// Polling for replies: a student's open report asks about once a minute.
const threadLimiter = allLimits(
  perNetworkLimit(6000),
  perStudentLimit(20, (req) => (req.method === "GET" ? req.query["student"] : (req.body as { student?: unknown } | undefined)?.student)),
);

/**
 * GET /api/spi-queries/thread?student=: the student's conversation with the SPI team (their queries, the
 * team's replies, never internal notes or staff names). `?count=1` returns only the unread count.
 */
router.get("/thread", threadLimiter, async (req, res): Promise<void> => {
  res.set("Cache-Control", "no-store");
  const student = typeof req.query["student"] === "string" ? req.query["student"].trim() : "";
  if (!validateStudentId.test(student)) {
    res.status(400).json({ error: "Student required" });
    return;
  }
  try {
    const key = studentKey(student);
    if (req.query["count"] === "1") {
      res.json({ unread: await getStudentUnread(key) });
      return;
    }
    res.json(await getStudentThread(key));
  } catch (err) {
    req.log.error({ err }, "Reading a student's query thread failed");
    res.status(500).json({ error: "Could not load your queries. Please try again." });
  }
});

/** POST /api/spi-queries/read { student }: the student opened the chat, so the team's replies count as read. */
router.post("/read", threadLimiter, async (req, res): Promise<void> => {
  res.set("Cache-Control", "no-store");
  const student = String((req.body as { student?: unknown } | undefined)?.student ?? "").trim();
  if (!validateStudentId.test(student)) {
    res.status(400).json({ error: "Student required" });
    return;
  }
  if (getSessionFromRequest(req)) {
    res.json({ ok: true, preview: true });
    return;
  }
  try {
    await markStudentRead(studentKey(student));
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Marking a student's replies read failed");
    res.status(500).json({ error: "Could not update. Please try again." });
  }
});

/** POST /api/spi-queries/:id/messages { student, body }: the student replies on one of their own queries. */
router.post("/:id/messages", queryLimiter, async (req, res): Promise<void> => {
  res.set("Cache-Control", "no-store");
  const body = (req.body ?? {}) as Record<string, unknown>;
  const queryId = Number(req.params["id"]);
  const student = typeof body["student"] === "string" ? body["student"].trim() : "";
  if (!Number.isInteger(queryId) || !validateStudentId.test(student)) {
    res.status(400).json({ error: "Student required" });
    return;
  }
  if (getSessionFromRequest(req)) {
    res.json({ saved: false, preview: true });
    return;
  }
  try {
    const result = await postStudentMessage(studentKey(student), queryId, typeof body["body"] === "string" ? body["body"] : "");
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.status(201).json({ saved: true, id: result.id });
  } catch (err) {
    req.log.error({ err }, "Saving a student's reply failed");
    res.status(500).json({ error: "Could not send your message. Please try again." });
  }
});

export default router;
