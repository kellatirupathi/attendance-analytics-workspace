/**
 * One SPI report sync (BigQuery → Postgres spi_report_cache), then exits.
 * The published app runs on Autoscale, which gives no CPU to background work between
 * requests, so the hourly sync runs as a Replit Scheduled Deployment instead:
 *   pnpm --filter @workspace/api-server run sync:reports
 * Needs DATABASE_URL and BIGQUERY_SERVICE_ACCOUNT_JSON. Exit code 1 when the run failed.
 */

import { pool } from "@workspace/db";
import { runReportSync } from "./lib/spiReportSync.js";
import { logger } from "./lib/logger.js";

async function main() {
  const result = await runReportSync("schedule");
  logger.info(result, "SPI report sync finished");
  await pool.end();
  process.exit(result.status === "failed" ? 1 : 0);
}

main().catch((err) => {
  logger.error({ err }, "SPI report sync crashed");
  process.exit(1);
});
