import { db, skillAssessmentCourseMapTable } from "@workspace/db";
import { dbSnapshot, rowsVersion } from "./dbSnapshot.js";

/**
 * Skill Assessment course → report course, from the skill_assessment_course_map table
 * (college, batch, skill_assessment_course_name → report_course_name). The Skill Assessment data
 * has no semester_course_id and its course names are the assessment team's own codes (e.g.
 * BACKEND_DEVELOPMENT), so the link is kept by hand until a course id is added. A row with a blank
 * report_course_name is not mapped yet and its scores stay off the report. Names match ignoring
 * case and extra spaces. Re-read at most once a minute.
 */
const plain = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const mapKey = (college: string, batch: string, saCourse: string) => [college, batch, saCourse].map(plain).join("|");

export type SkillAssessmentMap = Map<string, string>;

export const getSkillAssessmentMap = dbSnapshot<SkillAssessmentMap>(
  "skillAssessmentMap",
  async () => {
    const rows = await db.select().from(skillAssessmentCourseMapTable);
    const map: SkillAssessmentMap = new Map();
    for (const r of rows) {
      const report = r.reportCourseName?.trim();
      if (report) map.set(mapKey(r.college, r.batch, r.skillAssessmentCourseName), report);
    }
    return { value: map, version: rowsVersion("sa-map", rows) };
  },
  { value: new Map(), version: "none" },
);

/** The report course a Skill Assessment course belongs to at this college and batch; null when not mapped. */
export function reportCourseIn(map: SkillAssessmentMap, college: string, batch: string, saCourse: string): string | null {
  return map.get(mapKey(college, batch, saCourse)) ?? null;
}
