/**
 * Seeds the recovery curriculum and the sessions already delivered.
 *
 *   pnpm tsx artifacts/api-server/src/seed-recovery.ts
 *
 * Idempotent: re-running updates existing rows rather than duplicating them.
 */

import { db } from "@workspace/db";
import {
  campusInstructorsTable,
  recoveryTopicsTable,
  recoveryProgressTable,
  recoverySessionsTable,
  sessionTopicsTable,
} from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import {
  CDU_CURRICULUM,
  CDU_CAMPUS,
  SUBJECT_TO_BIGQUERY,
} from "./seed/cdu-curriculum.js";
import { CDU_DELIVERED_SESSIONS } from "./seed/cdu-delivered-sessions.js";
import { CDU_CAMPUS_INSTRUCTORS } from "./seed/cdu-campus-instructors.js";
import { getSubjectSessions } from "./lib/queries.js";

type InstructorType = "campus" | "backup" | "unknown";

/**
 * Titles drift between the prod sequence and BigQuery. Normalising both sides
 * the same way catches most of it; the rest are listed in TITLE_OVERRIDES.
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

/** Verified mismatches that normalisation alone will not resolve. */
const TITLE_OVERRIDES: Record<string, string> = {
  // curriculum title → BigQuery session title
  "Introduction to Stack": "Introduction of Stack",
  "Introduction to Statistics & Datasets":
    "Practice session - Introduction to Statistics & Datasets",
  "Probability Distributions Implementation":
    "Probability Distributions Implementation Practice",
};

function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
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

function tokenSimilarity(left: string, right: string): number {
  const longest = Math.max(left.length, right.length);
  return longest === 0 ? 1 : 1 - levenshtein(left, right) / longest;
}

/**
 * Campus rosters use informal names while the recovery sheet often uses full
 * names. Exact shared tokens are strongest; spelling similarity is the
 * fallback. The persisted result can later be corrected by an administrator.
 */
function classifyInstructor(subject: string, instructorName: string): InstructorType {
  const deliveredTokens = nameTokens(instructorName);
  if (deliveredTokens.length === 0) return "unknown";

  const isCampus = CDU_CAMPUS_INSTRUCTORS.filter(
    (row) => row.campus === CDU_CAMPUS && row.subject === subject,
  ).some((row) => {
    const rosterTokens = nameTokens(row.instructorName);
    if (deliveredTokens.some((token) => rosterTokens.includes(token))) {
      return true;
    }
    return deliveredTokens.some((deliveredToken) =>
      rosterTokens.some(
        (rosterToken) =>
          tokenSimilarity(deliveredToken, rosterToken) >= 0.75,
      ),
    );
  });

  return isCampus ? "campus" : "backup";
}

async function seedCampusInstructors() {
  console.log(
    `Seeding ${CDU_CAMPUS_INSTRUCTORS.length} campus instructors for ${CDU_CAMPUS}…`,
  );

  for (const instructor of CDU_CAMPUS_INSTRUCTORS) {
    await db
      .insert(campusInstructorsTable)
      .values(instructor)
      .onConflictDoUpdate({
        target: [
          campusInstructorsTable.campus,
          campusInstructorsTable.subject,
          campusInstructorsTable.instructorName,
        ],
        set: {
          sections: instructor.sections,
          isActive: true,
        },
      });
  }
}

async function seedCurriculum() {
  console.log(`Seeding ${CDU_CURRICULUM.length} lectures for ${CDU_CAMPUS}…`);

  // Pull BigQuery's session titles once per subject so we can resolve each
  // lecture to a stored exact string instead of matching at query time.
  const bqTitlesBySubject = new Map<string, Map<string, string>>();
  for (const [subject, bqSubject] of Object.entries(SUBJECT_TO_BIGQUERY)) {
    const sessions = await getSubjectSessions(
      { campuses: [CDU_CAMPUS], subjects: [] },
      { subject: bqSubject, campus: CDU_CAMPUS },
    );
    const lut = new Map<string, string>();
    for (const s of sessions) {
      const title = String(s.sessionTitle ?? "").trim();
      if (title) lut.set(normalize(title), title);
    }
    bqTitlesBySubject.set(subject, lut);
    console.log(`  ${subject}: ${lut.size} distinct BigQuery titles`);
  }

  let resolved = 0;
  const unresolved: string[] = [];

  for (const t of CDU_CURRICULUM) {
    const lut = bqTitlesBySubject.get(t.subject);
    const override = TITLE_OVERRIDES[t.topicTitle];
    const bqTitle =
      (override ? lut?.get(normalize(override)) : undefined) ??
      lut?.get(normalize(t.topicTitle)) ??
      null;

    if (bqTitle) resolved++;
    else unresolved.push(`${t.subject} #${t.sequenceNo} ${t.topicTitle}`);

    await db
      .insert(recoveryTopicsTable)
      .values({
        campus: t.campus,
        subject: t.subject,
        sequenceNo: t.sequenceNo,
        weekNo: t.weekNo,
        moduleName: t.moduleName,
        topicTitle: t.topicTitle,
        unitId: t.unitId,
        bigquerySessionTitle: bqTitle,
      })
      .onConflictDoUpdate({
        target: [
          recoveryTopicsTable.campus,
          recoveryTopicsTable.subject,
          recoveryTopicsTable.sequenceNo,
        ],
        set: {
          topicTitle: t.topicTitle,
          weekNo: t.weekNo,
          moduleName: t.moduleName,
          unitId: t.unitId,
          bigquerySessionTitle: bqTitle,
          updatedAt: new Date(),
        },
      });
  }

  console.log(`  resolved ${resolved}/${CDU_CURRICULUM.length} to BigQuery`);
  // Unresolved topics are usually just not taught yet — but a topic that HAS
  // been taught and still fails to resolve will silently report 0% attendance,
  // so list them rather than swallowing the problem.
  if (unresolved.length) {
    console.log(`  unresolved (not yet taught, or needs manual mapping):`);
    for (const u of unresolved) console.log(`    ${u}`);
  }
}

async function seedDeliveredSessions() {
  console.log(`Seeding ${CDU_DELIVERED_SESSIONS.length} delivered sessions…`);

  const topics = await db
    .select()
    .from(recoveryTopicsTable)
    .where(eq(recoveryTopicsTable.campus, CDU_CAMPUS));

  const byKey = new Map(
    topics.map((t) => [`${t.subject}::${normalize(t.topicTitle)}`, t]),
  );

  let sessionCount = 0;
  let topicCount = 0;

  for (const s of CDU_DELIVERED_SESSIONS) {
    // A session is identified by campus + subject + date, so re-running the
    // seed updates rather than duplicating.
    const existing = await db
      .select()
      .from(recoverySessionsTable)
      .where(
        and(
          eq(recoverySessionsTable.campus, CDU_CAMPUS),
          eq(recoverySessionsTable.subject, s.subject),
          eq(recoverySessionsTable.scheduledDate, s.scheduledDate),
        ),
      )
      .limit(1);

    const instructorType = classifyInstructor(s.subject, s.instructorName);
    const values = {
      campus: CDU_CAMPUS,
      subject: s.subject,
      section: null,
      instructorName: s.instructorName,
      isBackupInstructor: instructorType === "backup",
      instructorType,
      scheduledDate: s.scheduledDate,
      startTime: s.startTime,
      endTime: s.endTime,
      status: "conducted" as const,
      remarks: s.remarks,
      qaReportUrls: s.qaReportUrls,
      reportedAt: new Date(),
    };

    const session =
      existing[0] ??
      (await db.insert(recoverySessionsTable).values(values).returning())[0]!;

    if (existing[0]) {
      await db
        .update(recoverySessionsTable)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(recoverySessionsTable.id, session.id));
    }
    sessionCount++;

    for (const [i, title] of s.topics.entries()) {
      const topic = byKey.get(`${s.subject}::${normalize(title)}`);
      if (!topic) {
        console.warn(`  ! no curriculum match: ${s.subject} "${title}"`);
        continue;
      }

      await db
        .insert(sessionTopicsTable)
        .values({
          sessionId: session.id,
          topicId: topic.id,
          wasCovered: true,
          orderInSession: i,
        })
        .onConflictDoNothing();

      await db
        .insert(recoveryProgressTable)
        .values({
          campus: CDU_CAMPUS,
          subject: s.subject,
          section: null,
          topicId: topic.id,
          status: "completed",
          completedAt: new Date(s.scheduledDate),
        })
        .onConflictDoNothing();

      topicCount++;
    }
  }

  console.log(`  ${sessionCount} sessions, ${topicCount} topics recovered`);
}

async function main() {
  await seedCurriculum();
  await seedCampusInstructors();
  await seedDeliveredSessions();

  const [summary] = await db
    .select({
      topics: sql<number>`count(distinct ${recoveryTopicsTable.id})`,
      completed: sql<number>`count(distinct ${recoveryProgressTable.topicId}) filter (where ${recoveryProgressTable.status} = 'completed')`,
    })
    .from(recoveryTopicsTable)
    .leftJoin(
      recoveryProgressTable,
      eq(recoveryProgressTable.topicId, recoveryTopicsTable.id),
    )
    .where(eq(recoveryTopicsTable.campus, CDU_CAMPUS));

  console.log(
    `\nDone. ${summary?.topics ?? 0} topics seeded, ${summary?.completed ?? 0} marked recovered.`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});