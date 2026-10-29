import { Router } from "express";
import { allLimits, perNetworkLimit, perStudentLimit } from "../lib/rateLimits.js";
import { getSessionFromRequest } from "../lib/auth.js";
import { validateStudentId } from "../lib/bigquery.js";
import { saveStudentQuery } from "../lib/studentQueries.js";

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

export default router;
