import { useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, PartyPopper, XCircle } from "lucide-react";
import { Logo } from "@/components/LogoMark";

/**
 * The SPI quick quiz a student takes before the report opens. The browser never gets the
 * right answer up front: after each pick it asks the server, which replies with the result and
 * the explanation. Options are shuffled for each student; the server only sees the option key.
 */
interface Question {
  id: string;
  topic: string;
  question: string;
  options: Record<string, string>;
}
interface Feedback {
  correct: boolean;
  correctOption: string;
  explanation: string[];
}

const shuffled = <T,>(items: T[]): T[] => {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
};

const LETTERS = ["A", "B", "C", "D", "E", "F"];

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/quiz${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()) as T;
}

export default function SpiQuiz({ onDone }: { onDone: () => void }) {
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [started, setStarted] = useState(false);
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [checking, setChecking] = useState(false);
  const [correctCount, setCorrectCount] = useState(0);
  const [finished, setFinished] = useState(false);
  const [finishing, setFinishing] = useState(false);

  useEffect(() => {
    api<{ done: boolean; questions: Question[] }>("/spi")
      .then((d) => (d.done || d.questions.length === 0 ? onDone() : setQuestions(d.questions)))
      .catch(() => setLoadError(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const question = questions?.[index];
  // Same order on every render of one question; a new order for the next question.
  const optionOrder = useMemo(() => (question ? shuffled(Object.keys(question.options)) : []), [question]);

  const pick = async (key: string) => {
    if (!question || feedback || checking) return;
    setPicked(key);
    setChecking(true);
    try {
      const result = await api<Feedback>("/spi/answer", {
        method: "POST",
        body: JSON.stringify({ questionId: question.id, option: key }),
      });
      setFeedback(result);
      if (result.correct) setCorrectCount((n) => n + 1);
    } catch {
      setPicked(null);
    } finally {
      setChecking(false);
    }
  };

  const next = async () => {
    if (!questions) return;
    if (index + 1 < questions.length) {
      setIndex(index + 1);
      setPicked(null);
      setFeedback(null);
      return;
    }
    setFinishing(true);
    try {
      await api("/spi/complete", { method: "POST", body: "{}" });
      setFinished(true);
    } catch {
      setLoadError(true);
    } finally {
      setFinishing(false);
    }
  };

  const shell = (children: React.ReactNode) => (
    <div className="flex min-h-screen items-center justify-center bg-[#EEF3F9] p-4 sm:p-6">
      <div className="w-full max-w-2xl rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-8">
        <div className="mb-6 flex justify-center">
          <Logo />
        </div>
        {children}
      </div>
    </div>
  );

  if (loadError) {
    return shell(
      <div className="text-center">
        <AlertCircle className="mx-auto mb-3 h-9 w-9 text-red-500" />
        <p className="text-sm text-slate-600">We couldn't load the quiz. Please refresh the page and try again.</p>
      </div>,
    );
  }

  if (!questions) {
    return shell(
      <div className="flex justify-center py-8">
        <Loader2 className="size-7 animate-spin text-slate-400" />
      </div>,
    );
  }

  if (!started) {
    return shell(
      <div className="text-center">
        <h1 className="mb-2 text-xl font-bold text-slate-900">Please complete this quiz to unlock your SPI</h1>
        <p className="mb-6 text-sm leading-relaxed text-slate-600">
          It has {questions.length} short questions about how SPI works. You will see the right answer and a short
          explanation after each question. When you finish, your report opens.
        </p>
        <button
          type="button"
          onClick={() => setStarted(true)}
          className="min-h-11 rounded-xl bg-[#0F2A5C] px-6 text-sm font-semibold text-white"
        >
          Start quiz
        </button>
      </div>,
    );
  }

  if (finished) {
    return shell(
      <div className="text-center">
        <PartyPopper className="mx-auto mb-3 h-10 w-10 text-amber-500" />
        <h1 className="mb-2 text-xl font-bold text-slate-900">Thank you!</h1>
        <p className="mb-1 text-sm text-slate-700">
          You answered {correctCount} of {questions.length} correctly.
        </p>
        <p className="mb-6 text-sm leading-relaxed text-slate-600">
          Congratulations! We hope you now understand how SPI works. Your report is ready.
        </p>
        <button
          type="button"
          onClick={onDone}
          className="min-h-11 rounded-xl bg-[#0F2A5C] px-6 text-sm font-semibold text-white"
        >
          Open my report
        </button>
      </div>,
    );
  }

  const last = index + 1 === questions.length;
  return shell(
    <div>
      <div className="mb-1 flex items-center justify-between text-xs font-medium text-slate-500">
        <span>
          Question {index + 1} of {questions.length}
        </span>
        <span>{question?.topic}</span>
      </div>
      <div className="mb-5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-[#0F2A5C] transition-all" style={{ width: `${((index + (feedback ? 1 : 0)) / questions.length) * 100}%` }} />
      </div>

      <h2 className="mb-4 text-base font-semibold leading-snug text-slate-900">{question?.question}</h2>

      <div className="space-y-2.5">
        {optionOrder.map((key, i) => {
          const isPicked = picked === key;
          const isRight = feedback?.correctOption === key;
          const state = !feedback
            ? isPicked
              ? "border-[#0F2A5C] bg-slate-50"
              : "border-slate-200 hover:border-slate-400"
            : isRight
              ? "border-emerald-500 bg-emerald-50"
              : isPicked
                ? "border-red-400 bg-red-50"
                : "border-slate-200 opacity-70";
          return (
            <button
              key={key}
              type="button"
              disabled={Boolean(feedback) || checking}
              onClick={() => void pick(key)}
              className={`flex min-h-11 w-full items-start gap-3 rounded-xl border px-3.5 py-3 text-left text-sm text-slate-800 transition-colors ${state}`}
            >
              <span className="mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-600">
                {LETTERS[i]}
              </span>
              <span className="flex-1 leading-snug">{question?.options[key]}</span>
              {feedback && isRight && <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />}
              {feedback && isPicked && !isRight && <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />}
            </button>
          );
        })}
      </div>

      {feedback && (
        <div className={`mt-5 rounded-xl p-4 text-sm ${feedback.correct ? "bg-emerald-50 text-emerald-900" : "bg-amber-50 text-amber-900"}`}>
          <p className="mb-2 font-semibold">{feedback.correct ? "Correct!" : "Not quite. The right answer is highlighted in green."}</p>
          <div className="space-y-1.5 leading-relaxed">
            {feedback.explanation.map((line, i) => (
              <p key={i} className={line.startsWith("•") || /^\d\./.test(line) ? "pl-3" : undefined}>
                {line}
              </p>
            ))}
          </div>
        </div>
      )}

      {feedback && (
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={() => void next()}
            disabled={finishing}
            className="min-h-11 rounded-xl bg-[#0F2A5C] px-6 text-sm font-semibold text-white disabled:opacity-60"
          >
            {finishing ? "Saving..." : last ? "Finish" : "Next question"}
          </button>
        </div>
      )}
    </div>,
  );
}
