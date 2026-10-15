import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildScorecard,
  quizKind,
  toStudentQuizCourseRow,
  type RawQuizCourseRow,
} from "./spiScorecardRules.js";

/**
 * Aarya Jawadwar, A Dy Patil University, S-001, Semester 3 (user_id d88d6bc6ead6483cbf0fd563c1af49e3).
 * Rows from z_niat_students_classroom_and_module_quiz_details, shaped the way the BigQuery REST API
 * returns them (every value a string); attempted is already capped at the quizzes held.
 */
const raw = (
  courseTitle: string,
  unitType: string,
  conducted: number,
  attempted: number,
  avg: number | null,
  semesterCourseTitle: string,
): RawQuizCourseRow => ({
  semester_course_title: semesterCourseTitle,
  course_title: courseTitle,
  unit_type: unitType,
  conducted: String(conducted),
  attempted: String(attempted),
  avg_attempted: avg == null ? null : String(avg),
});

const quizRows = [
  raw("More NodeJS Concepts", "MODULE_QUIZ", 0, 0, null, "Back End Development"),
  raw("Quantitative Aptitude", "CLASSROOM_QUIZ", 0, 0, null, "Quantitative Aptitude"),
  raw("Design and Analysis of Algorithms", "MODULE_QUIZ", 3, 1, 49.0, "Design and Analysis of Algorithms"),
  raw("AI for Finance", "MODULE_QUIZ", 4, 1, 88.0, "AI For Finanace"),
  raw("Applied Communicative English", "MODULE_QUIZ", 4, 1, 80.0, "Advanced Communication Skills"),
  raw("Math for CSE", "MODULE_QUIZ", 5, 0, null, "Mathematics for Computer Science"),
  raw("Probability and Statistics(P&S)", "MODULE_QUIZ", 5, 1, 90.0, "Probability and Statistics"),
  raw("More NodeJS Concepts", "CLASSROOM_QUIZ", 6, 5, 86.0, "Back End Development"),
  raw("Intro to Generative AI", "MODULE_QUIZ", 8, 0, null, "Introduction to Generative AI"),
  raw("HTML & CSS", "MODULE_QUIZ", 8, 1, 98.89, "Web Application Development"),
  raw("Intro to Tech", "CLASSROOM_QUIZ", 12, 0, null, "Intro To NIAT"),
  raw("Math for CSE", "CLASSROOM_QUIZ", 20, 0, null, "Mathematics for Computer Science"),
  raw("Logical Reasoning", "CLASSROOM_QUIZ", 24, 24, 87.5, "Logical Reasoning and Analytical Skills"),
  raw("AI for Finance", "CLASSROOM_QUIZ", 26, 17, 83.33, "AI For Finanace"),
  raw("Probability and Statistics(P&S)", "CLASSROOM_QUIZ", 28, 20, 94.0, "Probability and Statistics"),
  raw("Intro to Generative AI", "CLASSROOM_QUIZ", 31, 20, 91.24, "Introduction to Generative AI"),
  raw("Design and Analysis of Algorithms", "CLASSROOM_QUIZ", 40, 32, 81.12, "Design and Analysis of Algorithms"),
  raw("HTML & CSS", "CLASSROOM_QUIZ", 63, 41, 77.12, "Web Application Development"),
].map(toStudentQuizCourseRow);

// S-001's Semester 3 courses (niat_instructor_section_and_course_mapping_details). Attendance is
// not under test here, so every course is at 100%.
const subjects = [
  "Operating Systems",
  "Probability and Statistics",
  "Logical Reasoning and Analytical Skills",
  "Advanced Communication Skills",
  "AI For Finanace",
  "Design and Analysis of Algorithms",
  "Back End Development",
].map((subjectTitle) => ({ subjectTitle, present: 10, total: 10 }));

const card = buildScorecard({ studentId: "d88d6bc6ead6483cbf0fd563c1af49e3", studentName: "Aarya Jawadwar" }, subjects, quizRows);
const course = (name: string) => {
  const found = card.courses.find((c) => c.name === name);
  assert.ok(found, `missing course ${name}`);
  return found;
};

test("unit type text decides the quiz type", () => {
  assert.equal(quizKind("CLASSROOM_QUIZ"), "classroom");
  assert.equal(quizKind("MODULE_QUIZ"), "module");
  // BigQuery returns BOOL as the string "false", which is truthy: never classify from a boolean column.
  assert.equal(toStudentQuizCourseRow(raw("x", "CLASSROOM_QUIZ", 1, 1, 50, "x")).kind, "classroom");
});

test("eligibility splits classroom and module quizzes", () => {
  assert.deepEqual(card.eligibility.classroom, { state: "not_met", attempted: 98, total: 124 });
  assert.deepEqual(card.eligibility.module, { state: "not_met", attempted: 4, total: 16 });
});

test("AI For Finance shows classroom and module separately", () => {
  const ai = course("AI For Finanace");
  assert.deepEqual(ai.classroom, { avgPct: 54.5, attempted: 17, total: 26 });
  assert.deepEqual(ai.module, { avgPct: 22, attempted: 1, total: 4 });
});

test("a quiz type with none held is not conducted yet", () => {
  assert.equal(course("Back End Development").module, null);
  assert.equal(course("Logical Reasoning and Analytical Skills").module, null);
  assert.equal(course("Advanced Communication Skills").classroom, null);
  const os = course("Operating Systems");
  assert.equal(os.classroom, null);
  assert.equal(os.module, null);
  assert.equal(os.courseScore, null);
});

test("per-course scores and SPI (rules unchanged)", () => {
  const expected: Record<string, [number, string, number]> = {
    "Probability and Statistics": [26.84, "F", 0],
    "Logical Reasoning and Analytical Skills": [87.5, "A", 9],
    "Advanced Communication Skills": [0, "F", 0],
    "AI For Finanace": [21.8, "F", 0],
    "Design and Analysis of Algorithms": [25.96, "F", 0],
    "Back End Development": [71.7, "B", 8],
  };
  for (const [name, [score, level, points]] of Object.entries(expected)) {
    const c = course(name);
    assert.deepEqual([c.courseScore, c.level, c.points], [score, level, points], name);
  }
  assert.equal(card.totalPoints, 17);
  assert.equal(card.scoredCourses, 6);
  assert.equal(card.spi, 2.83);
});

test("next steps count classroom and module quizzes separately", () => {
  assert.deepEqual(
    card.nextSteps.filter((s) => s.kind === "pending_classroom" || s.kind === "pending_module"),
    [
      { kind: "pending_classroom", count: 26 },
      { kind: "pending_module", count: 12 },
    ],
  );
});
