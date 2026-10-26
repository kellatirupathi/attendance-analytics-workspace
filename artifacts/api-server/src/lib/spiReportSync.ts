import { pool } from "@workspace/db";
import { logger } from "./logger.js";
import { cacheDeletePrefix, cacheGet, cacheSet } from "./cache.js";
import { getAttendanceExclusions } from "./attendanceExclusions.js";
import { buildAllScorecards, reportConfigVersion, type BuiltReport } from "./spiScorecard.js";

/**
 * SPI report sync: BigQuery → Postgres (spi_report_cache), so a report opens in milliseconds
 * instead of running BigQuery queries per student.
 *
 * - Every SYNC_EVERY_MS (default 60 min, SPI_REPORT_SYNC_MINUTES) all current-semester students'
 *   reports are rebuilt in one pass with the same queries and rules as the live report.
 * - Also when course credits, removed courses, the SA map or attendance rules change.
 * - The table is replaced in one transaction: readers see the old reports until the new ones are
 *   all written. A run with far fewer students than the table holds is refused (likely bad data).
 * - One run at a time across servers (Postgres advisory lock). A failed run keeps the old reports.
 * - A student not in the table yet is built live once and saved (spi report route).
 * - SPI_REPORT_SYNC=off turns the schedule off; the admin "run now" still works.
 */
const SYNC_EVERY_MS = Math.max(15, Number(process.env["SPI_REPORT_SYNC_MINUTES"]) || 60) * 60_000;
const CHECK_EVERY_MS = 5 * 60_000;
/** After a failed run, wait this long before trying again. */
const RETRY_AFTER_MS = 15 * 60_000;
/** Refuse a run that would shrink the table below this share of its current rows. */
const MIN_SHARE = 0.8;
const LOCK_KEY = 735_201;
const INSERT_BATCH = 500;
const MEMORY_TTL_MS = 5 * 60_000;
const memoryKey = (studentKey: string) => `spiReport:${studentKey}`;

const CREATE_TABLES = [
  `CREATE TABLE IF NOT EXISTS spi_report_cache (
    student_id text PRIMARY KEY,
    college text,
    semester text,
    section text,
    batch text,
    attendance_pct real,
    spi real,
    needs_attention integer,
    report jsonb NOT NULL,
    built_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS spi_report_sync_runs (
    id serial PRIMARY KEY,
    trigger text NOT NULL,
    status text NOT NULL,
    students integer,
    config_version text,
    error text,
    started_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz,
    duration_ms integer
  )`,
];

let tablesReady: Promise<void> | null = null;

/**
 * Creates the two tables, or the batch column (added 2026-10-27), only when missing
 * (same columns as lib/db/src/schema/reportCache.ts). The published app's database user may
 * not own the tables, and Postgres refuses ALTER/CREATE to a non-owner even when nothing
 * would change, so existing tables are checked first and never touched.
 */
function ensureTables(): Promise<void> {
  tablesReady ??= (async () => {
    const { rows } = await pool.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name IN ('spi_report_cache', 'spi_report_sync_runs')`,
    );
    const tables = new Set(rows.map((r) => r.table_name));
    if (!tables.has("spi_report_cache") || !tables.has("spi_report_sync_runs")) {
      for (const ddl of CREATE_TABLES) await pool.query(ddl);
    } else if (!rows.some((r) => r.table_name === "spi_report_cache" && r.column_name === "batch")) {
      await pool.query("ALTER TABLE spi_report_cache ADD COLUMN IF NOT EXISTS batch text");
    }
  })().catch((err) => {
    tablesReady = null;
    throw err;
  });
  return tablesReady;
}

async function currentConfigVersion(): Promise<string> {
  return `${await reportConfigVersion()}:${getAttendanceExclusions().version}`;
}

function rowValues(r: BuiltReport): unknown[] {
  return [
    r.identity.studentKey,
    r.identity.instituteName,
    r.identity.semester,
    r.identity.sectionName,
    r.identity.batch,
    r.scorecard.attendance.overallPct,
    r.scorecard.spi,
    r.scorecard.skillDebt.length,
    JSON.stringify(r.scorecard),
  ];
}

const COLUMNS = "(student_id, college, semester, section, batch, attendance_pct, spi, needs_attention, report)";

/** ($1, …, $9::jsonb), (…) for `count` rows of rowValues(). */
function valuesSql(count: number): string {
  return Array.from({ length: count }, (_, row) => {
    const p = Array.from({ length: 9 }, (_, i) => `${row * 9 + i + 1}`);
    p[8] = `${p[8]}::jsonb`;
    return `(${p.join(", ")})`;
  }).join(", ");
}

/** The saved report of one student (memory first, then Postgres); null when not synced yet. */
export async function getCachedReport(studentKey: string): Promise<object | null> {
  const hit = cacheGet<object>(memoryKey(studentKey));
  if (hit) return hit;
  try {
    await ensureTables();
    const { rows } = await pool.query<{ report: object }>("SELECT report FROM spi_report_cache WHERE student_id = $1", [studentKey]);
    const report = rows[0]?.report ?? null;
    if (report) cacheSet(memoryKey(studentKey), report, MEMORY_TTL_MS);
    return report;
  } catch (err) {
    logger.error({ err }, "Reading spi_report_cache failed");
    return null;
  }
}

/** College, semester, section and batch of a synced student (for the quiz tracking); null when not synced. */
export async function getCachedPlacement(
  studentKey: string,
): Promise<{ college: string | null; semester: string | null; section: string | null; batch: string | null } | null> {
  try {
    await ensureTables();
    const { rows } = await pool.query<{ college: string | null; semester: string | null; section: string | null; batch: string | null }>(
      "SELECT college, semester, section, batch FROM spi_report_cache WHERE student_id = $1",
      [studentKey],
    );
    return rows[0] ?? null;
  } catch (err) {
    logger.error({ err }, "Reading spi_report_cache placement failed");
    return null;
  }
}

/** Saves one report built live (a student the last sync did not have). */
export async function saveReport(report: BuiltReport): Promise<void> {
  try {
    await ensureTables();
    await pool.query(
      `INSERT INTO spi_report_cache ${COLUMNS} VALUES ${valuesSql(1)}
       ON CONFLICT (student_id) DO UPDATE SET college = EXCLUDED.college, semester = EXCLUDED.semester,
         section = EXCLUDED.section, batch = EXCLUDED.batch, attendance_pct = EXCLUDED.attendance_pct, spi = EXCLUDED.spi,
         needs_attention = EXCLUDED.needs_attention, report = EXCLUDED.report, built_at = now()`,
      rowValues(report),
    );
    cacheSet(memoryKey(report.identity.studentKey), report.scorecard, MEMORY_TTL_MS);
  } catch (err) {
    logger.error({ err }, "Saving a live report to spi_report_cache failed");
  }
}

export type SyncTrigger = "schedule" | "startup" | "manual" | "config";

/** Rebuilds every student's report from BigQuery and replaces spi_report_cache in one transaction. */
export async function runReportSync(trigger: SyncTrigger): Promise<{ status: string; students?: number; error?: string }> {
  await ensureTables();
  const client = await pool.connect();
  try {
    const { rows: lock } = await client.query<{ ok: boolean }>("SELECT pg_try_advisory_lock($1) AS ok", [LOCK_KEY]);
    if (!lock[0]?.ok) return { status: "skipped", error: "Another sync is running" };
    const startedAt = Date.now();
    const configVersion = await currentConfigVersion();
    const { rows: run } = await client.query<{ id: number }>(
      "INSERT INTO spi_report_sync_runs (trigger, status, config_version) VALUES ($1, 'running', $2) RETURNING id",
      [trigger, configVersion],
    );
    const runId = run[0]!.id;
    const finish = (status: string, students: number | null, error: string | null) =>
      client.query(
        "UPDATE spi_report_sync_runs SET status = $2, students = $3, error = $4, finished_at = now(), duration_ms = $5 WHERE id = $1",
        [runId, status, students, error, Date.now() - startedAt],
      );
    try {
      const reports = await buildAllScorecards();
      const { rows: count } = await client.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM spi_report_cache");
      const previous = count[0]?.n ?? 0;
      if (reports.length === 0 || reports.length < previous * MIN_SHARE) {
        const error = `Refused: ${reports.length} students built, table has ${previous}`;
        await finish("failed", reports.length, error);
        logger.error({ trigger, built: reports.length, previous }, "SPI report sync refused");
        return { status: "failed", students: reports.length, error };
      }
      await client.query("BEGIN");
      await client.query("DELETE FROM spi_report_cache");
      for (let i = 0; i < reports.length; i += INSERT_BATCH) {
        const batch = reports.slice(i, i + INSERT_BATCH);
        await client.query(`INSERT INTO spi_report_cache ${COLUMNS} VALUES ${valuesSql(batch.length)}`, batch.flatMap(rowValues));
      }
      await client.query("COMMIT");
      cacheDeletePrefix("spiReport:");
      await finish("success", reports.length, null);
      logger.info({ trigger, students: reports.length, ms: Date.now() - startedAt }, "SPI report sync done");
      return { status: "success", students: reports.length };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      const error = err instanceof Error ? err.message : String(err);
      await finish("failed", null, error.slice(0, 2000)).catch(() => undefined);
      logger.error({ err, trigger }, "SPI report sync failed");
      return { status: "failed", error };
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]).catch(() => undefined);
    }
  } finally {
    client.release();
  }
}

/** Last runs and the table size, for the admin status endpoint. */
export async function reportSyncStatus(): Promise<object> {
  await ensureTables();
  const [runs, cache] = await Promise.all([
    pool.query(
      "SELECT id, trigger, status, students, error, started_at, finished_at, duration_ms FROM spi_report_sync_runs ORDER BY id DESC LIMIT 10",
    ),
    pool.query("SELECT COUNT(*)::int AS students, MAX(built_at) AS last_built FROM spi_report_cache"),
  ]);
  return { everyMinutes: SYNC_EVERY_MS / 60_000, cache: cache.rows[0], runs: runs.rows };
}

/** Why a sync should run now, or null. Run history lives in Postgres, so restarts do not add runs. */
async function dueTrigger(first: boolean): Promise<SyncTrigger | null> {
  const { rows } = await pool.query<{ status: string; config_version: string | null; started_at: Date }>(
    "SELECT status, config_version, started_at FROM spi_report_sync_runs WHERE status IN ('success', 'failed') ORDER BY id DESC LIMIT 1",
  );
  const last = rows[0];
  const { rows: ok } = await pool.query<{ config_version: string | null; started_at: Date }>(
    "SELECT config_version, started_at FROM spi_report_sync_runs WHERE status = 'success' ORDER BY id DESC LIMIT 1",
  );
  const lastOk = ok[0];
  if (last?.status === "failed" && Date.now() - new Date(last.started_at).getTime() < RETRY_AFTER_MS) return null;
  if (!lastOk) return first ? "startup" : "schedule";
  if (lastOk.config_version !== (await currentConfigVersion())) return "config";
  if (Date.now() - new Date(lastOk.started_at).getTime() >= SYNC_EVERY_MS) return first ? "startup" : "schedule";
  return null;
}

let timer: NodeJS.Timeout | null = null;

/** Checks every 5 minutes whether a sync is due and runs it in the background. */
export function startReportSync(): void {
  // SPI_REPORT_SYNC=off (e.g. the Dev preview): reports are built live and saved one by one instead.
  if (timer || process.env["SPI_REPORT_SYNC"] === "off") return;
  const tick = (first: boolean) =>
    ensureTables()
      .then(() => dueTrigger(first))
      .then((trigger) => (trigger ? runReportSync(trigger) : undefined))
      .catch((err) => logger.error({ err }, "SPI report sync check failed"));
  void tick(true);
  timer = setInterval(() => void tick(false), CHECK_EVERY_MS);
  timer.unref();
}
