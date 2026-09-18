/**
 * Read-only diagnostic: searches `niat_instructor_details` for any name
 * fragment, across EVERY instructor_status (not just ACTIVE) and every
 * institute -- for the cases where a recovery session's instructor can't be
 * found in the active roster (list-campus-instructor-roster.ts already
 * checked that) and might be inactive, or spelled quite differently than
 * expected. Nothing is written.
 *
 *   pnpm --filter @workspace/api-server run search:instructor -- --name="Vikranth"
 *   pnpm --filter @workspace/api-server run search:instructor -- --name="Vikranth,Chakravarthy,Varun"
 */

import { bqQuery, INSTRUCTOR_DETAILS_TABLE } from "./lib/bigquery.js";
import { logger } from "./lib/logger.js";

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : undefined;
}

interface InstructorDetailsRow {
  instructor_user_id: string;
  instructor_category: string | null;
  instructor_name: string;
  instructor_role: string | null;
  nw_instructor_id: string | null;
  institute_name: string | null;
  instructor_status: string | null;
}

async function main() {
  const namesArg = argValue("name");
  if (!namesArg) {
    logger.error('Usage: --name="<fragment>" (comma-separate for several)');
    process.exit(1);
  }
  const fragments = namesArg.split(",").map((n) => n.trim()).filter(Boolean);

  for (const fragment of fragments) {
    const rows = await bqQuery<InstructorDetailsRow>(
      `SELECT instructor_user_id, instructor_category, instructor_name, instructor_role, nw_instructor_id, institute_name, instructor_status
       FROM ${INSTRUCTOR_DETAILS_TABLE}
       WHERE LOWER(instructor_name) LIKE LOWER(@pattern)
       ORDER BY instructor_name`,
      { pattern: `%${fragment}%` },
    );
    logger.info({ fragment, count: rows.length }, rows.length === 0 ? "No matches at all (active or inactive)" : "Matches found");
    for (const r of rows) {
      logger.info(
        {
          name: r.instructor_name,
          employeeId: r.nw_instructor_id,
          status: r.instructor_status,
          category: r.instructor_category,
          role: r.instructor_role,
          institute: r.institute_name,
        },
        "instructor",
      );
    }
  }

  logger.info("Diagnostic finished (read-only, nothing written)");
  process.exit(0);
}

main().catch((err) => {
  logger.error({ err }, "Diagnostic failed");
  process.exit(1);
});
