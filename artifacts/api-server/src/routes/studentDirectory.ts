import { Router, type Request, type Response } from "express";
import { requireSession } from "../lib/auth.js";
import { scopeForSession, type Role } from "../lib/rbac.js";
import { pageOf, readPageRequest } from "../lib/pagination.js";
import { spiSharePath } from "../lib/spiToken.js";
import { directorySnapshot } from "../lib/directoryReport.js";
import { directoryOptions, directoryRows, sortRows, summarize, type DirectoryFilter, type ReportTier } from "../lib/directoryReportModel.js";
import { overviewOf } from "../lib/overviewReportModel.js";

/**
 * Student Directory: one row per student from the saved student reports (lib/directoryReport.ts), so the
 * numbers match the report. Filters: college, semester, section, subject, attendance %, name / UUID search,
 * always limited to the user's own campuses and subjects. The server filters, sorts and pages.
 */
const router = Router();
router.use(requireSession());

const bound = (v: unknown, fallback: number): number => {
  const n = Number(v);
  return v === undefined || v === "" || !Number.isFinite(n) ? fallback : Math.max(0, Math.min(100, n));
};

/** Reads the filters; sends the error response itself and returns null when the request is not allowed. */
function readFilter(req: Request, res: Response): DirectoryFilter | null {
  const session = req.session!;
  const q = req.query as Record<string, string | undefined>;
  const scope = scopeForSession({ role: session.role as Role, campuses: session.campuses, subjects: session.subjects });
  const filter: DirectoryFilter = {
    scopeCampuses: scope.campuses,
    scopeSubjects: scope.subjects,
    college: q["college"],
    semester: q["semester"],
    section: q["section"],
    subject: q["subject"],
    tier: (["eligible", "recovery_eligible", "at_risk", "ineligible"] as const).find((t) => t === q["tier"]) as ReportTier | undefined,
    attMin: bound(q["attMin"], 0),
    attMax: bound(q["attMax"], 100),
    q: String(q["q"] ?? "").slice(0, 100),
  };
  if (filter.college && scope.campuses?.length && !scope.campuses.includes(filter.college.trim())) {
    res.status(403).json({ error: "Not permitted for this campus" });
    return null;
  }
  return filter;
}

const fail = (req: Request, res: Response, err: unknown) => {
  req.log.error({ err }, "Error fetching the student directory");
  res.status(500).json({ error: "Failed to load students" });
};

router.get("/options", async (req, res): Promise<void> => {
  const filter = readFilter(req, res);
  if (!filter) return;
  try {
    res.json(directoryOptions(await directorySnapshot.get(), filter));
  } catch (err) {
    fail(req, res, err);
  }
});

/** Overview: the same report numbers as the directory, rolled up for the cards and charts. */
router.get("/overview", async (req, res): Promise<void> => {
  const filter = readFilter(req, res);
  if (!filter) return;
  try {
    res.json(overviewOf(await directorySnapshot.get(), filter));
  } catch (err) {
    fail(req, res, err);
  }
});

router.get("/", async (req, res): Promise<void> => {
  const filter = readFilter(req, res);
  if (!filter) return;
  try {
    const rows = directoryRows(await directorySnapshot.get(), filter);
    const sorted = sortRows(rows, String(req.query["sort"] ?? "college"), req.query["dir"] === "desc" ? -1 : 1);
    const page = pageOf(sorted, readPageRequest(req.query as Record<string, unknown>));
    res.json({ ...page, rows: page.rows.map((r) => ({ ...r, reportPath: spiSharePath(r.studentId) })), summary: summarize(rows) });
  } catch (err) {
    fail(req, res, err);
  }
});

const csv = (v: string | number | null) => {
  if (v == null) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Every row for the current filters as CSV. */
router.get("/export", async (req, res): Promise<void> => {
  const filter = readFilter(req, res);
  if (!filter) return;
  try {
    const rows = sortRows(directoryRows(await directorySnapshot.get(), filter), String(req.query["sort"] ?? "college"), req.query["dir"] === "desc" ? -1 : 1);
    const header = ["College", "Student name", "UUID", "Semester", "Section", "Attendance %", "Classroom Quiz avg %", "Module Quiz avg %", "Skill Assessment avg %", "Expected SPI", "Eligible", "Skill debt"];
    const lines = rows.map((r) => [r.college, r.name, r.studentId, r.semester, r.section, r.attendancePct, r.classroom, r.module, r.skill, r.spi, r.eligible ? "Yes" : "No", r.skillDebt ? "Yes" : "No"].map(csv).join(","));
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="student-directory.csv"');
    res.send(`﻿${[header.join(","), ...lines].join("\r\n")}`);
  } catch (err) {
    fail(req, res, err);
  }
});

export default router;
