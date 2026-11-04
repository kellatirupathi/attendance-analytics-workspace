import express, { Router } from "express";
import { allLimits, perNetworkLimit, perStudentLimit } from "../lib/rateLimits.js";
import { getSessionFromRequest } from "../lib/auth.js";
import { validateStudentId } from "../lib/bigquery.js";
import { getStudentThread, getStudentUnread, markStudentRead, postStudentMessage, submitQuery } from "../lib/queryChat.js";
import { MAX_IMAGE_BYTES, findAttachment, saveUpload, sendAttachment } from "../lib/queryAttachments.js";
import { studentKey } from "../lib/testStudents.js";

const router = Router();

// A student raises a few queries at most; 10 a minute per student per network, 3,000 per network.
const queryLimiter = allLimits(
  perNetworkLimit(3000),
  perStudentLimit(10, (req) => (req.body as { student?: unknown } | undefined)?.student),
);

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/**
 * POST /api/spi-queries { student, category, subCategory, subjects[], details, attachments[] }: "Raise a query" on the
 * public report (/spi/{student_uid}). `attachments` are tokens from POST /attachments. A category that already has an
 * open chat gets the new subjects and message added to it (`added: true`). A staff session previews and saves nothing.
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
    const result = await submitQuery({
      studentId: student,
      category: str(body["category"]),
      subCategory: str(body["subCategory"]),
      // An older client sends one `subject`.
      subjects: Array.isArray(body["subjects"]) ? strings(body["subjects"]) : [str(body["subject"])],
      details: str(body["details"]),
      attachments: strings(body["attachments"]),
    });
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.status(201).json({ saved: true, id: result.id, added: result.added });
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

/** POST /api/spi-queries/read { student, queryId? }: the student opened a query's chat, so its replies count as read. */
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
  const queryId = Number((req.body as { queryId?: unknown } | undefined)?.queryId);
  try {
    await markStudentRead(studentKey(student), Number.isInteger(queryId) ? queryId : undefined);
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Marking a student's replies read failed");
    res.status(500).json({ error: "Could not update. Please try again." });
  }
});

// Screenshots: a few per message, so 12 a minute per student per network.
const uploadLimiter = allLimits(perNetworkLimit(3000), perStudentLimit(12, (req) => req.query["student"]));

/**
 * POST /api/spi-queries/attachments?student= with the image as the request body (image/png, image/jpeg or image/webp,
 * up to 2 MB, already shrunk by the browser): checks it, keeps it in R2 and returns { token } to send with the message.
 */
router.post(
  "/attachments",
  uploadLimiter,
  express.raw({ type: ["image/png", "image/jpeg", "image/webp"], limit: MAX_IMAGE_BYTES }),
  async (req, res): Promise<void> => {
    res.set("Cache-Control", "no-store");
    const student = typeof req.query["student"] === "string" ? req.query["student"].trim() : "";
    if (!validateStudentId.test(student)) {
      res.status(400).json({ error: "Student required" });
      return;
    }
    if (getSessionFromRequest(req)) {
      res.json({ token: "preview", preview: true });
      return;
    }
    try {
      const result = await saveUpload(studentKey(student), req.body, req.header("x-file-name"));
      if (!result.ok) {
        res.status(result.status).json({ error: result.error });
        return;
      }
      res.status(201).json({ token: result.token });
    } catch (err) {
      req.log.error({ err }, "Saving a query screenshot failed");
      res.status(500).json({ error: "Could not add the screenshot. Please try again." });
    }
  },
);

/** GET /api/spi-queries/attachments/:token?student=: a screenshot, only for the student whose chat it is in. */
router.get("/attachments/:token", threadLimiter, async (req, res): Promise<void> => {
  const student = typeof req.query["student"] === "string" ? req.query["student"].trim() : "";
  try {
    const att = validateStudentId.test(student) ? await findAttachment(String(req.params["token"])) : null;
    if (!att || att.studentId !== studentKey(student)) {
      res.status(404).json({ error: "Image not found" });
      return;
    }
    await sendAttachment(res, att);
  } catch (err) {
    req.log.error({ err }, "Reading a query screenshot failed");
    res.status(500).json({ error: "Could not load the image." });
  }
});

/** POST /api/spi-queries/:id/messages { student, body, attachments[] }: the student replies on one of their own chats. */
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
    const result = await postStudentMessage(studentKey(student), queryId, typeof body["body"] === "string" ? body["body"] : "", strings(body["attachments"]));
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
