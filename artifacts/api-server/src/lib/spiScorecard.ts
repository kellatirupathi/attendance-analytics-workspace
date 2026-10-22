import { courseWeight } from "./courseCredits.js";
import { getStudentOverview, getStudentQuizCourseRows, getStudentSkillAssessments, getStudentSubjects } from "./queries.js";
import { removedCoursesFor } from "./reportRemovedCourses.js";
import { reportCourseFor } from "./skillAssessmentMap.js";
import { buildScorecard, type SkillAssessmentRow, type StudentScorecard } from "./spiScorecardRules.js";

export type { StudentScorecard } from "./spiScorecardRules.js";

/** The student SPI scorecard: loads the data, then applies the rules in spiScorecardRules.ts. */
export async function getStudentScorecard(studentId: string): Promise<StudentScorecard | null> {
  const [overview, subjects, quizRows, skillAssessments] = await Promise.all([
    getStudentOverview(studentId),
    getStudentSubjects(studentId),
    getStudentQuizCourseRows(studentId),
    getStudentSkillAssessments(studentId),
  ]);
  if (!overview) return null;
  const weighted = subjects.map((subject) => ({ ...subject, weight: courseWeight(subject.courseIds ?? []) }));
  // Skill Assessments carry the assessment team's course codes; config/skill-assessment-course-map.csv
  // links them to report courses. Unmapped ones stay off the report until the map has them.
  const skillRows: SkillAssessmentRow[] = skillAssessments.flatMap((sa) => {
    const course = reportCourseFor(sa.college, sa.batch, sa.saCourse);
    return course ? [{ course, held: sa.held, attempted: sa.attempted, scorePct: sa.scorePct }] : [];
  });
  return buildScorecard(overview, weighted, quizRows, removedCoursesFor(overview.instituteName), skillRows);
}
