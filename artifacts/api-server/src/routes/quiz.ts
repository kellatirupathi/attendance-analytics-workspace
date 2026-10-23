import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { getSessionFromRequest } from "../lib/auth.js";
import {
  QUIZ_COOKIE_NAME,
  checkQuizAnswer,
  publicQuestions,
  quizCookieMaxAge,
  quizDoneFor,
  signQuizDone,
} from "../lib/spiQuiz.js";
import { STUDENT_COOKIE_NAME, studentCookieOptions, studentIdFromToken } from "../lib/testStudents.js";
import { quizFinished, recordAnswer, recordFinished, recordOpened, recordStarted } from "../lib/quizTracking.js";

const router = Router();

const quizLimiter = rateLimit({ windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false });

/** A student login (test student today, Learning Portal SSO later) or a staff session may use the quiz. */
async function whoIsAsking(req: Parameters<typeof getSessionFromRequest>[0]): Promise<{ student: string | null; staff: boolean }> {
  return {
    student: await studentIdFromToken(req.cookies?.[STUDENT_COOKIE_NAME] as string | undefined),
    staff: Boolean(getSessionFromRequest(req)),
  };
}

router.get("/spi", quizLimiter, async (req, res): Promise<void> => {
  res.set("Cache-Control", "no-store");
  const who = await whoIsAsking(req);
  if (!who.student && !who.staff) {
    res.status(401).json({ error: "Login required" });
    return;
  }
  // A student reaching the gate counts as "opened" (saved once). Done = finished in the database
  // (any device), or the done cookie from before tracking existed.
  let done = false;
  if (who.student) {
    await recordOpened(who.student);
    done = quizDoneFor(req.cookies?.[QUIZ_COOKIE_NAME] as string | undefined, who.student) || (await quizFinished(who.student));
  }
  res.json({ done, questions: await publicQuestions() });
});

router.post("/spi/answer", quizLimiter, async (req, res): Promise<void> => {
  res.set("Cache-Control", "no-store");
  const who = await whoIsAsking(req);
  if (!who.student && !who.staff) {
    res.status(401).json({ error: "Login required" });
    return;
  }
  const { questionId, option, position } = req.body as { questionId?: string; option?: string; position?: number };
  const result = typeof questionId === "string" && typeof option === "string" ? await checkQuizAnswer(questionId, option) : null;
  if (!result) {
    res.status(400).json({ error: "Unknown question or option" });
    return;
  }
  if (who.student) {
    const pos = Number.isInteger(position) && (position as number) > 0 && (position as number) <= 100 ? (position as number) : null;
    await recordAnswer(who.student, { questionId: questionId as string, option: option as string, correct: result.correct, position: pos });
  }
  res.json(result);
});

router.post("/spi/start", quizLimiter, async (req, res): Promise<void> => {
  res.set("Cache-Control", "no-store");
  const who = await whoIsAsking(req);
  if (!who.student && !who.staff) {
    res.status(401).json({ error: "Login required" });
    return;
  }
  if (who.student) await recordStarted(who.student);
  res.json({ started: true });
});

router.post("/spi/complete", quizLimiter, async (req, res): Promise<void> => {
  res.set("Cache-Control", "no-store");
  const who = await whoIsAsking(req);
  if (!who.student && !who.staff) {
    res.status(401).json({ error: "Login required" });
    return;
  }
  // Staff may preview the quiz; only a student login is marked as done.
  if (who.student) {
    await recordFinished(who.student, (await publicQuestions()).length);
    res.cookie(QUIZ_COOKIE_NAME, signQuizDone(who.student), {
      ...studentCookieOptions(process.env.NODE_ENV === "production"),
      maxAge: quizCookieMaxAge,
    });
  }
  res.json({ done: true });
});

export default router;
