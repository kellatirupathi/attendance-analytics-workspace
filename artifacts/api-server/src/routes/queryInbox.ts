import { Router } from "express";
import { requireSession } from "../lib/auth.js";
import { validateStudentId } from "../lib/bigquery.js";
import { studentKey } from "../lib/testStudents.js";
import { findAttachment, sendAttachment } from "../lib/queryAttachments.js";
import {
  getStaffBell,
  getStaffQuery,
  getStaffSummary,
  listStaffQueries,
  markStaffSeen,
  postStaffReply,
  setQueryStatus,
} from "../lib/queryChat.js";

/**
 * The SPI team's side of the query chat. Admin and Super Admin only (requireSession manage = canManage in
 * lib/rbac.ts); every other role gets 403 from the middleware, so no handler below checks the role again.
 */
const router = Router();
router.use(requireSession({ manage: true }));
router.use((_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

const fail = (res: import("express").Response, req: import("express").Request, err: unknown, what: string) => {
  req.log.error({ err }, what);
  res.status(500).json({ error: "Something went wrong. Please try again." });
};

/** GET /api/query-inbox/summary: { needsReply, unread } for the menu badge and the bell. */
router.get("/summary", async (req, res): Promise<void> => {
  try {
    res.json(await getStaffSummary(req.session!.sub));
  } catch (err) {
    fail(res, req, err, "Reading the query summary failed");
  }
});

/** GET /api/query-inbox/queries?status=&category=&q=&page=0: one row per chat (status and category default to all). */
router.get("/queries", async (req, res): Promise<void> => {
  const page = Math.max(0, Math.floor(Number(req.query["page"]) || 0));
  const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
  try {
    res.json(await listStaffQueries({ status: text(req.query["status"], 30), category: text(req.query["category"], 40), search: text(req.query["q"], 80), page }));
  } catch (err) {
    fail(res, req, err, "Reading the query inbox failed");
  }
});

/** GET /api/query-inbox/attachments/:token: a screenshot (Admin / Super Admin only, like the rest of this router). */
router.get("/attachments/:token", async (req, res): Promise<void> => {
  try {
    const att = await findAttachment(String(req.params["token"]));
    if (!att) {
      res.status(404).json({ error: "Image not found" });
      return;
    }
    await sendAttachment(res, att);
  } catch (err) {
    fail(res, req, err, "Reading a query screenshot failed");
  }
});

/** GET /api/query-inbox/queries/:id: one query's chat, internal notes included, with the student's details. */
router.get("/queries/:id", async (req, res): Promise<void> => {
  const queryId = Number(req.params["id"]);
  if (!Number.isInteger(queryId)) {
    res.status(400).json({ error: "Query required" });
    return;
  }
  try {
    const found = await getStaffQuery(queryId);
    if (!found) {
      res.status(404).json({ error: "Query not found" });
      return;
    }
    res.json(found);
  } catch (err) {
    fail(res, req, err, "Reading a query failed");
  }
});

/**
 * POST /api/query-inbox/reply { studentId, queryIds, body, internal?, status? }: one reply, sent into each
 * listed query of that student (usually one; several when the team answers them together).
 */
router.post("/reply", async (req, res): Promise<void> => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  const studentId = typeof b["studentId"] === "string" ? b["studentId"].trim() : "";
  const queryIds = Array.isArray(b["queryIds"]) ? b["queryIds"].map(Number).filter((n) => Number.isInteger(n)) : [];
  if (!validateStudentId.test(studentId)) {
    res.status(400).json({ error: "Student required" });
    return;
  }
  try {
    const result = await postStaffReply({
      studentKey: studentKey(studentId),
      queryIds,
      body: typeof b["body"] === "string" ? b["body"] : "",
      internal: b["internal"] === true,
      status: typeof b["status"] === "string" ? b["status"] : "in_progress",
      adminName: req.session!.name,
    });
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.status(201).json({ saved: true, ids: result.ids });
  } catch (err) {
    fail(res, req, err, "Saving a staff reply failed");
  }
});

/** POST /api/query-inbox/queries/:id/status { status } */
router.post("/queries/:id/status", async (req, res): Promise<void> => {
  const queryId = Number(req.params["id"]);
  if (!Number.isInteger(queryId)) {
    res.status(400).json({ error: "Query required" });
    return;
  }
  try {
    const status = String((req.body as { status?: unknown } | undefined)?.status ?? "");
    const result = await setQueryStatus(queryId, status, req.session!.name);
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.json({ saved: true });
  } catch (err) {
    fail(res, req, err, "Changing a query status failed");
  }
});

/** GET /api/query-inbox/bell: the latest new queries and student replies. POST /bell/seen clears the badge. */
router.get("/bell", async (req, res): Promise<void> => {
  try {
    res.json(await getStaffBell(req.session!.sub));
  } catch (err) {
    fail(res, req, err, "Reading the query bell failed");
  }
});
router.post("/bell/seen", async (req, res): Promise<void> => {
  try {
    await markStaffSeen(req.session!.sub);
    res.json({ ok: true });
  } catch (err) {
    fail(res, req, err, "Marking the query bell seen failed");
  }
});

export default router;
