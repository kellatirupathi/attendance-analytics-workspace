import { courseWeight, getCourseCredits } from "./courseCredits.js";
import {
  getQuizCourseRows,
  getReportIdentities,
  getSkillAssessmentRows,
  getStudentSubjects,
  getSubjectsByStudent,
  type ReportIdentity,
  type StudentSkillAssessment,
  type SubjectAttendance,
} from "./queries.js";
import { getRemovedCourses, removedCoursesIn } from "./reportRemovedCourses.js";
import { getSkillAssessmentMap, reportCourseIn } from "./skillAssessmentMap.js";
import {
  buildScorecard,
  type SkillAssessmentRow,
  type StudentQuizCourseRow,
  type StudentScorecard,
} from "./spiScorecardRules.js";

export type { StudentScorecard } from "./spiScorecardRules.js";

type ReportConfig = {
  credits: Awaited<ReturnType<typeof getCourseCredits>>;
  saMap: Awaited<ReturnType<typeof getSkillAssessmentMap>>;
  removed: Awaited<ReturnType<typeof getRemovedCourses>>;
};

async function getReportConfig(): Promise<ReportConfig> {
  const [credits, saMap, removed] = await Promise.all([getCourseCredits(), getSkillAssessmentMap(), getRemovedCourses()]);
  return { credits, saMap, removed };
}

/** Changes when course credits, the SA map or removed courses change; reports built before are out of date. */
export async function reportConfigVersion(): Promise<string> {
  const { credits, saMap, removed } = await getReportConfig();
  return `${credits.version}:${saMap.version}:${removed.version}`;
}

/** One student's report from their loaded data: applies the rules in spiScorecardRules.ts. */
function assembleScorecard(
  identity: ReportIdentity,
  subjects: SubjectAttendance[],
  quizRows: StudentQuizCourseRow[],
  skillAssessments: StudentSkillAssessment[],
  { credits, saMap, removed }: ReportConfig,
): StudentScorecard {
  const weighted = subjects.map((subject) => ({ ...subject, weight: courseWeight(credits, subject.courseIds ?? []) }));
  // Skill Assessments carry the assessment team's course codes; the skill_assessment_course_map
  // table links them to report courses. Unmapped ones stay off the report until the map has them.
  const skillRows: SkillAssessmentRow[] = skillAssessments.flatMap((sa) => {
    const course = reportCourseIn(saMap.value, sa.college, sa.batch, sa.saCourse);
    return course ? [{ course, held: sa.held, attempted: sa.attempted, scorePct: sa.scorePct }] : [];
  });
  return buildScorecard(identity, weighted, quizRows, removedCoursesIn(removed.value, identity.instituteName), skillRows);
}

export interface BuiltReport {
  identity: ReportIdentity;
  scorecard: StudentScorecard;
}

/** One student's report, live from BigQuery; null when the student has no current-semester rows. */
export async function buildStudentReport(studentId: string): Promise<BuiltReport | null> {
  const [identities, subjects, quizRows, skillAssessments, config] = await Promise.all([
    getReportIdentities({ studentId }),
    getStudentSubjects(studentId),
    getQuizCourseRows({ studentId }),
    getSkillAssessmentRows({ studentId }),
    getReportConfig(),
  ]);
  const identity = identities[0];
  if (!identity) return null;
  const scorecard = assembleScorecard(
    identity,
    subjects,
    [...quizRows.values()].flat(),
    [...skillAssessments.values()].flat(),
    config,
  );
  return { identity, scorecard };
}

/** The student SPI scorecard, live from BigQuery; null when the student has no current-semester rows. */
export async function getStudentScorecard(studentId: string): Promise<StudentScorecard | null> {
  return (await buildStudentReport(studentId))?.scorecard ?? null;
}

/** Every current-semester student's scorecard in one pass: the same queries as the live report, for all students. */
export async function buildAllScorecards(): Promise<BuiltReport[]> {
  const [identities, subjects, quizRows, skillAssessments, config] = await Promise.all([
    getReportIdentities("all"),
    getSubjectsByStudent(),
    getQuizCourseRows("all"),
    getSkillAssessmentRows("all"),
    getReportConfig(),
  ]);
  return identities.map((identity) => ({
    identity,
    scorecard: assembleScorecard(
      identity,
      subjects.get(identity.studentKey) ?? [],
      quizRows.get(identity.studentKey) ?? [],
      skillAssessments.get(identity.studentKey) ?? [],
      config,
    ),
  }));
}
