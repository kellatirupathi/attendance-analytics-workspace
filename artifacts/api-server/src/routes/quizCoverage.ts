import { Router, type Request, type Response } from "express";
import ExcelJS from "exceljs";
import { requireSession } from "../lib/auth.js";
import { scopeForSession, type Role } from "../lib/rbac.js";
import { pageOf, readPageRequest } from "../lib/pagination.js";
import { QUIZ_TYPES, type QuizType } from "../lib/quizCoverageSql.js";
import { quizCoverageSnapshot } from "../lib/quizCoverage.js";
import {
  CAMPUS_SORT,
  STUDENT_SORT,
  campusRows,
  quizFilterOptions,
  quizKpis,
  sortBy,
  studentRows,
  studentSubjectRows,
  todayIst,
  type QuizCoverageModel,
  type QuizFilter,
} from "../lib/quizCoverageModel.js";

/**
 * Assessments → Classroom Quiz tab (Module Quiz reuses it with quizType=MODULE_QUIZ).
 * All endpoints read the shared snapshot (lib/quizCoverage.ts) and filter it in memory.
 * Filters: college, section, category, subject (each blank = all), always limited to the
 * user's own campuses and subjects.
 */
const router = Router();
router.use(requireSession());

const LABEL: Record<QuizType, string> = { CLASSROOM_QUIZ: "ClassroomQuiz", MODULE_QUIZ: "ModuleQuiz" };

interface QuizRequest {
  type: QuizType;
  filter: QuizFilter;
}

/** Reads quizType and the filters; sends the error response itself and returns null when the request is not allowed. */
function readRequest(req: Request, res: Response): QuizRequest | null {
  const session = req.session!;
  const q = req.query as Record<string, string | undefined>;
  const type = (q["quizType"] ?? "CLASSROOM_QUIZ") as QuizType;
  if (!QUIZ_TYPES.includes(type)) {
    res.status(400).json({ error: "Invalid quizType" });
    return null;
  }
  const scope = scopeForSession({ role: session.role as Role, campuses: session.campuses, subjects: session.subjects });
  const filter: QuizFilter = {
    scopeCampuses: scope.campuses,
    scopeSubjects: scope.subjects,
    college: q["college"],
    section: q["section"],
    category: q["category"],
    subject: q["subject"],
  };
  if (filter.college && scope.campuses?.length && !scope.campuses.includes(filter.college.trim())) {
    res.status(403).json({ error: "Not permitted for this campus" });
    return null;
  }
  return { type, filter };
}

const fail = (req: Request, res: Response, err: unknown, what: string) => {
  req.log.error({ err }, `Error fetching ${what}`);
  res.status(500).json({ error: `Failed to fetch ${what}` });
};

router.get("/options", async (req, res): Promise<void> => {
  const r = readRequest(req, res);
  if (!r) return;
  try {
    const model = await quizCoverageSnapshot(r.type).get();
    res.json(quizFilterOptions(model, r.filter));
  } catch (err) {
    fail(req, res, err, "quiz filter options");
  }
});

router.get("/kpis", async (req, res): Promise<void> => {
  const r = readRequest(req, res);
  if (!r) return;
  try {
    const model = await quizCoverageSnapshot(r.type).get();
    res.json({ ...quizKpis(model, r.filter), asOf: todayIst() });
  } catch (err) {
    fail(req, res, err, "quiz KPIs");
  }
});

router.get("/campus", async (req, res): Promise<void> => {
  const r = readRequest(req, res);
  if (!r) return;
  try {
    const model = await quizCoverageSnapshot(r.type).get();
    const key = String(req.query["sort"] ?? "college");
    const get = CAMPUS_SORT[key] ?? CAMPUS_SORT["college"]!;
    const rows = sortBy(campusRows(model, r.filter), get, req.query["dir"] === "desc" ? -1 : 1, (row) => row.college);
    res.json(pageOf(rows, readPageRequest(req.query as Record<string, unknown>)));
  } catch (err) {
    fail(req, res, err, "quiz campus rows");
  }
});

router.get("/students", async (req, res): Promise<void> => {
  const r = readRequest(req, res);
  if (!r) return;
  try {
    const model = await quizCoverageSnapshot(r.type).get();
    const key = String(req.query["sort"] ?? "student");
    const get = STUDENT_SORT[key] ?? STUDENT_SORT["student"]!;
    const search = String(req.query["q"] ?? "").slice(0, 100);
    const rows = sortBy(studentRows(model, r.filter, search), get, req.query["dir"] === "desc" ? -1 : 1, (row) => `${row.name ?? ""} ${row.uid}`);
    res.json(pageOf(rows, readPageRequest(req.query as Record<string, unknown>)));
  } catch (err) {
    fail(req, res, err, "quiz student rows");
  }
});

/** The student side panel: totals and the subject table. Only the user's own scope limits it, not the page filters. */
router.get("/student", async (req, res): Promise<void> => {
  const r = readRequest(req, res);
  if (!r) return;
  const uid = String(req.query["uid"] ?? "").trim();
  if (!uid) {
    res.status(400).json({ error: "uid required" });
    return;
  }
  try {
    const model = await quizCoverageSnapshot(r.type).get();
    const scopeOnly: QuizFilter = { scopeCampuses: r.filter.scopeCampuses, scopeSubjects: r.filter.scopeSubjects };
    const subjects = studentSubjectRows(model, scopeOnly, uid).sort((a, b) => a.subject.localeCompare(b.subject, undefined, { sensitivity: "base" }));
    const first = subjects[0];
    if (!first) {
      res.status(404).json({ error: "Student not found" });
      return;
    }
    const total = studentRows(model, scopeOnly).find((s) => s.uid === first.uid);
    res.json({
      uid: first.uid,
      name: first.name,
      college: first.college,
      section: first.section,
      scheduled: total?.scheduled ?? 0,
      completed: total?.completed ?? 0,
      completionPct: total?.completionPct ?? null,
      avgScore: total?.avgScore ?? null,
      subjects: subjects.map((s) => ({ subject: s.subject, category: s.category, scheduled: s.scheduled, completed: s.completed, completionPct: s.completionPct, avgScore: s.avgScore })),
    });
  } catch (err) {
    fail(req, res, err, "quiz student panel");
  }
});

/* ---- downloads: every row for the current filters, as .xlsx or .csv ---- */

type Cell = string | number | null;
interface Sheet {
  view: string;
  headers: string[];
  rows: Cell[][];
}

function sheetFor(view: string, model: QuizCoverageModel, filter: QuizFilter, uid: string): Sheet | null {
  if (view === "campus") {
    return {
      view: "CampusSummary",
      headers: ["College", "Sections", "Students", "Scheduled", "Completion rate %", "Avg score %", "Participation %"],
      rows: sortBy(campusRows(model, filter), CAMPUS_SORT["college"]!, 1, (r) => r.college).map((r) => [r.college, r.sections, r.students, r.scheduled, r.completionPct, r.avgScore, r.participationPct]),
    };
  }
  if (view === "student") {
    return {
      view: "StudentSummary",
      headers: ["Student", "UID", "College", "Section", "Scheduled", "Completed", "Completion rate %", "Avg score %"],
      rows: sortBy(studentRows(model, filter), STUDENT_SORT["student"]!, 1, (r) => r.uid).map((r) => [r.name, r.uid, r.college, r.section, r.scheduled, r.completed, r.completionPct, r.avgScore]),
    };
  }
  if (view === "student-subject") {
    // A single student's report ignores the page filters; only the user's own scope applies.
    const scoped = uid ? { scopeCampuses: filter.scopeCampuses, scopeSubjects: filter.scopeSubjects } : filter;
    const rows = studentSubjectRows(model, scoped, uid || undefined).sort(
      (a, b) => (a.name ?? "").localeCompare(b.name ?? "", undefined, { sensitivity: "base" }) || a.uid.localeCompare(b.uid) || a.subject.localeCompare(b.subject),
    );
    return {
      view: uid ? "StudentReport" : "StudentBySubject",
      headers: ["Student", "UID", "College", "Section", "Subject category", "Subject", "Scheduled", "Completed", "Completion rate %", "Avg score %"],
      rows: rows.map((r) => [r.name, r.uid, r.college, r.section, r.category, r.subject, r.scheduled, r.completed, r.completionPct, r.avgScore]),
    };
  }
  return null;
}

const csvCell = (v: Cell) => {
  if (v == null) return "";
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

router.get("/download", async (req, res): Promise<void> => {
  const r = readRequest(req, res);
  if (!r) return;
  const format = req.query["format"] === "csv" ? "csv" : "xlsx";
  const uid = String(req.query["uid"] ?? "").trim();
  try {
    const model = await quizCoverageSnapshot(r.type).get();
    const sheet = sheetFor(String(req.query["view"] ?? ""), model, r.filter, uid);
    if (!sheet) {
      res.status(400).json({ error: "Invalid view" });
      return;
    }
    const college = (r.filter.college ?? "").trim().replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "All";
    const name = `SPI_${LABEL[r.type]}_${sheet.view}_${college}_${todayIst()}.${format}`;
    res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
    res.setHeader("Cache-Control", "no-store");
    if (format === "csv") {
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.write("﻿" + sheet.headers.map(csvCell).join(",") + "\r\n");
      let chunk: string[] = [];
      for (const row of sheet.rows) {
        chunk.push(row.map(csvCell).join(","));
        if (chunk.length >= 2000) {
          res.write(chunk.join("\r\n") + "\r\n");
          chunk = [];
        }
      }
      if (chunk.length) res.write(chunk.join("\r\n") + "\r\n");
      res.end();
      return;
    }
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res, useStyles: false, useSharedStrings: false });
    const ws = wb.addWorksheet(sheet.view.slice(0, 31));
    ws.addRow(sheet.headers).commit();
    for (const row of sheet.rows) ws.addRow(row).commit();
    await ws.commit();
    await wb.commit();
  } catch (err) {
    if (res.headersSent) {
      req.log.error({ err }, "Error while writing quiz download");
      res.end();
      return;
    }
    fail(req, res, err, "quiz download");
  }
});

export default router;
