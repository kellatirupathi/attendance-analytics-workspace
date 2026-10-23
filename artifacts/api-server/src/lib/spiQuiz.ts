import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import jwt from "jsonwebtoken";
import { dbSnapshot, rowsVersion } from "./dbSnapshot.js";

/**
 * The SPI quick quiz a student takes before the report opens (10 multiple-choice questions).
 *
 * Questions come from the spi_quiz_questions table (active rows, in position order), re-read at
 * most once a minute, so editing a row changes the quiz without a code change. SPI_QUIZ_PATH (a
 * JSON file, used by the tests) replaces the table when it is set.
 * The browser never receives the right answer up front: it asks the server after each pick.
 * Finishing the quiz sets a signed cookie for that student; until it is set, the scorecard
 * stays locked for a student login (staff are never gated).
 */
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

/** Keeps only well-formed questions: an id, a question, at least two options and a correct option among them. */
function cleanQuestions(list: Partial<QuizQuestion>[]): QuizQuestion[] {
  const out: QuizQuestion[] = [];
  for (const q of list) {
    const ok =
      typeof q.id === "string" &&
      typeof q.question === "string" &&
      q.options &&
      typeof q.correct === "string" &&
      q.correct in q.options &&
      Object.keys(q.options).length >= 2;
    if (!ok) continue;
    out.push({
      id: q.id as string,
      topic: typeof q.topic === "string" ? q.topic : "",
      question: q.question as string,
      options: q.options as Record<string, string>,
      correct: q.correct as string,
      explanation: Array.isArray(q.explanation) ? q.explanation.map(String) : [],
    });
  }
  return out;
}

const fromDb = dbSnapshot<QuizQuestion[]>(
  "spiQuiz",
  async () => {
    const { db, spiQuizQuestionsTable } = await import("@workspace/db");
    const rows = (await db.select().from(spiQuizQuestionsTable)).filter((r) => r.isActive).sort((a, b) => a.position - b.position);
    return {
      value: cleanQuestions(rows.map((r) => ({ ...r, topic: r.topic ?? "" }))),
      version: rowsVersion("quiz", rows),
    };
  },
  { value: [], version: "none" },
);

export async function getQuizQuestions(): Promise<QuizQuestion[]> {
  const file = process.env["SPI_QUIZ_PATH"]?.trim();
  if (file) {
    const full = path.resolve(file);
    if (!existsSync(full)) return [];
    const json = JSON.parse(readFileSync(full, "utf8")) as { questions?: Partial<QuizQuestion>[] };
    return cleanQuestions(json.questions ?? []);
  }
  return (await fromDb()).value;
}

/** What the browser may see before answering: no correct option, no explanation. */
export async function publicQuestions() {
  return (await getQuizQuestions()).map(({ id, topic, question, options }) => ({ id, topic, question, options }));
}

export async function checkQuizAnswer(questionId: string, option: string) {
  const q = (await getQuizQuestions()).find((item) => item.id === questionId);
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
