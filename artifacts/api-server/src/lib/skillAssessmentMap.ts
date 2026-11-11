import { createHash } from "node:crypto";
import { db, skillAssessmentCourseMapTable } from "@workspace/db";
import { dbSnapshot } from "./dbSnapshot.js";

/**
 * Skill Assessment course → report course, from the skill_assessment_course_map table
 * (college, batch, semester, skill_assessment_course_name → report_course_name). The Skill Assessment data
 * has no semester_course_id and its course names are the assessment team's own codes (e.g.
 * BACKEND_DEVELOPMENT), so the link is kept by hand until a course id is added.
 *
 * Only rows with a semester, status "Mapped" and a report course are used (agreed 11 Nov 2026). Rows without
 * a semester are the list from before that date (old batch names that do not match the Skill Assessment
 * data); they stay in the table but are never used, so no mark is linked twice. "To confirm" rows (also the
 * ones the report sync adds for new SA courses) stay off the report until someone maps them.
 * Names match ignoring case and extra spaces. Re-read at most once a minute.
 */
const plain = (s: string | null | undefined) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const mapKey = (college: string, batch: string, semester: string, saCourse: string) =>
  [college, batch, semester, saCourse].map(plain).join("|");

export type SkillAssessmentMap = Map<string, string>;

export const getSkillAssessmentMap = dbSnapshot<SkillAssessmentMap>(
  "skillAssessmentMap",
  async () => {
    const rows = await db.select().from(skillAssessmentCourseMapTable);
    return skillAssessmentMapFrom(rows);
  },
  { value: new Map(), version: "none" },
);

/**
 * The map from table rows. The version comes from the mappings used only, so the daily refresh of the
 * counts and dates (students, main_sa_count, ...) does not make every report out of date.
 */
export function skillAssessmentMapFrom(
  rows: { college: string; batch: string; semester: string | null; skillAssessmentCourseName: string; reportCourseName: string | null; status: string | null }[],
): { value: SkillAssessmentMap; version: string } {
  const map: SkillAssessmentMap = new Map();
  for (const r of rows) {
    const report = r.reportCourseName?.trim();
    if (!report || !r.semester?.trim() || plain(r.status) !== "mapped") continue;
    map.set(mapKey(r.college, r.batch, r.semester, r.skillAssessmentCourseName), report);
  }
  const hash = createHash("sha1");
  for (const [key, report] of [...map].sort(([a], [b]) => a.localeCompare(b))) hash.update(`${key}=${report}\n`);
  return { value: map, version: `sa-map:${map.size}:${hash.digest("hex").slice(0, 12)}` };
}

/** The report course a Skill Assessment course belongs to at this college, batch and semester; null when not mapped. */
export function reportCourseIn(map: SkillAssessmentMap, college: string, batch: string, semester: string, saCourse: string): string | null {
  return map.get(mapKey(college, batch, semester, saCourse)) ?? null;
}
