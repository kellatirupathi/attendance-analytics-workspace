import { pool } from "@workspace/db";
import { isExcludedInstitute } from "./excludedInstitutes.js";
import { createSnapshot } from "./snapshot.js";
import { hyphenate, shortSection, type AttendanceState, type DirectoryCourse, type DirectoryPart, type DirectoryStudent } from "./directoryReportModel.js";

/**
 * One copy of the saved student reports (spi_report_cache, rebuilt by the report sync), refreshed in the
 * background (snapshot.ts). The Student Directory reads this copy and filters it in memory, so changing a
 * filter never waits for a database round trip. Read-only: the report code is not touched.
 */
interface Row {
  student_id: string;
  college: string | null;
  semester: string | null;
  section: string | null;
  attendance_pct: string | number | null;
  spi: string | number | null;
  name: string | null;
  att_state: string | null;
  debt: number | string | null;
  courses: { n?: string; cq?: unknown; mq?: unknown; sa?: unknown }[] | null;
}

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const part = (v: unknown): DirectoryPart | null => {
  if (!v || typeof v !== "object") return null;
  const p = v as { avgPct?: unknown; total?: unknown };
  const avgPct = num(p.avgPct);
  const total = num(p.total);
  return avgPct == null || total == null ? null : { avgPct, total };
};

async function load(): Promise<DirectoryStudent[]> {
  const { rows } = await pool.query<Row>(
    `SELECT DISTINCT ON (r.student_id)
        r.student_id, r.college, r.semester, r.section, r.attendance_pct, r.spi,
        r.report->>'studentName' AS name,
        r.report->'attendance'->>'state' AS att_state,
        jsonb_array_length(COALESCE(r.report->'skillDebt', '[]'::jsonb)) AS debt,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('n', c->>'name', 'cq', c->'classroom', 'mq', c->'module', 'sa', c->'skillAssessment'))
                  FROM jsonb_array_elements(COALESCE(r.report->'courses', '[]'::jsonb)) c), '[]'::jsonb) AS courses
     FROM spi_report_cache r
     ORDER BY r.student_id, r.built_at DESC`,
  );
  const out: DirectoryStudent[] = [];
  for (const r of rows) {
    const college = (r.college ?? "").trim();
    if (!college || isExcludedInstitute(college)) continue;
    const state: AttendanceState = r.att_state === "met" ? "met" : r.att_state === "not_met" ? "not_met" : "not_available";
    const courses: DirectoryCourse[] = (r.courses ?? []).map((c) => ({ name: String(c.n ?? "").trim(), classroom: part(c.cq), module: part(c.mq), skill: part(c.sa) })).filter((c) => c.name);
    out.push({
      studentId: hyphenate(r.student_id),
      name: r.name?.trim() || null,
      college,
      semester: r.semester?.trim() || null,
      section: shortSection(r.section),
      attendancePct: num(r.attendance_pct),
      attendanceState: state,
      spi: num(r.spi),
      skillDebt: (Number(r.debt) || 0) > 0,
      courses,
    });
  }
  return out;
}

export const directorySnapshot = createSnapshot<DirectoryStudent[]>("student-directory-reports", load);
