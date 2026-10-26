import { timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { runReportSync } from "../lib/spiReportSync.js";

/**
 * Jobs called by an outside scheduler (cron-job.org, hourly). The published app runs on Autoscale,
 * which gives CPU only while a request is open, so the sync runs inside this request (~30 s) and
 * answers when it is done. Needs the SYNC_TOKEN secret: header `Authorization: Bearer <SYNC_TOKEN>`.
 */
const router = Router();

function tokenOk(header: string | undefined): boolean {
  const expected = process.env["SYNC_TOKEN"]?.trim();
  const given = header?.replace(/^Bearer\s+/i, "").trim();
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

router.post("/spi-report-sync", async (req, res): Promise<void> => {
  res.set("Cache-Control", "no-store");
  if (!process.env["SYNC_TOKEN"]?.trim()) {
    res.status(503).json({ error: "SYNC_TOKEN not set" });
    return;
  }
  if (!tokenOk(req.headers.authorization)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const started = Date.now();
  const result = await runReportSync("schedule");
  res.status(result.status === "failed" ? 500 : 200).json({ ...result, seconds: Math.round((Date.now() - started) / 1000) });
});

export default router;
