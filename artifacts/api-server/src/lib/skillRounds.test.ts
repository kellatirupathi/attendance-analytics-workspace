import assert from "node:assert/strict";
import { test } from "node:test";
import { campusRows, filterSkillRounds, quizKpis, skillHeldBySemester, skillRoundsHeld, type QuizCoverageModel, type QuizRow, type SkillRound } from "./quizCoverageModel.js";

const round = (over: Partial<SkillRound>): SkillRound => ({ campus: "A", batch: "A B1", semester: "Semester 1", section: "S-01", subject: "Maths", category: "MATH", round: "SEM_1_SKILL_1_MAIN", ...over });
const row = (over: Partial<QuizRow>): QuizRow => ({
  campus: "A", section: "S-01", semester: "Semester 1", batch: "A B1", studentId: "s1", studentName: null, subject: "Maths", category: "MATH",
  scheduled: 2, completed: 1, avgScore: 50, points: 50, weight: 1, ...over,
});

const model: QuizCoverageModel = {
  mode: "skill",
  plan: [],
  rows: [row({}), row({ studentId: "s2", completed: 2 }), row({ campus: "B", batch: "B B1", semester: "Semester 3", studentId: "s3", subject: "Python", category: "TECH" })],
  skillRounds: [
    // College A, round 1 held in two sections and two courses → still 1.
    round({}), round({ section: "S-02" }), round({ subject: "English", category: "ENGLISH" }),
    round({ round: "SEM_1_SKILL_2_MAIN" }),
    // College B, Semester 3, two rounds; another batch at B in Semester 1.
    round({ campus: "B", batch: "B B1", semester: "Semester 3", subject: "Python", category: "TECH", round: "SEM_3_SKILL_1_MAIN" }),
    round({ campus: "B", batch: "B B1", semester: "Semester 3", subject: "Python", category: "TECH", round: "SEM_3_SKILL_2_MAIN" }),
    round({ campus: "B", batch: "B B2", semester: "Semester 1", round: "SEM_1_SKILL_1_MAIN" }),
  ],
  // C has students but no Skill Assessment held.
  skillColleges: [
    { campus: "A", batch: "A B1", semester: "Semester 1" },
    { campus: "B", batch: "B B1", semester: "Semester 3" },
    { campus: "B", batch: "B B2", semester: "Semester 1" },
    { campus: "C", batch: "C B1", semester: "Semester 1" },
  ],
};

test("held so far: college × round once, whatever the sections and courses; Mock and FSA never reach the model", () => {
  assert.equal(skillRoundsHeld(model.skillRounds!), 5); // A: 2, B: 3 (the same round name at B counts once per college)
  assert.deepEqual(skillHeldBySemester(model.skillRounds!), { "Semester 1": 3, "Semester 3": 2 });
  assert.equal(skillRoundsHeld([]), 0);
});

test("cards: held so far and colleges covered N of M follow the filters; student slots, participation and score unchanged", () => {
  const k = quizKpis(model, {});
  assert.equal(k.available, 5);
  assert.equal(k.collegesCovered, 2);
  assert.equal(k.collegesTotal, 3);
  assert.equal(k.scheduledSoFar, 6); // student slots: Σ held per student × course (as before)
  assert.equal(k.quizzesCompleted, 4);
  const onlyB = quizKpis(model, { colleges: ["B"] });
  assert.deepEqual([onlyB.available, onlyB.collegesCovered, onlyB.collegesTotal], [3, 1, 1]);
  const batch = quizKpis(model, { batches: ["B\tB B2"] });
  assert.deepEqual([batch.available, batch.collegesCovered, batch.collegesTotal], [1, 1, 1]);
  const subject = quizKpis(model, { subject: "English" });
  assert.equal(subject.available, 1); // only A's round 1 had English
  const noSa = quizKpis(model, { colleges: ["C"] });
  assert.deepEqual([noSa.available, noSa.collegesCovered, noSa.collegesTotal], [0, 0, 1]);
  const scoped = quizKpis(model, { scopeCampuses: ["A"] });
  assert.deepEqual([scoped.collegesCovered, scoped.collegesTotal], [1, 1]);
});

test("college table: Held = the college's assessments, split by semester; colleges add up to the card", () => {
  const rows = campusRows(model, {});
  const b = rows.find((r) => r.college === "B")!;
  assert.equal(b.scheduled, 3);
  assert.deepEqual(b.heldBySemester, { "Semester 3": 2, "Semester 1": 1 });
  assert.equal(rows.reduce((n, r) => n + r.scheduled, 0), quizKpis(model, {}).available);
  assert.deepEqual(filterSkillRounds(model, { semester: "Semester 3" }).map((r) => r.round), ["SEM_3_SKILL_1_MAIN", "SEM_3_SKILL_2_MAIN"]);
});

test("without round data (older copy) the cards keep the old count and show no colleges covered", () => {
  const old: QuizCoverageModel = { ...model, skillRounds: undefined, skillColleges: undefined };
  const k = quizKpis(old, {});
  assert.equal(k.collegesCovered, undefined);
  assert.equal(k.available, 4); // section × course, the most any student has: A S-01 Maths 2 + B S-01 Python 2
  assert.equal(campusRows(old, {})[0]!.heldBySemester, undefined);
});
