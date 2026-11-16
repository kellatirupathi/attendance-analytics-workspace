import { pool } from "@workspace/db";
import { logger } from "./logger.js";
import { savedReportTrackedSql } from "./reportEnded.js";

/**
 * Ended semesters SPI never tracked (reportEnded.ts savedReportTracked): "student key \t semester" of saved reports
 * first saved after their semester had already ended. The BigQuery side (each student's latest ended semester,
 * queries.ts) leaves these out too, so the report sync stops rebuilding them and Attendance Stats, the Overview
 * trend and Assessments count the same students as the Directory.
 * Read from spi_report_history and kept in memory; loadUntrackedReports() refreshes it at most every 10 minutes.
 */
let keys: string[] = [];
let loadedAt = 0;
let inFlight: Promise<string[]> | null = null;
const TTL_MS = 10 * 60 * 1000;

/** The list as last loaded (empty until the first load); for building SQL synchronously. */
export function untrackedEndedKeys(): string[] {
  return keys;
}

/** Loads the list (once per 10 minutes); call before building SQL that reads each student's latest semester. */
export async function loadUntrackedReports(): Promise<string[]> {
  if (Date.now() - loadedAt < TTL_MS) return keys;
  inFlight ??= pool
    .query<{ k: string }>(
      `SELECT DISTINCT CONCAT(LOWER(REPLACE(h.student_id, '-', '')), E'\\t', TRIM(h.semester)) AS k
       FROM spi_report_history h
       WHERE NOT ${savedReportTrackedSql("h")}
       ORDER BY 1`,
    )
    .then((r) => {
      keys = r.rows.map((row) => row.k);
      loadedAt = Date.now();
      return keys;
    })
    .catch((err) => {
      // No history table yet, or a read failure: keep the last list (nothing is left out on a fresh database).
      logger.warn({ err }, "Reading untracked ended reports failed");
      loadedAt = Date.now() - TTL_MS + 60 * 1000;
      return keys;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** "student key \t semester" values as a BigQuery IN list of string literals; "" when none. */
export function untrackedKeysSqlList(list: string[] = keys): string {
  return list.map((k) => `'${k.replaceAll("\\", "\\\\").replaceAll("'", "\\'").replaceAll("\t", "\\t")}'`).join(", ");
}
