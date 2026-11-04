import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ShotGallery, ShotPicker, useShots } from "@/components/QueryShots";
import { problemLabel } from "@/lib/queryCategories";
import {
  CATEGORY_DOT,
  STATUS_LABEL,
  STUDENT_STATUS_STYLE,
  categoryLabel,
  sendJson,
  studentImageUrl,
  systemLine,
  timeLabel,
  type QueryStatus,
  type Thread,
  type ThreadMessage,
  type ThreadQuery,
} from "@/lib/queryChat";

/**
 * The student's side of "Raise a query": a list with one card per category chat, and one chat with the SPI team
 * per card. useStudentThread keeps the data fresh (the report page uses it for the "My queries" badge);
 * QueryChatSheet is the list and the chat. The words are plain: the student always sees whose turn it is.
 */

interface StudentThread extends Thread {
  unread: number;
}

const EMPTY: StudentThread = { queries: [], messages: [], unread: 0 };
const MAX_CHARS = 2000;

/** Loads the student's chats and replies and refreshes them every `pollMs` while the tab is visible. */
export function useStudentThread(studentId: string | undefined, pollMs: number) {
  const [thread, setThread] = useState<StudentThread>(EMPTY);

  const refresh = useCallback(async () => {
    if (!studentId) return;
    try {
      const res = await fetch(`/api/spi-queries/thread?student=${encodeURIComponent(studentId)}`, { credentials: "include" });
      if (!res.ok) return;
      setThread((await res.json()) as StudentThread);
    } catch {
      /* try again on the next tick */
    }
  }, [studentId]);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => document.visibilityState === "visible" && void refresh(), pollMs);
    const onVisible = () => document.visibilityState === "visible" && void refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh, pollMs]);

  return { thread, refresh };
}

/** The newest message a person wrote (system lines are not shown as a preview). */
function lastMessage(messages: ThreadMessage[], queryId: number): ThreadMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.queryId === queryId && m.author !== "system") return m;
  }
  return undefined;
}

/** The one label on a card: the student's turn first, then new replies, then the plain status. */
function cardPill(q: ThreadQuery): { text: string; className: string } {
  if (q.status === "waiting_on_student") return { text: STATUS_LABEL.student.waiting_on_student, className: STUDENT_STATUS_STYLE.waiting_on_student };
  const n = q.unread ?? 0;
  if (n > 0 && q.status !== "resolved") return { text: n === 1 ? "1 new reply" : `${n} new replies`, className: "bg-[#E11D48] text-white" };
  return { text: STATUS_LABEL.student[q.status], className: STUDENT_STATUS_STYLE[q.status] };
}

function QueryList({ thread, onPick, onNew }: { thread: StudentThread; onPick: (id: number) => void; onNew: () => void }) {
  // The student's turn first, then chats with a new reply, then the rest by latest activity; resolved ones last.
  const rows = useMemo(() => {
    const rank = (q: ThreadQuery) => (q.status === "waiting_on_student" ? 0 : (q.unread ?? 0) > 0 && q.status !== "resolved" ? 1 : q.status === "resolved" ? 3 : 2);
    return thread.queries
      .map((q) => ({ q, last: lastMessage(thread.messages, q.id) }))
      .sort((a, b) => rank(a.q) - rank(b.q) || (b.last?.createdAt ?? b.q.createdAt).localeCompare(a.last?.createdAt ?? a.q.createdAt));
  }, [thread]);
  const waiting = thread.queries.filter((q) => q.status === "waiting_on_student").length;

  if (rows.length === 0) {
    return (
      <div className="grid flex-1 place-items-center px-6 text-center">
        <div>
          <p className="text-[14px] font-bold text-[#0B1F4D]">No queries yet</p>
          <button type="button" onClick={onNew} className="mt-3 min-h-11 rounded-[10px] bg-[#2563EB] px-5 text-[13px] font-bold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563EB]">
            Raise a query
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-3 pb-3">
      {waiting > 0 && (
        <p className="mt-3 flex items-center gap-2 rounded-[10px] border border-[#BBD0FF] bg-[#EAF1FF] px-3 py-2 text-[12.5px] font-semibold text-[#1D4ED8]">
          <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8v5M12 16h.01" />
          </svg>
          {waiting === 1 ? "1 chat needs your reply" : `${waiting} chats need your reply`}
        </p>
      )}
      <ul className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-2.5">
        {rows.map(({ q, last }) => {
          const pill = cardPill(q);
          const turn = q.status === "waiting_on_student";
          const fresh = !turn && (q.unread ?? 0) > 0 && q.status !== "resolved";
          const subjects = q.subjects.length > 2 ? `${q.subjects.slice(0, 2).join(", ")} +${q.subjects.length - 2}` : q.subjects.join(", ");
          return (
            <li key={q.id} className="min-w-0">
              <button
                type="button"
                onClick={() => onPick(q.id)}
                className={`block w-full rounded-[12px] border p-3 text-left transition-colors hover:bg-[#F6F9FF] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563EB] ${
                  turn ? "border-[#2563EB] bg-[#F6F9FF] ring-1 ring-[#2563EB]" : q.status === "resolved" ? "border-[#E6ECF5] bg-[#FAFBFD]" : "border-[#E6ECF5] bg-white"
                }`}
              >
                <span className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: CATEGORY_DOT[q.category] ?? "#2563EB" }} aria-hidden />
                  <b className="min-w-0 flex-1 truncate text-[14px] text-[#0B1F4D]">{categoryLabel(q.category)}</b>
                  <span className={`shrink-0 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11.5px] font-bold ${pill.className}`}>{pill.text}</span>
                </span>
                <span className="mt-1 block truncate text-[12px] text-[#6B7280]">{subjects}</span>
                {last && (
                  <span className="mt-2 flex items-center gap-2 rounded-[9px] bg-[#F4F7FD] px-2.5 py-1.5 text-[12.5px] text-[#334155]">
                    <span className="min-w-0 flex-1 truncate">
                      <b className="text-[#0B1F4D]">{last.author === "ops" ? "SPI team: " : "You: "}</b>
                      {last.body}
                    </span>
                    {!turn && !fresh && <span className="shrink-0 text-[12px] font-bold text-[#2563EB]" aria-hidden>Open ›</span>}
                  </span>
                )}
                {(turn || fresh) && (
                  <span
                    className={`mt-2.5 grid min-h-11 place-items-center rounded-[10px] text-[13px] font-bold ${turn ? "bg-[#2563EB] text-white" : "border border-[#BBD0FF] bg-white text-[#2563EB]"}`}
                    aria-hidden
                  >
                    {turn ? "Reply now" : "Read and reply"}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

type StepState = "done" | "now" | "turn" | "todo";

/** Sent, SPI team, Resolved: where the chat is, with one short line on what happens next. */
function Steps({ status }: { status: QueryStatus }) {
  const resolved = status === "resolved";
  const turn = status === "waiting_on_student";
  const steps: { label: string; state: StepState }[] = [
    { label: "Sent", state: "done" },
    { label: "SPI team", state: resolved ? "done" : turn ? "turn" : "now" },
    { label: "Resolved", state: resolved ? "done" : "todo" },
  ];
  const dot: Record<StepState, string> = {
    done: "bg-[#15803D] text-white",
    now: "bg-[#B45309] text-white ring-4 ring-[#FFF4DD]",
    turn: "bg-[#2563EB] text-white ring-4 ring-[#EAF1FF]",
    todo: "bg-[#DCE4F1] text-white",
  };
  return (
    <div className="border-b border-[#E6ECF5] px-4 pb-2.5 pt-3">
      <ol className="flex items-center" aria-label="Progress">
        {steps.map((s, i) => (
          <li key={s.label} className="contents">
            {i > 0 && <span className={`mx-1 mb-4 h-0.5 flex-1 ${steps[i - 1]!.state === "done" && s.state !== "todo" ? "bg-[#15803D]" : "bg-[#DCE4F1]"}`} aria-hidden />}
            <span className="flex w-16 flex-col items-center gap-1" aria-current={s.state === "now" || s.state === "turn" ? "step" : undefined}>
              <span className={`grid h-6 w-6 place-items-center rounded-full text-[11px] font-bold ${dot[s.state]}`} aria-hidden>
                {s.state === "done" ? "✓" : i + 1}
              </span>
              <span className={`text-[11.5px] font-semibold ${s.state === "todo" ? "text-[#6B7280]" : "text-[#0B1F4D]"}`}>{s.label}</span>
            </span>
          </li>
        ))}
      </ol>
      <p className={`mt-1 text-center text-[12.5px] font-semibold ${turn ? "text-[#1D4ED8]" : resolved ? "text-[#15803D]" : "text-[#0B1F4D]"}`}>
        {resolved ? "✓ Resolved" : turn ? "Your turn: reply below" : "The SPI team will reply here"}
      </p>
    </div>
  );
}

function QueryChat({ studentId, query, messages, onBack, onRefresh }: { studentId: string; query: ThreadQuery; messages: ThreadMessage[]; onBack: () => void; onRefresh: () => Promise<void> }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const shots = useShots(studentId);
  const mine = useMemo(() => messages.filter((m) => m.queryId === query.id), [messages, query.id]);
  const turn = query.status === "waiting_on_student";
  const resolved = query.status === "resolved";

  // Opening this chat counts its replies as read; a reply that arrives while it is open is marked too.
  useEffect(() => {
    if ((query.unread ?? 0) === 0) return;
    void sendJson("/api/spi-queries/read", { student: studentId, queryId: query.id }).then(() => onRefresh());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId, query.id, query.unread]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [mine.length]);

  const send = async () => {
    const body = text.trim();
    if (!body || sending || shots.busy) return;
    setSending(true);
    setError(null);
    const res = await sendJson(`/api/spi-queries/${query.id}/messages`, { student: studentId, body, attachments: shots.tokens });
    setSending(false);
    if (!res.ok) {
      setError(res.error ?? "Could not send your message.");
      return;
    }
    setText("");
    shots.reset();
    await onRefresh();
  };

  return (
    <>
      <div className="border-b border-[#E6ECF5] px-3 py-2.5">
        <div className="flex items-center gap-2">
          <button type="button" onClick={onBack} className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-[#0B1F4D] hover:bg-[#F1F5FB] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#2563EB]" aria-label="Back to my queries">
            ←
          </button>
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: CATEGORY_DOT[query.category] ?? "#2563EB" }} aria-hidden />
          <h2 className="min-w-0 flex-1 truncate text-[15px] font-bold text-[#0B1F4D]">{categoryLabel(query.category)}</h2>
        </div>
        <p className="mt-0.5 pl-12 text-[12px] leading-snug text-[#334155]">{query.subjects.join(", ")}</p>
      </div>
      <Steps status={query.status} />

      <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto bg-[#FAFCFF] px-3.5 py-3" aria-live="polite">
        {mine.map((m) => {
          if (m.author === "system") {
            return (
              <p key={m.id} className="self-center rounded-full bg-[#EEF2F8] px-2.5 py-1 text-[11.5px] text-[#6B7280]">
                {systemLine(m.body, "student")}
              </p>
            );
          }
          const images = (m.attachments ?? []).map((a) => ({ url: studentImageUrl(studentId, a.token), name: a.name, size: a.size }));
          const problem = problemLabel(query.category, m.problem);
          const mineMsg = m.author === "student";
          return (
            <div key={m.id} className={`flex max-w-[86%] flex-col ${mineMsg ? "items-end self-end" : "items-start self-start"}`}>
              <span className={`mb-0.5 text-[11px] font-bold ${mineMsg ? "text-[#6B7280]" : "text-[#2563EB]"}`}>{mineMsg ? "You" : "SPI team"}</span>
              <div className={`whitespace-pre-wrap break-words px-3 py-2 text-[12.5px] leading-snug ${mineMsg ? "rounded-[12px] rounded-br-[3px] bg-[#2563EB] text-white" : "rounded-[12px] rounded-bl-[3px] bg-[#F1F5FB] text-[#0B1F4D]"}`}>
                {problem && mineMsg && <b className="mb-0.5 block">{problem}</b>}
                {m.body}
                {mineMsg && <ShotGallery items={images} onBlue />}
                <small className={`mt-1 block text-[11px] ${mineMsg ? "opacity-80" : "text-[#6B7280]"}`}>{timeLabel(m.createdAt)}</small>
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      <div className={turn ? "border-t-2 border-[#2563EB] bg-[#F6F9FF] px-3 py-2.5" : "border-t border-[#E6ECF5] px-3 py-2.5"}>
        {turn && <p className="mb-1.5 text-[12px] font-bold text-[#0B1F4D]">Reply to SPI team</p>}
        {error && (
          <p role="alert" className="mb-2 rounded-[8px] bg-[#FDECEF] px-2.5 py-1.5 text-[12px] text-[#9F1239]">
            {error}
          </p>
        )}
        {shots.shots.length > 0 && (
          <div className="mb-2">
            <ShotPicker state={shots} compact />
          </div>
        )}
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          {shots.shots.length === 0 && <ShotPicker state={shots} compact />}
          <textarea
            value={text}
            maxLength={MAX_CHARS}
            rows={1}
            onChange={(e) => setText(e.target.value)}
            onPaste={shots.onPaste}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={turn ? "Type your reply…" : resolved ? "Not solved? Reply to reopen…" : "Write a message…"}
            aria-label={turn ? "Reply to SPI team" : "Your message"}
            className={`max-h-28 min-h-11 min-w-0 flex-1 resize-none rounded-[10px] border px-3 py-2.5 text-[13px] text-[#0B1F4D] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/25 ${turn ? "border-[#2563EB] bg-white" : "border-[#CBD5E1]"}`}
          />
          <button type="submit" disabled={!text.trim() || sending || shots.busy} className="min-h-11 rounded-[10px] bg-[#2563EB] px-4 text-[13px] font-bold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563EB] disabled:cursor-not-allowed disabled:opacity-50">
            {sending ? "…" : "Send"}
          </button>
        </form>
      </div>
    </>
  );
}

export function QueryChatSheet({
  studentId,
  thread,
  onRefresh,
  onNew,
  onClose,
}: {
  studentId: string;
  thread: StudentThread;
  onRefresh: () => Promise<void>;
  onNew: () => void;
  onClose: () => void;
}) {
  const [openId, setOpenId] = useState<number | null>(null);
  const open = thread.queries.find((q) => q.id === openId) ?? null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && (open ? setOpenId(null) : onClose());
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, open]);

  return (
    <div className="fixed inset-0 z-50 grid bg-[#0B1F4D]/35 sm:place-items-end sm:p-6" onClick={(e) => e.target === e.currentTarget && onClose()} role="dialog" aria-modal="true" aria-label="My queries">
      <div className="flex h-full w-full flex-col overflow-hidden bg-white shadow-[0_24px_60px_rgba(11,31,77,0.25)] sm:h-[min(680px,calc(100vh-3rem))] sm:max-w-[400px] sm:rounded-[18px]">
        {open ? (
          <QueryChat studentId={studentId} query={open} messages={thread.messages} onBack={() => setOpenId(null)} onRefresh={onRefresh} />
        ) : (
          <>
            <div className="flex items-center gap-2 border-b border-[#E6ECF5] px-4 py-3">
              <h2 className="min-w-0 flex-1 text-[15px] font-bold text-[#0B1F4D]">My queries</h2>
              <button type="button" onClick={onNew} className="min-h-10 rounded-[9px] bg-[#2563EB] px-3.5 text-[13px] font-bold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563EB]">
                + New
              </button>
              <button type="button" onClick={onClose} className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-[#E6ECF5] text-[#0B1F4D] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#2563EB]" aria-label="Close">
                ✕
              </button>
            </div>
            <QueryList thread={thread} onPick={setOpenId} onNew={onNew} />
          </>
        )}
      </div>
    </div>
  );
}
