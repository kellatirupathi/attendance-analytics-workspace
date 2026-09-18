/**
 * One-time backfill: corrects instructor names on existing recovery_sessions
 * rows and links them to BigQuery's canonical `niat_instructor_details`
 * roster (the NxtWave employee id + instructor_user_id), matching by EXACT
 * name only (case/whitespace-insensitive -- deliberately no fuzzy matching).
 *
 * Why exact-only: these ids are what the Incentive Tracker groups sessions
 * by to decide who is owed money, so a wrong fuzzy match here means paying
 * (or not paying) the wrong instructor. Anything that doesn't match exactly
 * and unambiguously is left alone and reported for manual review via the
 * admin "Fix instructor" action (PATCH /api/admin/recovery-sessions/:id/instructor-identity).
 *
 * Only touches sessions that don't already have an employeeId -- sessions
 * booked through the in-app scheduler already carry canonical identity and
 * are left untouched.
 *
 * Dry-run by default; pass --commit to actually write. Optionally restrict
 * to one campus with --campus=.
 *
 *   pnpm --filter @workspace/api-server run backfill:instructor-identity
 *   pnpm --filter @workspace/api-server run backfill:instructor-identity -- --commit
 *   pnpm --filter @workspace/api-server run backfill:instructor-identity -- --campus="CDU" --commit
 */

import { and, eq, isNull } from "drizzle-orm";
import { db, recoverySessionsTable } from "@workspace/db";
import {
  getCampusInstructorRoster,
  getAllActiveInstructors,
  type CampusInstructorOption,
} from "./lib/queries.js";
import { logger } from "./lib/logger.js";

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : undefined;
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

async function main() {
  const commit = process.argv.includes("--commit");
  const campusFilter = argValue("campus");

  logger.info(
    { commit, campusFilter: campusFilter ?? "(all campuses)" },
    commit
      ? "Starting instructor identity backfill (COMMIT mode -- this writes)"
      : "Starting instructor identity backfill (dry run -- pass --commit to write)",
  );

  const candidates = await db
    .select()
    .from(recoverySessionsTable)
    .where(
      and(
        isNull(recoverySessionsTable.employeeId),
        campusFilter ? eq(recoverySessionsTable.campus, campusFilter) : undefined,
      ),
    );

  logger.info(
    { count: candidates.length },
    "Sessions missing canonical instructor identity",
  );
  if (candidates.length === 0) {
    logger.info("Nothing to do.");
    process.exit(0);
  }

  // Fetch each affected campus's own roster (for a "campus" match) plus the
  // full active roster (for the "backup instructor" case -- someone who
  // covered a session at a campus they don't normally teach at).
  const campuses = [...new Set(candidates.map((c) => c.campus))];
  const rosterByCampus = new Map<string, CampusInstructorOption[]>();
  for (const campus of campuses) {
    rosterByCampus.set(campus, await getCampusInstructorRoster(campus));
  }
  const allRoster = await getAllActiveInstructors();

  let matched = 0;
  let skippedEmpty = 0;
  const unmatched: Array<{
    id: string;
    campus: string;
    subject: string;
    scheduledDate: string;
    instructorName: string;
    reason: string;
  }> = [];

  for (const session of candidates) {
    const rawName = session.instructorName?.trim() ?? "";
    if (!rawName) {
      skippedEmpty++;
      continue;
    }
    const normalized = normalizeName(rawName);

    const campusRoster = rosterByCampus.get(session.campus) ?? [];
    const campusMatches = campusRoster.filter(
      (i) => normalizeName(i.name) === normalized,
    );

    let match: CampusInstructorOption | undefined;
    let instructorType: "campus" | "backup" | "unknown" = "unknown";

    if (campusMatches.length === 1) {
      match = campusMatches[0];
      instructorType = "campus";
    } else if (campusMatches.length > 1) {
      unmatched.push({
        id: session.id,
        campus: session.campus,
        subject: session.subject,
        scheduledDate: session.scheduledDate,
        instructorName: rawName,
        reason: `Ambiguous: ${campusMatches.length} instructors named "${rawName}" at ${session.campus}`,
      });
      continue;
    } else {
      const allMatches = allRoster.filter(
        (i) => normalizeName(i.name) === normalized,
      );
      if (allMatches.length === 1) {
        match = allMatches[0];
        instructorType = "backup";
      } else if (allMatches.length > 1) {
        unmatched.push({
          id: session.id,
          campus: session.campus,
          subject: session.subject,
          scheduledDate: session.scheduledDate,
          instructorName: rawName,
          reason: `Ambiguous: ${allMatches.length} instructors named "${rawName}" across all campuses`,
        });
        continue;
      }
    }

    if (!match) {
      unmatched.push({
        id: session.id,
        campus: session.campus,
        subject: session.subject,
        scheduledDate: session.scheduledDate,
        instructorName: rawName,
        reason: "No exact name match found in the BigQuery instructor roster",
      });
      continue;
    }

    logger.info(
      {
        sessionId: session.id,
        campus: session.campus,
        before: rawName,
        after: match.name,
        employeeId: match.employeeId,
        instructorType,
      },
      commit
        ? "Updating session instructor identity"
        : "[dry run] Would update session instructor identity",
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
        .where(eq(recoverySessionsTable.id, session.id));
    }
    matched++;
  }

  logger.info(
    {
      totalCandidates: candidates.length,
      matched,
      skippedEmpty,
      unmatchedCount: unmatched.length,
      mode: commit ? "COMMITTED" : "DRY RUN (pass --commit to write)",
    },
    "Backfill summary",
  );
  if (unmatched.length > 0) {
    logger.warn(
      { unmatched },
      "Sessions left unmatched -- fix these manually via the Incentive Tracker's 'Fix instructor' action",
    );
  }

  process.exit(0);
}

main().catch((err) => {
  logger.error({ err }, "Backfill failed");
  process.exit(1);
});
