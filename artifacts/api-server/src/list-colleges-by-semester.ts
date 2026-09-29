/**
 * Read-only report: which colleges (institutes) currently have Semester 1
 * running, which have Semester 2, and which have both running at once
 * (multi-cohort campuses often do). Nothing is written.
 */

import { getInstituteDirectory } from "./lib/queries.js";
import { logger } from "./lib/logger.js";

function semesterNumbers(titles: string[]): number[] {
  const nums = new Set<number>();
  for (const title of titles) {
    const match = title.match(/\d+/);
    if (match) nums.add(Number(match[0]));
  }
  return [...nums].sort((a, b) => a - b);
}

async function main() {
  const institutes = await getInstituteDirectory({});

  const sem1Only: string[] = [];
  const sem2Only: string[] = [];
  const both: string[] = [];
  const other: { institute: string; currentSemesters: string[] }[] = [];

  for (const inst of institutes) {
    const nums = semesterNumbers(inst.currentSemesters);
    const has1 = nums.includes(1);
    const has2 = nums.includes(2);
    const onlyKnownNums = nums.every((n) => n === 1 || n === 2);

    if (has1 && has2) {
      both.push(inst.instituteName);
    } else if (has1 && onlyKnownNums) {
      sem1Only.push(inst.instituteName);
    } else if (has2 && onlyKnownNums) {
      sem2Only.push(inst.instituteName);
    } else {
      other.push({ institute: inst.instituteName, currentSemesters: inst.currentSemesters });
    }
  }

  logger.info({ count: sem1Only.length, colleges: sem1Only.sort() }, "Currently Semester 1 only");
  logger.info({ count: sem2Only.length, colleges: sem2Only.sort() }, "Currently Semester 2 only");
  logger.info({ count: both.length, colleges: both.sort() }, "Currently BOTH Semester 1 and 2");
  if (other.length > 0) {
    logger.info(
      { count: other.length, colleges: other },
      "Other (current semester didn't parse to 1 or 2 -- check spelling)",
    );
  }
  logger.info({ totalInstitutes: institutes.length }, "Report finished (read-only, nothing written)");
  process.exit(0);
}

main().catch((err) => {
  logger.error({ err }, "Report failed");
  process.exit(1);
});
