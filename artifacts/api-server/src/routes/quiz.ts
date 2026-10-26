import { Router } from "express";
import { allLimits, perNetworkLimit, perStudentLimit } from "../lib/rateLimits.js";
import { getSessionFromRequest } from "../lib/auth.js";
import {
  QUIZ_COOKIE_NAME,
  checkQuizAnswer,
  publicQuestions,
  quizCookieMaxAge,
  quizDoneFor,
  signQuizDone,
} from "../lib/spiQuiz.js";
import { validateStudentId } from "../lib/bigquery.js";
import { studentCookieOptions, studentKey } from "../lib/testStudents.js";
import {
  finishedScore,
  quizFinished,
  quizProgress,
  recordAnswer,
  recordFinished,
  recordOpened,
  recordStarted,
} from "../lib/quizTracking.js";

const router = Router();

// About 12 calls per quiz: 120 a minute per student per network, 6,000 per network (campus Wi-Fi).
const quizPerStudent = perStudentLimit(120, (req) => req.query?.["student"] ?? (req.body as { student?: unknown } | undefined)?.student);
const quizPerNetwork = perNetworkLimit(6000);
const quizLimiter = allLimits(quizPerNetwork, quizPerStudent);

/**
 * Report links are public (/spi/{student_uid}), so the quiz belongs to the student in the
 * link: `student` in the query (GET) or body (POST). A staff session previews the quiz and saves nothing.
 */
async function whoIsAsking(req: Parameters<typeof getSessionFromRequest>[0]): Promise<{ student: string | null; staff: boolean }> {
  const raw = (req.query?.["student"] ?? (req.body as { student?: unknown } | undefined)?.student) as unknown;
  const staff = Boolean(getSessionFromRequest(req));
  const valid = typeof raw === "string" && validateStudentId.test(raw.trim());
  return { student: !staff && valid ? studentKey(raw as string) : null, staff };
}

router.get("/spi", quizLimiter, async (req, res): Promise<void> => {
  res.set("Cache-Control", "no-store");
  const who = await whoIsAsking(req);
  if (!who.student && !who.staff) {
    res.status(400).json({ error: "Student required" });
    return;
  }
  // A student reaching the gate counts as "opened" (saved once). Done = finished in the database
  // (any device), or the done cookie from before tracking existed.
  // An unfinished quiz continues where it stopped (reload, lost connection, another device).
  let done = false;
  let progress: { started: boolean; answered: { questionId: string; correct: boolean }[] } = { started: false, answered: [] };
  if (who.student) {
    await recordOpened(who.student);
    done = quizDoneFor(req.cookies?.[QUIZ_COOKIE_NAME] as string | undefined, who.student) || (await quizFinished(who.student));
    if (!done) {
      const saved = await quizProgress(who.student);
      progress = { started: saved.started, answered: saved.answers.map(({ questionId, correct }) => ({ questionId, correct })) };
    }
  }
  res.json({ done, questions: await publicQuestions(), progress });
});

router.post("/spi/answer", quizLimiter, async (req, res): Promise<void> => {
  res.set("Cache-Control", "no-store");
  const who = await whoIsAsking(req);
  if (!who.student && !who.staff) {
    res.status(400).json({ error: "Student required" });
    return;
  }
  const { questionId, option, position } = req.body as { questionId?: string; option?: string; position?: number };
  let result = typeof questionId === "string" && typeof option === "string" ? await checkQuizAnswer(questionId, option) : null;
  if (!result) {
    res.status(400).json({ error: "Unknown question or option" });
    return;
  }
  let saved = option as string;
  if (who.student) {
    const pos = Number.isInteger(position) && (position as number) > 0 && (position as number) <= 100 ? (position as number) : null;
    await recordAnswer(who.student, { questionId: questionId as string, option: option as string, correct: result.correct, position: pos });
    // Only the first answer counts: a repeat (two tabs, a resend) gets the result of the saved one.
    const first = (await quizProgress(who.student)).answers.find((a) => a.questionId === questionId);
    if (first && first.option !== option) {
      saved = first.option;
      result = (await checkQuizAnswer(questionId as string, saved)) ?? result;
    }
  }
  res.json({ ...result, option: saved });
});

router.post("/spi/start", quizLimiter, async (req, res): Promise<void> => {
  res.set("Cache-Control", "no-store");
  const who = await whoIsAsking(req);
  if (!who.student && !who.staff) {
    res.status(400).json({ error: "Student required" });
    return;
  }
  if (who.student) await recordStarted(who.student);
  res.json({ started: true });
});

router.post("/spi/complete", quizLimiter, async (req, res): Promise<void> => {
  res.set("Cache-Control", "no-store");
  const who = await whoIsAsking(req);
  if (!who.student && !who.staff) {
    res.status(400).json({ error: "Student required" });
    return;
  }
  // Staff may preview the quiz; only a student login is marked as done.
  // The score shown is the saved one, so the student and the dashboard see the same number.
  let saved: { score: number; total: number | null } | null = null;
  if (who.student) {
    await recordFinished(who.student, (await publicQuestions()).length);
    saved = await finishedScore(who.student);
    res.cookie(QUIZ_COOKIE_NAME, signQuizDone(who.student), {
      ...studentCookieOptions(process.env.NODE_ENV === "production"),
      maxAge: quizCookieMaxAge,
    });
  }
  res.json({ done: true, score: saved?.score ?? null, total: saved?.total ?? null });
});

export default router;
