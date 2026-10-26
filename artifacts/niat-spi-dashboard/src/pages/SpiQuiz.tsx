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

/** The quiz for the student in the report link (`studentId`); finishing it unlocks the report. */
export default function SpiQuiz({ studentId, onDone }: { studentId: string; onDone: () => void }) {
  const student = encodeURIComponent(studentId);
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
    api<{ done: boolean; questions: Question[] }>(`/spi?student=${student}`)
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
        body: JSON.stringify({ student: studentId, questionId: question.id, option: key, position: index + 1 }),
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
      await api("/spi/complete", { method: "POST", body: JSON.stringify({ student: studentId }) });
      setFinished(true);
    } catch {
      setLoadError(true);
    } finally {
      setFinishing(false);
    }
  };

  const shell = (children: React.ReactNode) => (
    <div className="flex min-h-screen items-center justify-center bg-[#F4F7FD] p-4 text-[13px] text-[#334155] sm:p-6" style={{ fontFamily: '"Inter", system-ui, sans-serif' }}>
      <div className="w-full max-w-2xl rounded-[14px] border border-[#E6ECF5] bg-white p-5 shadow-[0_1px_2px_rgba(11,31,77,0.04)] sm:p-8">
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
        <AlertCircle className="mx-auto mb-3 h-9 w-9 text-[#E11D48]" />
        <p className="text-sm text-[#6B7280]">We couldn't load the quiz. Please refresh the page and try again.</p>
      </div>,
    );
  }

  if (!questions) {
    return shell(
      <div className="flex justify-center py-8">
        <Loader2 className="size-7 animate-spin text-[#94A3B8]" />
      </div>,
    );
  }

  if (!started) {
    return shell(
      <div className="text-center">
        <h1 className="mb-2 text-xl font-bold text-[#0B1F4D]">Please complete this quiz to unlock your SPI Score Card</h1>
        <p className="mb-6 text-sm leading-relaxed text-[#6B7280]">
          It has {questions.length} short questions about how SPI works. When you finish, your report opens.
        </p>
        <button
          type="button"
          onClick={() => {
            setStarted(true);
            // Saved for the quiz analytics; the quiz goes on even if this call fails.
            void api("/spi/start", { method: "POST", body: JSON.stringify({ student: studentId }) }).catch(() => {});
          }}
          className="min-h-11 rounded-xl bg-[#2563EB] px-6 text-sm font-semibold text-white hover:bg-[#1D4ED8]"
        >
          Start quiz
        </button>
      </div>,
    );
  }

  if (finished) {
    return shell(
      <div className="text-center">
        <PartyPopper className="mx-auto mb-3 h-10 w-10 text-[#2563EB]" />
        <h1 className="mb-2 text-xl font-bold text-[#0B1F4D]">Thank you!</h1>
        <p className="mb-1 text-sm text-[#334155]">
          You answered {correctCount} of {questions.length} correctly.
        </p>
        <p className="mb-6 text-sm leading-relaxed text-[#6B7280]">
          Congratulations! We hope you now understand how SPI works. Your report is ready.
        </p>
        <button
          type="button"
          onClick={onDone}
          className="min-h-11 rounded-xl bg-[#2563EB] px-6 text-sm font-semibold text-white hover:bg-[#1D4ED8]"
        >
          Open my report
        </button>
      </div>,
    );
  }

  const last = index + 1 === questions.length;
  return shell(
    <div>
      <div className="mb-1 flex items-center justify-between text-xs font-medium text-[#6B7280]">
        <span>
          Question {index + 1} of {questions.length}
        </span>
        <span>{question?.topic}</span>
      </div>
      <div className="mb-5 h-1.5 w-full overflow-hidden rounded-full bg-[#EAF1FF]">
        <div className="h-full rounded-full bg-[#2563EB] transition-all" style={{ width: `${((index + (feedback ? 1 : 0)) / questions.length) * 100}%` }} />
      </div>

      <h2 className="mb-4 text-base font-semibold leading-snug text-[#0B1F4D]">{question?.question}</h2>

      <div className="space-y-2.5">
        {optionOrder.map((key, i) => {
          const isPicked = picked === key;
          const isRight = feedback?.correctOption === key;
          const state = !feedback
            ? isPicked
              ? "border-[#2563EB] bg-[#EAF1FF]"
              : "border-[#E6ECF5] hover:border-[#2563EB] hover:bg-[#F6F9FF]"
            : isRight
              ? "border-[#16A34A] bg-[#E6F7EC]"
              : isPicked
                ? "border-[#E11D48] bg-[#FDECEF]"
                : "border-[#E6ECF5] opacity-70";
          return (
            <button
              key={key}
              type="button"
              disabled={Boolean(feedback) || checking}
              onClick={() => void pick(key)}
              className={`flex min-h-11 w-full items-start gap-3 rounded-xl border px-3.5 py-3 text-left text-sm text-[#0B1F4D] transition-colors ${state}`}
            >
              <span className="mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#EAF1FF] text-xs font-bold text-[#2563EB]">
                {LETTERS[i]}
              </span>
              <span className="flex-1 leading-snug">{question?.options[key]}</span>
              {feedback && isRight && <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[#16A34A]" />}
              {feedback && isPicked && !isRight && <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-[#E11D48]" />}
            </button>
          );
        })}
      </div>

      {feedback && (
        <div className={`mt-5 rounded-xl border p-4 text-sm text-[#0B1F4D] ${feedback.correct ? "border-[#BBF7D0] bg-[#E6F7EC]" : "border-[#E6ECF5] bg-[#F6F9FF]"}`}>
          <p className={`mb-2 font-semibold ${feedback.correct ? "text-[#16A34A]" : "text-[#0B1F4D]"}`}>
            {feedback.correct
              ? "Correct!"
              : `Correct answer: ${LETTERS[optionOrder.indexOf(feedback.correctOption)] ?? feedback.correctOption}. ${question?.options[feedback.correctOption] ?? ""}`}
          </p>
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
            className="min-h-11 rounded-xl bg-[#2563EB] px-6 text-sm font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-60"
          >
            {finishing ? "Saving..." : last ? "Finish" : "Next question"}
          </button>
        </div>
      )}
    </div>,
  );
}
