import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import jwt from "jsonwebtoken";

/**
 * The SPI quick quiz a student takes before the report opens (10 multiple-choice questions).
 *
 * Questions come from config/spi-quiz.json (or SPI_QUIZ_PATH) and are re-read when the file changes.
 * The browser never receives the right answer up front: it asks the server after each pick.
 * Finishing the quiz sets a signed cookie for that student; until it is set, the scorecard
 * stays locked for a student login (staff are never gated).
 */
const FILE_NAME = "spi-quiz.json";
export const QUIZ_COOKIE_NAME = "niat_quiz";
const QUIZ_COOKIE_MAX_AGE = 180 * 24 * 60 * 60 * 1000;
const QUIZ_AUDIENCE = "spi-quiz";
const JWT_SECRET = process.env["JWT_SECRET"] ?? "dev-secret-change-me";

export interface QuizQuestion {
  id: string;
  topic: string;
  question: string;
  options: Record<string, string>;
  correct: string;
  explanation: string[];
}

function candidatePaths(): string[] {
  const fromEnv = process.env["SPI_QUIZ_PATH"]?.trim();
  if (fromEnv) return [path.resolve(fromEnv)];
  return [
    path.resolve(process.cwd(), "config", FILE_NAME),
    path.resolve(process.cwd(), "artifacts", "api-server", "config", FILE_NAME),
  ];
}

let cached: { key: string; questions: QuizQuestion[] } | null = null;

export function getQuizQuestions(): QuizQuestion[] {
  const file = candidatePaths().find((candidate) => existsSync(candidate));
  if (!file) return [];
  try {
    const key = `${file}:${statSync(file).mtimeMs}`;
    if (cached?.key === key) return cached.questions;
    const json = JSON.parse(readFileSync(file, "utf8")) as { questions?: Partial<QuizQuestion>[] };
    const questions: QuizQuestion[] = [];
    for (const q of json.questions ?? []) {
      const ok =
        typeof q.id === "string" &&
        typeof q.question === "string" &&
        q.options &&
        typeof q.correct === "string" &&
        q.correct in q.options &&
        Object.keys(q.options).length >= 2;
      if (!ok) continue;
      questions.push({
        id: q.id as string,
        topic: typeof q.topic === "string" ? q.topic : "",
        question: q.question as string,
        options: q.options as Record<string, string>,
        correct: q.correct as string,
        explanation: Array.isArray(q.explanation) ? q.explanation.map(String) : [],
      });
    }
    cached = { key, questions };
    return questions;
  } catch (err) {
    console.error(`[spiQuiz] could not read ${file}; keeping the last good questions`, err);
    return cached?.questions ?? [];
  }
}

/** What the browser may see before answering: no correct option, no explanation. */
export function publicQuestions() {
  return getQuizQuestions().map(({ id, topic, question, options }) => ({ id, topic, question, options }));
}

export function checkQuizAnswer(questionId: string, option: string) {
  const q = getQuizQuestions().find((item) => item.id === questionId);
  if (!q || !(option in q.options)) return null;
  return { correct: option === q.correct, correctOption: q.correct, explanation: q.explanation };
}

export function signQuizDone(studentKey: string): string {
  return jwt.sign({ kind: "quiz", sid: studentKey }, JWT_SECRET, {
    algorithm: "HS256",
    audience: QUIZ_AUDIENCE,
    expiresIn: "180d",
  });
}

/** True when the cookie says this student finished the quiz. */
export function quizDoneFor(token: string | undefined, studentKey: string): boolean {
  if (!token) return false;
  try {
    const p = jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"], audience: QUIZ_AUDIENCE }) as {
      kind?: string;
      sid?: string;
    };
    return p.kind === "quiz" && p.sid === studentKey;
  } catch {
    return false;
  }
}

export const quizCookieMaxAge = QUIZ_COOKIE_MAX_AGE;
