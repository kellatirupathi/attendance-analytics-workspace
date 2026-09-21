/**
 * One-off, hand-confirmed corrections for recovery sessions whose recorded
 * instructor name was a nickname/first-name that the automatic exact-match
 * backfill (backfill-recovery-instructor-identity.ts) could not resolve on
 * its own. Each (sessionId, employeeId) pairing below was confirmed by
 * campus staff -- not guessed -- since this feeds the Incentive Tracker's
 * "who is owed money" calculation. Everything else (canonical name,
 * BigQuery instructor_user_id, campus-vs-backup type) is looked up live
 * from the roster rather than hardcoded, so it can't drift stale.
 *
 * Dry-run by default; pass --commit to write.
 *
 *   pnpm --filter @workspace/api-server run apply:confirmed-instructor-fixes
 *   pnpm --filter @workspace/api-server run apply:confirmed-instructor-fixes -- --commit
 */

import { eq } from "drizzle-orm";
import { db, recoverySessionsTable } from "@workspace/db";
import {
  getCampusInstructorRoster,
  getAllActiveInstructors,
  type CampusInstructorOption,
} from "./lib/queries.js";
import { logger } from "./lib/logger.js";

interface ConfirmedFix {
  sessionId: string;
  /** What was recorded before -- purely for the log, not matched against. */
  recordedAs: string;
  /** The confirmed real instructor's NxtWave employee id. */
  employeeId: string;
}

const CONFIRMED_FIXES: ConfirmedFix[] = [
  { sessionId: "bec7b769-7012-49f6-9138-179ef7d745fb", recordedAs: "Raghavendar", employeeId: "NW0004457" }, // Nallana Raghavendra
  { sessionId: "6730581c-6794-41ce-b495-d6794e7b8463", recordedAs: "Mir Nabeel", employeeId: "NW0004716" }, // Mir Nabeel Uddin
  { sessionId: "fa3b1199-eca9-4d71-8a7c-0add52ddc5db", recordedAs: "Mir Nabeel", employeeId: "NW0004716" },
  { sessionId: "04362d14-cfaa-497a-b5ae-b08105164a45", recordedAs: "Mir Nabeel", employeeId: "NW0004716" },
  { sessionId: "8e0dff6e-461b-40f6-a7b1-9f7a3da95151", recordedAs: "Mir Nabeel", employeeId: "NW0004716" },
  { sessionId: "b0c1f323-a1cb-44dd-abad-37dd114374a1", recordedAs: "Jammu Tejaswini", employeeId: "NW0004082" }, // Jammu Jyotsna Sai Tejaswini
  { sessionId: "e44bef4e-22fe-44b8-8c1a-5a12fab3275b", recordedAs: "Izhaar", employeeId: "NW0004228" }, // Mohammad Izhaar Ahmed
  { sessionId: "7d81e616-1412-4ab2-b90a-b6b3131b341b", recordedAs: "Divya Partipati", employeeId: "NW0004090" }, // Divya Hanuma Nandini Prattipati
  { sessionId: "115c8197-4323-4bea-af61-78353106f528", recordedAs: "Asif", employeeId: "NW0004118" }, // Attar Asif
  { sessionId: "0f411959-cd48-4dbe-9ef8-467089ea35c4", recordedAs: "Asif", employeeId: "NW0004118" },
  { sessionId: "3eac063e-8a8c-4905-9a70-a5e11e59c45c", recordedAs: "Jaswanth", employeeId: "NW0004017" }, // Bandi Jaswanth Reddy
  { sessionId: "cb70842f-dabc-4d10-82cd-c914aea34f8d", recordedAs: "Likitha", employeeId: "NW0004485" }, // Gudiya Likhita
  { sessionId: "623d1503-37c6-4289-8055-690d2a77fd92", recordedAs: "Likitha", employeeId: "NW0004485" }, // Gudiya Likhita
];

async function main() {
  const commit = process.argv.includes("--commit");
  logger.info(
    { commit, count: CONFIRMED_FIXES.length },
    commit
      ? "Applying confirmed instructor fixes (COMMIT mode -- this writes)"
      : "Dry run of confirmed instructor fixes (pass --commit to write)",
  );

  const allRoster = await getAllActiveInstructors();
  const rosterByCampus = new Map<string, CampusInstructorOption[]>();

  for (const fix of CONFIRMED_FIXES) {
    const [existing] = await db
      .select()
      .from(recoverySessionsTable)
      .where(eq(recoverySessionsTable.id, fix.sessionId))
      .limit(1);
    if (!existing) {
      logger.warn({ sessionId: fix.sessionId }, "Session not found, skipping");
      continue;
    }

    if (!rosterByCampus.has(existing.campus)) {
      rosterByCampus.set(existing.campus, await getCampusInstructorRoster(existing.campus));
    }
    const campusRoster = rosterByCampus.get(existing.campus)!;

    const campusMatch = campusRoster.find((r) => r.employeeId === fix.employeeId);
    const match = campusMatch ?? allRoster.find((r) => r.employeeId === fix.employeeId);
    if (!match) {
      logger.error(
        { fix },
        "This employee id was not found in the BigQuery roster -- skipping, double-check the id",
      );
      continue;
    }
    const instructorType: "campus" | "backup" = campusMatch ? "campus" : "backup";

    logger.info(
      {
        sessionId: fix.sessionId,
        campus: existing.campus,
        before: existing.instructorName,
        recordedAs: fix.recordedAs,
        after: match.name,
        employeeId: match.employeeId,
        instructorType,
      },
      commit ? "Updating session instructor identity" : "[dry run] Would update session instructor identity",
    );

    if (commit) {
      await db
        .update(recoverySessionsTable)
        .set({
          instructorName: match.name,
          employeeId: match.employeeId || null,
          bigqueryInstructorUserId: match.instructorUserId,
          instructorType,
          instructorTypeReviewedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(recoverySessionsTable.id, fix.sessionId));
    }
  }

  logger.info({ mode: commit ? "COMMITTED" : "DRY RUN (pass --commit to write)" }, "Done");
  process.exit(0);
}

main().catch((err) => {
  logger.error({ err }, "Failed");
  process.exit(1);
});
