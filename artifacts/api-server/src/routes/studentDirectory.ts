import { Router, type Request, type Response } from "express";
import { requireSession } from "../lib/auth.js";
import { scopeForSession, type Role } from "../lib/rbac.js";
import { pageOf, readPageRequest } from "../lib/pagination.js";
import { spiSharePath } from "../lib/spiToken.js";
import { directorySnapshot } from "../lib/directoryReport.js";
import { directoryOptions, directoryRows, sortRows, summarize, type DirectoryFilter, type ReportTier } from "../lib/directoryReportModel.js";
import { overviewOf } from "../lib/overviewReportModel.js";
import { overviewTrendSnapshot } from "../lib/overviewTrend.js";
import { trendOf } from "../lib/overviewTrendModel.js";
import { cacheGet, cacheSet } from "../lib/cache.js";
import { pastPlacesSnapshot } from "../lib/pastSemesters.js";
import { pastSemesterOptions, readTerm } from "../lib/pastSemesterModel.js";
import { searchSpi, sortSpi, SPI_GRAINS, SPI_TARGET, SPI_UP_TO, spiGroups, spiStudents, spiSummary, type SpiFilter, type SpiGrain, type SpiStudentRow, type SpiUpTo } from "../lib/spiInterimModel.js";

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
  const raw = req.query as Record<string, string | string[] | undefined>;
  const one = (key: string) => { const v = raw[key]; return Array.isArray(v) ? v[0] : v; };
  /** Repeated params (college=A&college=B); a name may hold a comma, so no comma splitting. */
  const many = (key: string) => { const v = raw[key]; return [...new Set((Array.isArray(v) ? v : v ? [v] : []).map((x) => x.trim()).filter(Boolean))]; };
  const q: Record<string, string | undefined> = { semester: one("semester"), section: one("section"), subject: one("subject"), tier: one("tier"), attMin: one("attMin"), attMax: one("attMax"), q: one("q") };
  const term = one("term");
  const scope = scopeForSession({ role: session.role as Role, campuses: session.campuses, subjects: session.subjects });
  // Overview sends one college as college=…; the directory may send several.
  const colleges = many("college");
  const filter: DirectoryFilter = {
    scopeCampuses: scope.campuses,
    scopeSubjects: scope.subjects,
    colleges,
    batches: many("batch").filter((v) => v.includes("\t")),
    term: readTerm(term),
    semester: q["semester"],
    section: q["section"],
    sections: many("sections"),
    subject: q["subject"],
    tier: (["eligible", "recovery_eligible", "at_risk", "ineligible"] as const).find((t) => t === q["tier"]) as ReportTier | undefined,
    attMin: bound(q["attMin"], 0),
    attMax: bound(q["attMax"], 100),
    q: String(q["q"] ?? "").slice(0, 100),
  };
  if (scope.campuses?.length && colleges.some((c) => !scope.campuses!.includes(c))) {
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
    const [students, places] = await Promise.all([directorySnapshot.get(), pastPlacesSnapshot.get()]);
    // The Semester menu's ended choices (per college; the page keeps those of the colleges picked).
    res.json({ ...directoryOptions(students, filter), pastSemesters: pastSemesterOptions(places, filter.scopeCampuses) });
  } catch (err) {
    fail(req, res, err);
  }
});

/** Overview: the same report numbers as the directory, rolled up for the cards and charts. */
router.get("/overview", async (req, res): Promise<void> => {
  const filter = readFilter(req, res);
  if (!filter) return;
  try {
    const students = await directorySnapshot.get();
    // Kept per copy of the saved reports and per filter (the user's scope is part of the filter).
    const key = `overview:v3:${directorySnapshot.version()}:${JSON.stringify(filter)}`;
    let body = cacheGet<object>(key);
    if (!body) {
      body = overviewOf(students, filter);
      cacheSet(key, body, 10 * 60 * 1000);
    }
    res.json(body);
  } catch (err) {
    fail(req, res, err);
  }
});

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Overview: weekly attendance for the same filters, from day-level rows held in memory (lib/overviewTrend.ts). */
router.get("/overview/trend", async (req, res): Promise<void> => {
  const filter = readFilter(req, res);
  if (!filter) return;
  const from = String(req.query["dateFrom"] ?? "");
  const to = String(req.query["dateTo"] ?? "");
  const window = DAY.test(from) && DAY.test(to) && from <= to ? { dateFrom: from, dateTo: to } : {};
  try {
    const rows = await overviewTrendSnapshot.get();
    const key = `overview-trend:v2:${overviewTrendSnapshot.version()}:${JSON.stringify(filter)}:${window.dateFrom ?? ""}:${window.dateTo ?? ""}`;
    let body = cacheGet<object>(key);
    if (!body) {
      body = { points: trendOf(rows, { ...filter, ...window }) };
      cacheSet(key, body, 10 * 60 * 1000);
    }
    res.json(body);
  } catch (err) {
    req.log.error({ err }, "Error fetching the overview trend");
    res.status(500).json({ error: "Failed to load the attendance trend" });
  }
});

router.get("/", async (req, res): Promise<void> => {
  const filter = readFilter(req, res);
  if (!filter) return;
  try {
    const rows = directoryRows(await directorySnapshot.get(), filter);
    const sorted = sortRows(rows, String(req.query["sort"] ?? "college"), req.query["dir"] === "desc" ? -1 : 1);
    const page = pageOf(sorted, readPageRequest(req.query as Record<string, unknown>));
    res.json({ ...page, rows: page.rows.map(({ parts: _parts, ...r }) => ({ ...r, reportPath: filter.term ? `${spiSharePath(r.studentId)}?${new URLSearchParams({ semester: filter.term })}` : spiSharePath(r.studentId) })), summary: summarize(rows) });
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
    const header = ["College", "Batch", "Student name", "UUID", "Semester", "Semester status", "Section", "Attendance %", "Classroom Quiz avg %", "Module Quiz avg %", "Skill Assessment avg %", "Expected SPI", "Eligible", "Skill debt"];
    const lines = rows.map((r) => [r.college, r.batch, r.name, r.studentId, r.semester, r.ended ? "Ended" : "Running", r.section, r.attendancePct, r.classroom, r.module, r.skill, r.spi, r.eligible ? "Yes" : "No", r.skillDebt ? "Yes" : "No"].map(csv).join(","));
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="student-directory.csv"');
    res.send(`﻿${[header.join(","), ...lines].join("\r\n")}`);
  } catch (err) {
    fail(req, res, err);
  }
});

/** SPI Record Dashboard: the filters above plus "SPI up to", the interim score bounds, the view, search and sort. */
function readSpiRequest(req: Request, res: Response) {
  const filter = readFilter(req, res);
  if (!filter) return null;
  const q = req.query as Record<string, string | undefined>;
  const upTo = (SPI_UP_TO as string[]).includes(String(q["upTo"])) ? (q["upTo"] as SpiUpTo) : "cqmqsa";
  const grain = (SPI_GRAINS as string[]).includes(String(q["group"])) ? (q["group"] as SpiGrain) : "college";
  const spiFilter: SpiFilter = { ...filter, q: "", upTo, scoreMin: bound(q["scoreMin"], 0), scoreMax: bound(q["scoreMax"], 100) };
  return { spiFilter, grain, search: String(q["q"] ?? "").slice(0, 100), sort: String(q["sort"] ?? ""), dir: (q["dir"] === "desc" ? -1 : 1) as 1 | -1 };
}

/** The view's rows (after search and sort), the cards for the filters, and the total rows. */
async function spiView(r: NonNullable<ReturnType<typeof readSpiRequest>>) {
  const students = await directorySnapshot.get();
  const key = `spi-record:v1:${directorySnapshot.version()}:${JSON.stringify(r.spiFilter)}`;
  let base = cacheGet<{ rows: SpiStudentRow[]; all: SpiStudentRow[] }>(key);
  if (!base) {
    const rows = spiStudents(students, r.spiFilter);
    const bounded = (r.spiFilter.scoreMin ?? 0) > 0 || (r.spiFilter.scoreMax ?? 100) < 100;
    base = { rows, all: bounded ? spiStudents(students, { ...r.spiFilter, scoreMin: 0, scoreMax: 100 }) : rows };
    cacheSet(key, base, 10 * 60 * 1000);
  }
  const summary = spiSummary(base.rows, base.all);
  if (r.grain === "student") {
    const rows = sortSpi(searchSpi(base.rows, r.search), r.sort || "score", r.sort ? r.dir : -1, true);
    return { summary, student: rows, groups: null };
  }
  const groups = sortSpi(searchSpi(spiGroups(base.rows, r.grain), r.search), r.sort || "college", r.sort ? r.dir : 1, false);
  return { summary, student: null, groups };
}

router.get("/spi-record", async (req, res): Promise<void> => {
  const r = readSpiRequest(req, res);
  if (!r) return;
  try {
    const view = await spiView(r);
    const list = view.student ?? view.groups ?? [];
    const page = pageOf(list as object[], readPageRequest(req.query as Record<string, unknown>));
    const rows = view.student
      ? (page.rows as SpiStudentRow[]).map(({ parts: _parts, ...row }) => ({ ...row, reportPath: r.spiFilter.term ? `${spiSharePath(row.studentId)}?${new URLSearchParams({ semester: r.spiFilter.term })}` : spiSharePath(row.studentId) }))
      : page.rows;
    res.json({ ...page, rows, grain: r.grain, summary: view.summary });
  } catch (err) {
    fail(req, res, err);
  }
});

/** Every row of the view as CSV. */
router.get("/spi-record/export", async (req, res): Promise<void> => {
  const r = readSpiRequest(req, res);
  if (!r) return;
  try {
    const view = await spiView(r);
    const label = { cq: "CQ", cqmq: "CQ + MQ", cqmqsa: "CQ + MQ + SA", all: "All (with FSA)" }[r.spiFilter.upTo ?? "cqmqsa"];
    const pct = (v: number | null) => (v == null ? "" : v);
    let header: string[];
    let lines: (string | number | null)[][];
    if (view.student) {
      header = ["Student name", "UUID", "College", "Batch", "Semester", "Section", "CQ avg %", "MQ avg %", "SA avg %", `Interim score % (${label})`, "Interim SPI (out of 10)", "Interim SPI %", "Level", "Semester status"];
      lines = view.student.map((s) => [s.name, s.studentId, s.college, s.batch, s.semester, s.section, pct(s.classroom), pct(s.module), pct(s.skill), pct(s.score), pct(s.spi), s.spi == null ? "" : Math.round(s.spi * 100) / 10, s.level, s.ended ? "Ended" : "Running"]);
    } else {
      header = ["College", ...(r.grain !== "college" ? ["Batch", "Semester"] : []), ...(r.grain === "section" ? ["Section"] : []), "Students", "CQ avg %", "MQ avg %", "SA avg %", `Interim score % (${label})`, "Interim SPI (out of 10)", "Interim SPI %", `Students ≥ ${SPI_TARGET}%`, `Students ≥ ${SPI_TARGET}% (share)`];
      lines = view.groups!.map((g) => [g.college, ...(r.grain !== "college" ? [g.batch, g.semester] : []), ...(r.grain === "section" ? [g.section] : []), g.students, pct(g.classroom), pct(g.module), pct(g.skill), pct(g.score), pct(g.spi), g.spi == null ? "" : Math.round(g.spi * 100) / 10, g.atTarget, pct(g.atTargetPct)]);
    }
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="spi-record-${r.grain}.csv"`);
    res.send(`﻿${[header.map(csv).join(","), ...lines.map((l) => l.map(csv).join(","))].join("\r\n")}`);
  } catch (err) {
    fail(req, res, err);
  }
});

export default router;
