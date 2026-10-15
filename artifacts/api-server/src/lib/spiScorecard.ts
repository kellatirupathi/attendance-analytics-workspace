import { getStudentOverview, getStudentQuizCourseRows, getStudentSubjects } from "./queries.js";
import { buildScorecard, type StudentScorecard } from "./spiScorecardRules.js";

export type { StudentScorecard } from "./spiScorecardRules.js";

/** The student SPI scorecard: loads the data, then applies the rules in spiScorecardRules.ts. */
export async function getStudentScorecard(studentId: string): Promise<StudentScorecard | null> {
  const [overview, subjects, quizRows] = await Promise.all([
    getStudentOverview(studentId),
    getStudentSubjects(studentId),
    getStudentQuizCourseRows(studentId),
  ]);
  if (!overview) return null;
  return buildScorecard(overview, subjects, quizRows);
}
