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
// Weights are the real credits for S-001's semester_course_ids (config/course-credits.json).
const subjects = (
  [
    ["Operating Systems", 2],
    ["Probability and Statistics", 3],
    ["Logical Reasoning and Analytical Skills", 2],
    ["Advanced Communication Skills", 2],
    ["AI For Finanace", 2],
    ["Design and Analysis of Algorithms", 5],
    ["Back End Development", 5],
  ] as const
).map(([subjectTitle, weight]) => ({ subjectTitle, present: 10, total: 10, weight }));

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

test("per-course scores and weighted SPI (§3.3)", () => {
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
  // Σ (points × weight) = 0·3 + 9·2 + 0·2 + 0·2 + 0·5 + 8·5 = 58; Σ weights = 19 (Operating Systems has no score).
  assert.equal(card.totalWeightedPoints, 58);
  assert.equal(card.totalWeight, 19);
  assert.equal(card.scoredCourses, 6);
  assert.equal(card.spi, 3.05);
  assert.equal(course("Back End Development").weightedPoints, 40);
  assert.equal(course("Operating Systems").weightedPoints, null);
});

test("Skill Debt lists F courses with the parts below 50%", () => {
  const daa = card.skillDebt.find((d) => d.name === "Design and Analysis of Algorithms");
  assert.deepEqual(daa, { name: "Design and Analysis of Algorithms", weight: 5, courseScore: 25.96, level: "F", lowParts: [{ kind: "module", avgPct: 16.3 }] });
  assert.equal(card.skillDebt.length, 4);
});

test("courses in the removed list are left off the report (Intro To NIAT everywhere, Universal Human Values at Sushant)", () => {
  const subjects = [
    { subjectTitle: "Intro To NIAT", present: 0, total: 0, weight: 0 },
    { subjectTitle: "introduction  to NIAT", present: 4, total: 4, weight: 0 },
    { subjectTitle: "Universal Human Values", present: 3, total: 4, weight: 0 },
    { subjectTitle: "Back End Development", present: 8, total: 10, weight: 5 },
  ];
  const everywhere = ["intro to niat", "introduction to niat"];
  const atSushant = buildScorecard({ studentId: "x", studentName: "x" }, subjects, [], new Set([...everywhere, "universal human values"]));
  assert.deepEqual(atSushant.courses.map((c) => c.name), ["Back End Development"]);
  assert.equal(atSushant.attendance.held, 10);
  const elsewhere = buildScorecard({ studentId: "x", studentName: "x" }, subjects, [], new Set(everywhere));
  assert.deepEqual(elsewhere.courses.map((c) => c.name), ["Universal Human Values", "Back End Development"]);
});

test("a course only planned (no attendance, no quiz held, no instructor) is left off the report", () => {
  const rows = [raw("Web", "CLASSROOM_QUIZ", 10, 5, 60, "Web Aplication Development")].map(toStudentQuizCourseRow);
  const sc = buildScorecard(
    { studentId: "x", studentName: "x" },
    [
      // NRI's Developer Tools Tab: on the schedule, nothing held, no instructor → hidden.
      { subjectTitle: "Developer Tools Tab", present: 0, total: 0, weight: 2, hasInstructor: false },
      // Instructor assigned but not started yet → stays (Awaited).
      { subjectTitle: "Applied Physics", present: 0, total: 0, weight: 2, hasInstructor: true },
      // Instructor unknown (not on the schedule) → stays.
      { subjectTitle: "Old Course", present: 0, total: 0, weight: 2 },
      // Quizzes held, no instructor on the schedule → stays.
      { subjectTitle: "Web Aplication Development", present: 0, total: 0, weight: 5, hasInstructor: false },
      // Attendance held, no instructor on the schedule → stays.
      { subjectTitle: "Maths for CSE", present: 8, total: 10, weight: 2, hasInstructor: false },
    ],
    rows,
  );
  assert.deepEqual(sc.courses.map((c) => c.name).sort(), ["Applied Physics", "Maths for CSE", "Old Course", "Web Aplication Development"]);
});

test("a course with no weight (Not set) or weight 0 stays on the report but is left out of the SPI", () => {
  const rows = [
    raw("A", "CLASSROOM_QUIZ", 10, 10, 95, "Course A"),
    raw("B", "CLASSROOM_QUIZ", 10, 10, 55, "Course B"),
    raw("C", "CLASSROOM_QUIZ", 10, 10, 75, "Course C"),
  ].map(toStudentQuizCourseRow);
  const sc = buildScorecard(
    { studentId: "x", studentName: "x" },
    [
      { subjectTitle: "Course A", present: 1, total: 1, weight: 4 },
      { subjectTitle: "Course B", present: 1, total: 1, weight: null },
      { subjectTitle: "Course C", present: 1, total: 1, weight: 0 },
    ],
    rows,
  );
  assert.equal(sc.courses.length, 3);
  assert.equal(sc.scoredCourses, 1);
  assert.equal(sc.spi, 10);
  const none = buildScorecard({ studentId: "x", studentName: "x" }, [{ subjectTitle: "Course B", present: 1, total: 1, weight: null }], rows);
  assert.equal(none.spi, null);
});

test("attendance tier (§7.4) comes from the weakest course", () => {
  const tierOf = (pcts: [number, number][]) =>
    buildScorecard({ studentId: "x", studentName: "x" }, pcts.map(([p, t], i) => ({ subjectTitle: `C${i}`, present: p, total: t, weight: 1 })), []).attendance.tier;
  assert.equal(tierOf([[9, 10], [8, 10]]), "eligible");
  assert.equal(tierOf([[9, 10], [27, 40]]), "recovery_eligible");
  assert.equal(tierOf([[9, 10], [11, 20]]), "at_risk");
  assert.equal(tierOf([[10, 10], [4, 10]]), "ineligible");
});

test("overall attendance is all courses together (same as the Student Directory)", () => {
  const overall = buildScorecard(
    { studentId: "a8bfece2-8539-4cc2-9db8-0e312c9beb17", studentName: "Adityaraj Ghorpade" },
    [
      ["Advanced Communication Skills", 35, 50],
      ["AI For Finanace", 36, 44],
      ["Back End Development", 42, 49],
      ["Design and Analysis of Algorithms", 64, 91],
      ["Logical Reasoning and Analytical Skills", 27, 40],
      ["Operating Systems", 42, 54],
      ["Probability and Statistics", 41, 54],
    ].map(([subjectTitle, present, total]) => ({ subjectTitle: String(subjectTitle), present: Number(present), total: Number(total) })),
    [],
  ).attendance;
  assert.deepEqual(
    { overallPct: overall.overallPct, present: overall.present, held: overall.held, lowestPct: overall.lowestPct, coursesBelow: overall.coursesBelow },
    { overallPct: 75.1, present: 287, held: 382, lowestPct: 67.5, coursesBelow: 5 },
  );
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
