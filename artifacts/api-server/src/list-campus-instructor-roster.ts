/**
 * Read-only diagnostic: prints the active BigQuery `niat_instructor_details`
 * roster for one campus (plus every other active instructor whose name is
 * even loosely similar, in case the real match is a backup instructor from
 * another campus) -- so a human can eyeball which real instructor a
 * historical recovery session's nickname/first-name actually refers to
 * before fixing it via the Incentive Tracker's "Fix instructor" action.
 *
 * Nothing is written -- this only reads and prints.
 *
 *   pnpm --filter @workspace/api-server run list:instructor-roster -- --campus="Chaitanya Deemed-to-be University"
 *
 * Optionally narrow to names that loosely match one or more of the
 * unresolved historical names (comma-separated, case-insensitive substring
 * match either direction):
 *
 *   pnpm --filter @workspace/api-server run list:instructor-roster -- --campus="Chaitanya Deemed-to-be University" --names="Mir Nabeel,Likitha,Asif,Jaswanth,Raghavendar,Jammu Tejaswini,Gattadi Vikranth,Divya Partipati,Varun Chakravarthy,Vikram Aditya"
 */

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

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function tokenOverlap(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  if (na.includes(nb) || nb.includes(na)) return true;
  const tokensA = na.split(/\s+/).filter(Boolean);
  const tokensB = nb.split(/\s+/).filter(Boolean);
  return tokensA.some((t) => tokensB.includes(t));
}

function printTable(rows: CampusInstructorOption[]) {
  for (const r of rows) {
    logger.info(
      {
        name: r.name,
        employeeId: r.employeeId,
        category: r.category,
        role: r.role,
        institute: r.institute,
      },
      "instructor",
    );
  }
}

async function main() {
  const campus = argValue("campus");
  const namesArg = argValue("names");
  const namesToMatch = namesArg
    ? namesArg.split(",").map((n) => n.trim()).filter(Boolean)
    : [];

  if (!campus) {
    logger.error("Usage: --campus=\"<campus name exactly as in BigQuery institute_name>\" [--names=\"a,b,c\"]");
    process.exit(1);
  }

  logger.info({ campus }, "Fetching this campus's own active instructor roster");
  const campusRoster = await getCampusInstructorRoster(campus);
  logger.info({ count: campusRoster.length }, "Campus roster");
  printTable([...campusRoster].sort((a, b) => a.name.localeCompare(b.name)));

  logger.info("Fetching every active instructor across all campuses (for backup-instructor matches)");
  const allRoster = await getAllActiveInstructors();
  const others = allRoster.filter(
    (r) => !campusRoster.some((c) => c.instructorUserId === r.instructorUserId),
  );

  if (namesToMatch.length > 0) {
    logger.info({ namesToMatch }, "Filtering to loose matches against the unresolved names given");
    for (const name of namesToMatch) {
      const campusHits = campusRoster.filter((r) => tokenOverlap(r.name, name));
      const otherHits = others.filter((r) => tokenOverlap(r.name, name));
      logger.info(
        {
          unresolvedName: name,
          campusRosterMatches: campusHits.map((r) => `${r.name} (${r.employeeId}, ${r.institute})`),
          otherCampusMatches: otherHits.map((r) => `${r.name} (${r.employeeId}, ${r.institute})`),
        },
        campusHits.length + otherHits.length === 0 ? "No loose match found anywhere" : "Loose match candidates",
      );
    }
  } else {
    logger.info({ count: others.length }, "Every other active instructor (all campuses)");
    printTable([...others].sort((a, b) => a.name.localeCompare(b.name)));
  }

  logger.info("Diagnostic finished (read-only, nothing written)");
  process.exit(0);
}

main().catch((err) => {
  logger.error({ err }, "Diagnostic failed");
  process.exit(1);
});
