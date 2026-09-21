/**
 * One-off, hand-confirmed corrections for recovery sessions delivered by a
 * backup instructor who will never appear in the BigQuery
 * `niat_instructor_details` roster -- either because they've since exited
 * NxtWave, or for some other reason their record was never onboarded there.
 * Unlike apply-confirmed-instructor-fixes.ts, there's no employee id to look
 * up: campus staff confirmed the person and their backup status directly, so
 * we just record instructorType = "backup" with no employeeId /
 * bigqueryInstructorUserId, and leave the recorded name as-is.
 *
 * Backup-type sessions are excluded from incentive eligibility (see
 * getIncentiveTracker in lib/queries.ts) -- this script's only job is
 * correcting the identity/type flag so the Incentive Tracker stops treating
 * these sessions as pending review, and correctly shows them as "na" instead
 * of miscounting them against a campus instructor.
 *
 * Dry-run by default; pass --commit to write.
 *
 *   pnpm --filter @workspace/api-server run mark:confirmed-backup-instructors
 *   pnpm --filter @workspace/api-server run mark:confirmed-backup-instructors -- --commit
 */

import { eq } from "drizzle-orm";
import { db, recoverySessionsTable } from "@workspace/db";
import { logger } from "./lib/logger.js";

interface ConfirmedBackup {
  sessionId: string;
  /** Name as already recorded on the session -- kept as-is, just for the log. */
  instructorName: string;
  /** Why this one can never resolve via BigQuery -- for the log only. */
  note: string;
}

const CONFIRMED_BACKUPS: ConfirmedBackup[] = [
  {
    sessionId: "b8c6de08-19a3-493d-8459-a8e49d58cc98",
    instructorName: "Gattadi Vikranth",
    note: "Exited instructor -- confirmed by campus staff, not in BigQuery roster",
  },
  {
    sessionId: "6c80c07e-fa8c-4332-80d6-f753eae99b9c",
    instructorName: "Varun Chakravarthy",
    note: "No match anywhere in BigQuery roster (active or inactive) -- confirmed by campus staff as backup",
  },
];

async function main() {
  const commit = process.argv.includes("--commit");
  logger.info(
    { commit, count: CONFIRMED_BACKUPS.length },
    commit
      ? "Marking confirmed backup instructors (COMMIT mode -- this writes)"
      : "Dry run of confirmed backup instructors (pass --commit to write)",
  );

  for (const entry of CONFIRMED_BACKUPS) {
    const [existing] = await db
      .select()
      .from(recoverySessionsTable)
      .where(eq(recoverySessionsTable.id, entry.sessionId))
      .limit(1);
    if (!existing) {
      logger.warn({ sessionId: entry.sessionId }, "Session not found, skipping");
      continue;
    }

    logger.info(
      {
        sessionId: entry.sessionId,
        campus: existing.campus,
        subject: existing.subject,
        date: existing.scheduledDate,
        recordedAs: existing.instructorName,
        settingNameTo: entry.instructorName,
        instructorType: "backup",
        note: entry.note,
      },
      commit ? "Marking as confirmed backup instructor" : "[dry run] Would mark as confirmed backup instructor",
    );

    if (commit) {
      const now = new Date();
      await db
        .update(recoverySessionsTable)
        .set({
          instructorName: entry.instructorName,
          employeeId: null,
          bigqueryInstructorUserId: null,
          instructorType: "backup",
          instructorTypeReviewedAt: now,
          updatedAt: now,
        })
        .where(eq(recoverySessionsTable.id, entry.sessionId));
    }
  }

  logger.info({ mode: commit ? "COMMITTED" : "DRY RUN (pass --commit to write)" }, "Done");
  process.exit(0);
}

main().catch((err) => {
  logger.error({ err }, "Failed");
  process.exit(1);
});
