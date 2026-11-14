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
  batch: string | null;
  semester: string | null;
  section: string | null;
  ended: boolean;
  attendance_pct: string | number | null;
  spi: string | number | null;
  name: string | null;
  att_state: string | null;
  att_tier: string | null;
  att_present: string | number | null;
  att_held: string | number | null;
  debt: number | string | null;
  courses: { n?: string; cq?: unknown; mq?: unknown; sa?: unknown; att?: unknown; p?: unknown; h?: unknown; score?: unknown; pts?: unknown; lvl?: unknown }[] | null;
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

/**
 * The live cache, plus students the cache no longer has: their semester ended, so the hourly sync (which only
 * sees current-semester rows) dropped them. Their last saved report is in spi_report_history; it is shown
 * marked as ended. A student in both places keeps the live row.
 */
const REPORTS_WITH_HISTORY = `(
  SELECT student_id, college, batch, semester, section, attendance_pct, spi, report, built_at, false AS ended FROM spi_report_cache
  UNION ALL
  SELECT h.student_id, h.college, h.batch, h.semester, h.section, h.attendance_pct, h.spi, h.report, h.built_at, true AS ended
  FROM spi_report_history h
  WHERE NOT EXISTS (SELECT 1 FROM spi_report_cache c WHERE c.student_id = h.student_id)
) r`;
const REPORTS_CACHE_ONLY = "(SELECT student_id, college, batch, semester, section, attendance_pct, spi, report, built_at, false AS ended FROM spi_report_cache) r";

async function load(): Promise<DirectoryStudent[]> {
  const select = (source: string) =>
    `SELECT DISTINCT ON (r.student_id)
        r.student_id, r.college, r.batch, r.semester, r.section, r.attendance_pct, r.spi, r.ended,
        r.report->>'studentName' AS name,
        r.report->'attendance'->>'state' AS att_state,
        r.report->'attendance'->>'tier' AS att_tier,
        r.report->'attendance'->>'present' AS att_present,
        r.report->'attendance'->>'held' AS att_held,
        jsonb_array_length(COALESCE(r.report->'skillDebt', '[]'::jsonb)) AS debt,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('n', c->>'name', 'cq', c->'classroom', 'mq', c->'module', 'sa', c->'skillAssessment', 'att', c->'attendancePct', 'p', c->'present', 'h', c->'held', 'score', c->'courseScore', 'pts', c->'points', 'lvl', c->>'level'))
                  FROM jsonb_array_elements(COALESCE(r.report->'courses', '[]'::jsonb)) c), '[]'::jsonb) AS courses
     FROM ${source}
     ORDER BY r.student_id, r.built_at DESC`;
  let rows: Row[];
  try {
    rows = (await pool.query<Row>(select(REPORTS_WITH_HISTORY))).rows;
  } catch {
    // spi_report_history not created yet (fresh database): the live cache alone.
    rows = (await pool.query<Row>(select(REPORTS_CACHE_ONLY))).rows;
  }
  const out: DirectoryStudent[] = [];
  for (const r of rows) {
    const college = (r.college ?? "").trim();
    if (!college || isExcludedInstitute(college)) continue;
    const state: AttendanceState = r.att_state === "met" ? "met" : r.att_state === "not_met" ? "not_met" : "not_available";
    const courses: DirectoryCourse[] = (r.courses ?? []).map((c) => ({ name: String(c.n ?? "").trim(), classroom: part(c.cq), module: part(c.mq), skill: part(c.sa), attendancePct: num(c.att), present: num(c.p) ?? 0, held: num(c.h) ?? 0, score: num(c.score), points: num(c.pts), levelF: c.lvl === "F" })).filter((c) => c.name);
    out.push({
      studentId: hyphenate(r.student_id),
      name: r.name?.trim() || null,
      college,
      batch: r.batch?.trim() || "Unknown",
      semester: r.semester?.trim() || null,
      section: shortSection(r.section),
      attendancePct: num(r.attendance_pct),
      attPresent: num(r.att_present) ?? 0,
      attHeld: num(r.att_held) ?? 0,
      attendanceState: state,
      tier: (["eligible", "recovery_eligible", "at_risk", "ineligible"] as const).find((t) => t === r.att_tier) ?? null,
      spi: num(r.spi),
      skillDebt: (Number(r.debt) || 0) > 0,
      ...(r.ended ? { ended: true } : {}),
      courses,
    });
  }
  return out;
}

/**
 * The id of the last successful report sync. The sync runs as its own scheduled job (another process), so the
 * directory copy cannot be told directly; it compares this id instead and reloads as soon as it changes.
 */
async function lastSyncToken(): Promise<string | null> {
  const { rows } = await pool.query<{ t: string | null }>("SELECT MAX(id)::text AS t FROM spi_report_sync_runs WHERE status = 'success'");
  return rows[0]?.t ?? null;
}

export const directorySnapshot = createSnapshot<DirectoryStudent[]>("student-directory-reports", load, { token: lastSyncToken });
