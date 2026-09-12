/**
 * Read-only diagnostic: searches every BigQuery dataset this service account
 * can see for tables whose name looks instructor/staff/employee-related, and
 * prints their column schema plus a couple of sample rows for any match.
 *
 * Run from Replit Shell (needs BIGQUERY_SERVICE_ACCOUNT_JSON):
 *   pnpm --filter @workspace/api-server run find:instructor-table
 *
 * Optionally narrow the name search:
 *   pnpm --filter @workspace/api-server run find:instructor-table -- --match=instructor
 */

import {
  listDatasets,
  listTables,
  getTableSchema,
  getTablePreview,
} from "./lib/bigquery.js";
import { logger } from "./lib/logger.js";

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : undefined;
}

async function main() {
  const match = (argValue("match") ?? "instructor|staff|employee|faculty|teacher").toLowerCase();
  const pattern = new RegExp(match, "i");

  logger.info({ pattern: pattern.source }, "Listing BigQuery datasets");
  const datasets = await listDatasets();
  logger.info({ datasets }, "Found datasets");

  const hits: Array<{ dataset: string; table: string }> = [];

  for (const dataset of datasets) {
    let tables: Array<{ tableId: string; kind: string }>;
    try {
      tables = await listTables(dataset);
    } catch (err) {
      logger.warn({ err, dataset }, "Could not list tables for dataset, skipping");
      continue;
    }
    const matching = tables.filter((t) => pattern.test(t.tableId));
    if (matching.length > 0) {
      logger.info(
        { dataset, tables: matching.map((t) => t.tableId) },
        "Dataset has matching tables",
      );
      for (const t of matching) hits.push({ dataset, table: t.tableId });
    }
  }

  if (hits.length === 0) {
    logger.info("No tables matched the search pattern in any visible dataset.");
    process.exit(0);
  }

  for (const hit of hits) {
    try {
      const [schema, preview] = await Promise.all([
        getTableSchema(hit.dataset, hit.table, { flatten: false }),
        getTablePreview(hit.dataset, hit.table, { limit: 3 }),
      ]);
      logger.info(
        {
          dataset: hit.dataset,
          table: hit.table,
          columns: schema,
          totalRows: preview.totalRows,
          sampleRows: preview.rows,
        },
        "Table detail",
      );
    } catch (err) {
      logger.error({ err, dataset: hit.dataset, table: hit.table }, "Failed to inspect table");
    }
  }

  logger.info("Diagnostic finished (read-only, nothing written)");
  process.exit(0);
}

main().catch((err) => {
  logger.error({ err }, "Diagnostic failed");
  process.exit(1);
});
