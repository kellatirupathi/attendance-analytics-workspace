import assert from "node:assert/strict";
import { test } from "node:test";
import { checkQuizAnswer, getQuizQuestions, publicQuestions, quizDoneFor, signQuizDone } from "./spiQuiz.js";


test("the quiz has 10 valid questions and the browser copy has no answers", async () => {
  const all = await getQuizQuestions();
  assert.equal(all.length, 10);
  for (const q of all) {
    assert.ok(q.correct in q.options, `${q.id} correct option exists`);
    assert.ok(q.explanation.length > 0, `${q.id} has an explanation`);
  }
  const text = JSON.stringify(await publicQuestions());
  assert.ok(!text.includes("correct"));
  assert.ok(!text.includes("explanation"));
});

test("answers are checked on the server", async () => {
  const q1 = (await getQuizQuestions())[0]!;
  const right = await checkQuizAnswer(q1.id, q1.correct);
  assert.equal(right?.correct, true);
  const wrongKey = Object.keys(q1.options).find((k) => k !== q1.correct)!;
  const wrong = await checkQuizAnswer(q1.id, wrongKey);
  assert.equal(wrong?.correct, false);
  assert.equal(wrong?.correctOption, q1.correct);
  assert.equal(await checkQuizAnswer("nope", "A"), null);
  assert.equal(await checkQuizAnswer(q1.id, "Z"), null);
});

test("the done cookie names only its own student", () => {
  const token = signQuizDone("abc123");
  assert.equal(quizDoneFor(token, "abc123"), true);
  assert.equal(quizDoneFor(token, "other"), false);
  assert.equal(quizDoneFor(undefined, "abc123"), false);
  assert.equal(quizDoneFor(`${token}x`, "abc123"), false);
});
