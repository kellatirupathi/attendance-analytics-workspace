/**
 * Read-only diagnostic: for one campus + subject, dumps every recovery_topics
 * row alongside every recovery_sessions row it's linked to via
 * recovery_session_topics (and each link's wasCovered flag), plus the
 * matching recovery_progress status. Writes nothing.
 *
 *   pnpm --filter @workspace/api-server run diagnose:recovery-dates -- --campus="Chaitanya Deemed-to-be University" --subject=English
 */

import { db } from "@workspace/db";
import {
  recoveryTopicsTable,
  recoverySessionsTable,
  sessionTopicsTable,
  recoveryProgressTable,
} from "@workspace/db";
import { and, eq, asc } from "drizzle-orm";
import { logger } from "./lib/logger.js";

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : undefined;
}

async function main() {
  const campus = argValue("campus");
  const subject = argValue("subject");
  if (!campus || !subject) {
    logger.error(
      { example: '--campus="Chaitanya Deemed-to-be University" --subject=English' },
      "Pass --campus and --subject",
    );
    process.exit(1);
  }

  const topics = await db
    .select({
      id: recoveryTopicsTable.id,
      sequenceNo: recoveryTopicsTable.sequenceNo,
      topicTitle: recoveryTopicsTable.topicTitle,
      isActive: recoveryTopicsTable.isActive,
    })
    .from(recoveryTopicsTable)
    .where(
      and(
        eq(recoveryTopicsTable.campus, campus),
        eq(recoveryTopicsTable.subject, subject),
      ),
    )
    .orderBy(asc(recoveryTopicsTable.sequenceNo));

  logger.info({ campus, subject, topicCount: topics.length }, "Loaded recovery_topics");

  for (const topic of topics) {
    const links = await db
      .select({
        sessionId: sessionTopicsTable.sessionId,
        wasCovered: sessionTopicsTable.wasCovered,
        orderInSession: sessionTopicsTable.orderInSession,
        sessionDate: recoverySessionsTable.scheduledDate,
        sessionStatus: recoverySessionsTable.status,
        instructorName: recoverySessionsTable.instructorName,
        sessionCreatedAt: recoverySessionsTable.createdAt,
      })
      .from(sessionTopicsTable)
      .innerJoin(
        recoverySessionsTable,
        eq(recoverySessionsTable.id, sessionTopicsTable.sessionId),
      )
      .where(eq(sessionTopicsTable.topicId, topic.id));

    const progress = await db
      .select({
        status: recoveryProgressTable.status,
        section: recoveryProgressTable.section,
        completedAt: recoveryProgressTable.completedAt,
      })
      .from(recoveryProgressTable)
      .where(eq(recoveryProgressTable.topicId, topic.id));

    if (links.length === 0 && progress.length === 0) continue; // untouched topic, skip for brevity

    logger.info(
      {
        seq: topic.sequenceNo,
        topic: topic.topicTitle,
        isActive: topic.isActive,
        sessionLinks: links.map((l) => ({
          sessionId: l.sessionId,
          date: l.sessionDate,
          status: l.sessionStatus,
          wasCovered: l.wasCovered,
          instructor: l.instructorName,
          sessionCreatedAt: l.sessionCreatedAt,
        })),
        progress: progress.map((p) => ({
          status: p.status,
          section: p.section,
          completedAt: p.completedAt,
        })),
      },
      "Topic detail",
    );
  }

  logger.info("Diagnostic finished (read-only, nothing written)");
  process.exit(0);
}

main().catch((err) => {
  logger.error({ err }, "Diagnostic failed");
  process.exit(1);
});
