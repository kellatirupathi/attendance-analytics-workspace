/**
 * One-time backfill: marks every EXISTING Completed/Partially Completed
 * recovery session's incentive as already BOA-approved.
 *
 * Context: the recovery sessions already in the system predate the
 * Incentive Tracker feature and were already vetted/approved by each
 * campus's BOA through whatever process they used before this feature
 * existed. There's no need to make BOAs re-approve that backlog through the
 * new in-app workflow -- an admin can go straight to marking each one paid
 * once the money is actually handed over.
 *
 * This does NOT touch the approval requirement itself: any session
 * scheduled through the app from now on still starts with
 * incentiveApproved = false and needs a real BOA yes/no via
 * PATCH /api/recovery/sessions/:id/incentive-approval, same as before. This
 * script only back-dates approval for the historical backlog that already
 * existed before that workflow did.
 *
 * `incentiveApprovedBy` is left null for these (there's no real approver to
 * attribute it to -- it happened outside the app), so the Incentive Tracker
 * will show these as approved without a "by <name>" attribution, which is
 * the honest picture. `incentiveApprovedAt` is set to the time this script
 * runs.
 *
 * Dry-run by default; pass --commit to write. Optionally restrict to one
 * campus with --campus=.
 *
 *   pnpm --filter @workspace/api-server run backfill:mark-historical-approved
 *   pnpm --filter @workspace/api-server run backfill:mark-historical-approved -- --commit
 */

import { and, eq, inArray } from "drizzle-orm";
import { db, recoverySessionsTable } from "@workspace/db";
import { logger } from "./lib/logger.js";

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : undefined;
}

async function main() {
  const commit = process.argv.includes("--commit");
  const campusFilter = argValue("campus");

  logger.info(
    { commit, campusFilter: campusFilter ?? "(all campuses)" },
    commit
      ? "Marking historical incentives approved (COMMIT mode -- this writes)"
      : "Dry run -- pass --commit to write",
  );

  const filters = [
    inArray(recoverySessionsTable.status, ["conducted", "partial"]),
    eq(recoverySessionsTable.incentiveApproved, false),
  ];
  if (campusFilter) filters.push(eq(recoverySessionsTable.campus, campusFilter));

  const candidates = await db
    .select({
      id: recoverySessionsTable.id,
      campus: recoverySessionsTable.campus,
      subject: recoverySessionsTable.subject,
      scheduledDate: recoverySessionsTable.scheduledDate,
      instructorName: recoverySessionsTable.instructorName,
      status: recoverySessionsTable.status,
    })
    .from(recoverySessionsTable)
    .where(and(...filters));

  logger.info({ count: candidates.length }, "Historical sessions not yet marked approved");
  if (candidates.length === 0) {
    logger.info("Nothing to do.");
    process.exit(0);
  }

  for (const s of candidates) {
    logger.info(
      { sessionId: s.id, campus: s.campus, subject: s.subject, date: s.scheduledDate, instructorName: s.instructorName, status: s.status },
      commit ? "Marking approved" : "[dry run] Would mark approved",
    );
  }

  if (commit) {
    const now = new Date();
    await db
      .update(recoverySessionsTable)
      .set({
        incentiveApproved: true,
        incentiveApprovedBy: null,
        incentiveApprovedAt: now,
        updatedAt: now,
      })
      .where(and(...filters));
  }

  logger.info(
    { total: candidates.length, mode: commit ? "COMMITTED" : "DRY RUN (pass --commit to write)" },
    "Done",
  );
  process.exit(0);
}

main().catch((err) => {
  logger.error({ err }, "Backfill failed");
  process.exit(1);
});
