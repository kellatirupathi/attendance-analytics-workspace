/**
 * Imports the historical (already-conducted) recovery sessions listed in
 * seed/historical-recovery-sessions.ts into Postgres, so they show up in the
 * session tracker as "recovered" instead of "needs recovery".
 *
 * Each topic is resolved by TITLE against recovery_topics for that campus,
 * searched across every subject (not just the spreadsheet's short subject
 * code) -- MRV and NRI don't use CDU's short-code subject naming, so the
 * subject actually written to recovery_sessions/recovery_progress comes from
 * whichever recovery_topics row the title matches, not from the sheet.
 *
 * Defaults to a DRY RUN: it only reports what it would match/write. Nothing
 * is written to the database until you pass --commit.
 *
 *   pnpm --filter @workspace/api-server run import:recovery-history            (dry run)
 *   pnpm --filter @workspace/api-server run import:recovery-history -- --commit (writes)
 *
 * Safe to re-run: sessions are matched by (campus, instructorName,
 * scheduledDate) and updated in place rather than duplicated; topics and
 * progress rows use onConflictDoNothing / an existence check first.
 */

import { db } from "@workspace/db";
import {
  recoveryTopicsTable,
  recoverySessionsTable,
  sessionTopicsTable,
  recoveryProgressTable,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { HISTORICAL_RECOVERY_SESSIONS } from "./seed/historical-recovery-sessions.js";
import { logger } from "./lib/logger.js";

const COMMIT = process.argv.includes("--commit");

/**
 * Same normalisation used by seed-recovery.ts to bridge spreadsheet titles
 * and the live BigQuery-sourced titles now stored in recovery_topics: case,
 * whitespace, "&" vs "and", roman numerals, and the visualisation/
 * visualization spelling drift are the main sources of mismatch.
 */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\bpart\s*[-\s]*(\d+)\b/g, "$1")
    .replace(/\biii\b/g, "3")
    .replace(/\bii\b/g, "2")
    .replace(/\bi\b/g, "1")
    .replace(/visualisation/g, "visualization")
    .replace(/[^a-z0-9]/g, "");
}

function levenshtein(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, i) => i);
  for (let i = 1; i <= left.length; i++) {
    let diagonal = previous[0]!;
    previous[0] = i;
    for (let j = 1; j <= right.length; j++) {
      const above = previous[j]!;
      previous[j] = Math.min(
        previous[j]! + 1,
        previous[j - 1]! + 1,
        diagonal + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return previous[right.length]!;
}

function similarity(left: string, right: string): number {
  const longest = Math.max(left.length, right.length);
  return longest === 0 ? 1 : 1 - levenshtein(left, right) / longest;
}

/** Top 3 closest actual recovery_topics titles for this campus, for diagnostics. */
function suggestClosestTitles(
  title: string,
  allTopics: TopicCandidate[],
): { title: string; subject: string; score: number }[] {
  const key = normalize(title);
  return allTopics
    .map((t) => ({
      title: t.topicTitle,
      subject: t.subject,
      score: similarity(key, normalize(t.topicTitle)),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

/**
 * Verified spreadsheet title -> recovery_topics title overrides, for cases
 * normalisation alone can't bridge. Add entries here (and re-run) for any
 * title the dry run reports as UNMATCHED that you've confirmed by eye.
 */
const TITLE_OVERRIDES: Record<string, string> = {};

interface TopicCandidate {
  id: string;
  subject: string;
  topicTitle: string;
}

interface CampusTopics {
  byNormalizedTitle: Map<string, TopicCandidate[]>;
  all: TopicCandidate[];
}

async function loadCampusTopics(campus: string): Promise<CampusTopics> {
  const rows = await db
    .select({
      id: recoveryTopicsTable.id,
      subject: recoveryTopicsTable.subject,
      topicTitle: recoveryTopicsTable.topicTitle,
    })
    .from(recoveryTopicsTable)
    .where(
      and(
        eq(recoveryTopicsTable.campus, campus),
        eq(recoveryTopicsTable.isActive, true),
      ),
    );

  const byNormalizedTitle = new Map<string, TopicCandidate[]>();
  for (const row of rows) {
    const key = normalize(row.topicTitle);
    const list = byNormalizedTitle.get(key) ?? [];
    list.push(row);
    byNormalizedTitle.set(key, list);
  }
  return { byNormalizedTitle, all: rows };
}

function resolveTopic(
  title: string,
  byNormalizedTitle: Map<string, TopicCandidate[]>,
): { status: "matched"; candidate: TopicCandidate } | { status: "unmatched" } | { status: "ambiguous"; candidates: TopicCandidate[] } {
  const override = TITLE_OVERRIDES[title];
  const key = normalize(override ?? title);
  const candidates = byNormalizedTitle.get(key);
  if (!candidates || candidates.length === 0) return { status: "unmatched" };
  const distinctSubjects = new Set(candidates.map((c) => c.subject));
  if (distinctSubjects.size > 1) return { status: "ambiguous", candidates };
  return { status: "matched", candidate: candidates[0]! };
}

async function main() {
  logger.info(
    { mode: COMMIT ? "COMMIT" : "DRY RUN", totalRows: HISTORICAL_RECOVERY_SESSIONS.length },
    "Starting historical recovery session import",
  );

  const topicsByCampus = new Map<string, CampusTopics>();
  const campuses = [...new Set(HISTORICAL_RECOVERY_SESSIONS.map((r) => r.campus))];
  for (const campus of campuses) {
    const loaded = await loadCampusTopics(campus);
    topicsByCampus.set(campus, loaded);
    logger.info(
      { campus, distinctTitles: loaded.byNormalizedTitle.size, totalTopics: loaded.all.length },
      "Loaded recovery_topics for campus",
    );
  }

  let skipped = 0;
  let sessionsCreated = 0;
  let sessionsUpdated = 0;
  let topicsMatched = 0;
  const unmatched: string[] = [];
  const ambiguous: string[] = [];
  const flagged: string[] = [];
  const subjectMismatches: string[] = [];

  for (const row of HISTORICAL_RECOVERY_SESSIONS) {
    const rowLabel = `${row.campus} / ${row.instructorName} / ${row.scheduledDate}`;

    if (row.flagForReview) {
      flagged.push(`${rowLabel} -- ${row.flagReason ?? "flagged for review"}`);
    }

    if (row.skip) {
      skipped++;
      logger.info({ row: rowLabel, reason: row.skipReason }, "SKIP (not delivered)");
      continue;
    }

    const campusTopics = topicsByCampus.get(row.campus)!;
    const resolved = row.topics.map((title) => ({
      title,
      result: resolveTopic(title, campusTopics.byNormalizedTitle),
    }));

    const matchedTopics = resolved.filter(
      (r): r is { title: string; result: { status: "matched"; candidate: TopicCandidate } } =>
        r.result.status === "matched",
    );
    const unmatchedTopics = resolved.filter((r) => r.result.status === "unmatched");
    const ambiguousTopics = resolved.filter((r) => r.result.status === "ambiguous");

    for (const u of unmatchedTopics) {
      const suggestions = suggestClosestTitles(u.title, campusTopics.all)
        .map((s) => `"${s.title}" (${s.subject}, ${Math.round(s.score * 100)}%)`)
        .join("  |  ");
      unmatched.push(`${rowLabel} -- "${u.title}"  =>  closest: ${suggestions}`);
    }
    for (const a of ambiguousTopics) {
      const cand = (a.result as { status: "ambiguous"; candidates: TopicCandidate[] }).candidates;
      ambiguous.push(
        `${rowLabel} -- "${a.title}" matches multiple subjects: ${cand
          .map((c) => c.subject)
          .join(", ")}`,
      );
    }

    if (matchedTopics.length === 0) {
      logger.warn({ row: rowLabel }, "No topics resolved for this row -- nothing to write");
      continue;
    }

    const distinctSubjects = new Set(matchedTopics.map((t) => t.result.candidate.subject));
    if (distinctSubjects.size > 1) {
      subjectMismatches.push(
        `${rowLabel} -- matched topics span multiple subjects: ${[...distinctSubjects].join(", ")} (sheet said "${row.sheetSubject}")`,
      );
      logger.warn(
        { row: rowLabel, subjects: [...distinctSubjects] },
        "Matched topics span more than one subject -- skipping this row, needs manual review",
      );
      continue;
    }
    const resolvedSubject = [...distinctSubjects][0]!;

    logger.info(
      {
        row: rowLabel,
        sheetSubject: row.sheetSubject,
        resolvedSubject,
        matched: matchedTopics.length,
        unmatched: unmatchedTopics.length,
      },
      "Row resolved",
    );

    if (!COMMIT) continue;

    const isBackup = /backup instructor/i.test(row.remarks);

    await db.transaction(async (tx) => {
      const existing = await tx
        .select({ id: recoverySessionsTable.id })
        .from(recoverySessionsTable)
        .where(
          and(
            eq(recoverySessionsTable.campus, row.campus),
            eq(recoverySessionsTable.instructorName, row.instructorName),
            eq(recoverySessionsTable.scheduledDate, row.scheduledDate),
          ),
        )
        .limit(1);

      const values = {
        campus: row.campus,
        subject: resolvedSubject,
        section: null,
        instructorName: row.instructorName,
        instructorType: isBackup ? ("backup" as const) : ("unknown" as const),
        isBackupInstructor: isBackup,
        scheduledDate: row.scheduledDate,
        startTime: row.startTime,
        endTime: row.endTime,
        status: "conducted" as const,
        remarks: row.remarks,
        qaReportUrls: row.qaReportUrls,
        reportedAt: new Date(),
      };

      let sessionId: string;
      if (existing[0]) {
        sessionId = existing[0].id;
        await tx
          .update(recoverySessionsTable)
          .set({ ...values, updatedAt: new Date() })
          .where(eq(recoverySessionsTable.id, sessionId));
        sessionsUpdated++;
      } else {
        const inserted = await tx
          .insert(recoverySessionsTable)
          .values(values)
          .returning({ id: recoverySessionsTable.id });
        sessionId = inserted[0]!.id;
        sessionsCreated++;
      }

      for (const [i, t] of matchedTopics.entries()) {
        const topicId = t.result.candidate.id;

        await tx
          .insert(sessionTopicsTable)
          .values({
            sessionId,
            topicId,
            wasCovered: true,
            orderInSession: i,
          })
          .onConflictDoUpdate({
            target: [sessionTopicsTable.sessionId, sessionTopicsTable.topicId],
            set: { wasCovered: true },
          });

        const existingProgress = await tx
          .select({ id: recoveryProgressTable.id })
          .from(recoveryProgressTable)
          .where(
            and(
              eq(recoveryProgressTable.campus, row.campus),
              eq(recoveryProgressTable.subject, resolvedSubject),
              sql`${recoveryProgressTable.section} is null`,
              eq(recoveryProgressTable.topicId, topicId),
            ),
          )
          .limit(1);

        if (existingProgress[0]) {
          await tx
            .update(recoveryProgressTable)
            .set({ status: "completed", completedAt: new Date(row.scheduledDate), updatedAt: new Date() })
            .where(eq(recoveryProgressTable.id, existingProgress[0].id));
        } else {
          await tx.insert(recoveryProgressTable).values({
            campus: row.campus,
            subject: resolvedSubject,
            section: null,
            topicId,
            status: "completed",
            completedAt: new Date(row.scheduledDate),
          });
        }

        topicsMatched++;
      }
    });
  }

  logger.info(
    {
      mode: COMMIT ? "COMMIT" : "DRY RUN",
      skipped,
      sessionsCreated,
      sessionsUpdated,
      topicsMatched,
      unmatchedCount: unmatched.length,
      ambiguousCount: ambiguous.length,
      subjectMismatchCount: subjectMismatches.length,
      flaggedCount: flagged.length,
    },
    "Import finished",
  );

  if (flagged.length) {
    logger.warn({ flagged }, "Rows flagged for manual review");
  }
  if (unmatched.length) {
    logger.warn({ unmatched }, "Topics that did not match any recovery_topics row -- add a TITLE_OVERRIDES entry or fix the topic title");
  }
  if (ambiguous.length) {
    logger.warn({ ambiguous }, "Topics that matched more than one subject -- needs a TITLE_OVERRIDES entry or a more specific title");
  }
  if (subjectMismatches.length) {
    logger.warn({ subjectMismatches }, "Rows where matched topics span multiple subjects -- skipped, needs manual review");
  }

  if (!COMMIT) {
    logger.info("This was a DRY RUN -- nothing was written. Re-run with --commit once the report above looks right.");
  }

  process.exit(0);
}

main().catch((err) => {
  logger.error({ err }, "Historical recovery session import failed");
  process.exit(1);
});
