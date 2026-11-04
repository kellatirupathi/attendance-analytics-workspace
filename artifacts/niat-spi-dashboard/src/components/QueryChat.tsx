import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CATEGORY_DOT,
  STATUS_LABEL,
  STATUS_STYLE,
  categoryLabel,
  sendJson,
  timeLabel,
  type Thread,
  type ThreadMessage,
  type ThreadQuery,
} from "@/lib/queryChat";

/**
 * The student's side of "Raise a query": a list of their queries, and one chat per query with the SPI team.
 * useStudentThread keeps the data fresh (the report page uses it for the "My queries" badge);
 * QueryChatSheet is the list and the chat.
 */

interface StudentThread extends Thread {
  unread: number;
}

const EMPTY: StudentThread = { queries: [], messages: [], unread: 0 };
const MAX_CHARS = 2000;

/** Loads the student's queries and replies and refreshes them every `pollMs` while the tab is visible. */
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

function StatusPill({ status }: { status: ThreadQuery["status"] }) {
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold ${STATUS_STYLE[status]}`}>{STATUS_LABEL.student[status]}</span>;
}

/** Newest activity first: the last message of each query decides where it sits. */
function lastMessage(messages: ThreadMessage[], queryId: number): ThreadMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i]!.queryId === queryId) return messages[i];
  return undefined;
}

function QueryList({ thread, onPick }: { thread: StudentThread; onPick: (id: number) => void }) {
  const rows = useMemo(
    () =>
      thread.queries
        .map((q) => ({ q, last: lastMessage(thread.messages, q.id) }))
        .sort((a, b) => (b.last?.createdAt ?? b.q.createdAt).localeCompare(a.last?.createdAt ?? a.q.createdAt)),
    [thread],
  );
  return (
    <ul className="flex-1 divide-y divide-[#E6ECF5] overflow-y-auto">
      {rows.map(({ q, last }) => (
        <li key={q.id}>
          <button type="button" onClick={() => onPick(q.id)} className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-[#F6F9FF]">
            <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: CATEGORY_DOT[q.category] ?? "#2563EB" }} aria-hidden />
            <span className="min-w-0 flex-1">
              <b className="block truncate text-[13px] text-[#0B1F4D]">{categoryLabel(q.category)}</b>
              <span className="block truncate text-[12px] text-[#6B7280]">{q.subject}</span>
              {last && (
                <span className={`mt-1 block truncate text-[12px] ${(q.unread ?? 0) > 0 ? "font-semibold text-[#0B1F4D]" : "text-[#6B7280]"}`}>
                  {last.author === "ops" ? "SPI team: " : "You: "}
                  {last.body}
                </span>
              )}
            </span>
            <span className="flex shrink-0 flex-col items-end gap-1.5">
              <StatusPill status={q.status} />
              <small className="text-[10.5px] text-[#94A3B8]">{timeLabel(last?.createdAt ?? q.createdAt)}</small>
              {(q.unread ?? 0) > 0 && (
                <span className="rounded-full bg-[#E11D48] px-1.5 text-[10.5px] font-bold text-white" aria-label={`${q.unread} new ${q.unread === 1 ? "reply" : "replies"}`}>
                  {q.unread} new
                </span>
              )}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function QueryChat({ studentId, query, messages, onBack, onRefresh }: { studentId: string; query: ThreadQuery; messages: ThreadMessage[]; onBack: () => void; onRefresh: () => Promise<void> }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const mine = useMemo(() => messages.filter((m) => m.queryId === query.id), [messages, query.id]);

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
    if (!body || sending) return;
    setSending(true);
    setError(null);
    const res = await sendJson(`/api/spi-queries/${query.id}/messages`, { student: studentId, body });
    setSending(false);
    if (!res.ok) {
      setError(res.error ?? "Could not send your message.");
      return;
    }
    setText("");
    await onRefresh();
  };

  return (
    <>
      <div className="flex items-center gap-2 border-b border-[#E6ECF5] px-3 py-2.5">
        <button type="button" onClick={onBack} className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[#0B1F4D] hover:bg-[#F1F5FB]" aria-label="Back to my queries">
          ←
        </button>
        <div className="min-w-0">
          <h2 className="truncate text-[14px] font-bold text-[#0B1F4D]">{categoryLabel(query.category)}</h2>
          <p className="truncate text-[11px] text-[#6B7280]">{query.subject}</p>
        </div>
        <span className="ml-auto">
          <StatusPill status={query.status} />
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-2 overflow-y-auto bg-[#FAFCFF] px-3.5 py-3" aria-live="polite">
        {mine.map((m) =>
          m.author === "student" ? (
            <div key={m.id} className="max-w-[82%] self-end whitespace-pre-wrap break-words rounded-[12px] rounded-br-[3px] bg-[#2563EB] px-3 py-2 text-[12.5px] leading-snug text-white">
              {m.body}
              <small className="mt-1 block text-[10.5px] opacity-75">{timeLabel(m.createdAt)}</small>
            </div>
          ) : (
            <div key={m.id} className="max-w-[82%] self-start whitespace-pre-wrap break-words rounded-[12px] rounded-bl-[3px] bg-[#F1F5FB] px-3 py-2 text-[12.5px] leading-snug text-[#0B1F4D]">
              <b className="mb-0.5 block text-[10.5px] text-[#2563EB]">SPI team</b>
              {m.body}
              <small className="mt-1 block text-[10.5px] text-[#6B7280]">{timeLabel(m.createdAt)}</small>
            </div>
          ),
        )}
        {mine.length > 0 && mine[mine.length - 1]!.author === "student" && query.status !== "resolved" && (
          <p className="self-center rounded-full bg-[#EEF2F8] px-2.5 py-1 text-[10.5px] text-[#6B7280]">Received. The SPI team will reply here.</p>
        )}
        {query.status === "resolved" && <p className="self-center rounded-full bg-[#E8F7EE] px-2.5 py-1 text-[10.5px] font-semibold text-[#16A34A]">Resolved. Reply below if something is still wrong.</p>}
        <div ref={endRef} />
      </div>

      <div className="border-t border-[#E6ECF5] px-3 py-2.5">
        {error && (
          <p role="alert" className="mb-2 rounded-[8px] bg-[#FDECEF] px-2.5 py-1.5 text-[11.5px] text-[#9F1239]">
            {error}
          </p>
        )}
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <textarea
            value={text}
            maxLength={MAX_CHARS}
            rows={1}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder="Write a message…"
            aria-label="Your message"
            className="max-h-28 min-h-10 flex-1 resize-none rounded-[8px] border border-[#CBD5E1] px-3 py-2 text-[12.5px] text-[#0B1F4D] focus:border-[#2563EB] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20"
          />
          <button type="submit" disabled={!text.trim() || sending} className="min-h-10 rounded-[8px] bg-[#2563EB] px-4 text-[12.5px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">
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
      <div className="flex h-full w-full flex-col overflow-hidden bg-white shadow-[0_24px_60px_rgba(11,31,77,0.25)] sm:h-[min(640px,calc(100vh-3rem))] sm:max-w-[400px] sm:rounded-[18px]">
        {open ? (
          <QueryChat studentId={studentId} query={open} messages={thread.messages} onBack={() => setOpenId(null)} onRefresh={onRefresh} />
        ) : (
          <>
            <div className="flex items-center gap-2 border-b border-[#E6ECF5] px-4 py-3">
              <div className="min-w-0">
                <h2 className="text-[14px] font-bold text-[#0B1F4D]">My queries</h2>
                <p className="text-[11px] text-[#6B7280]">Your questions and the SPI team's replies</p>
              </div>
              <button type="button" onClick={onNew} className="ml-auto min-h-9 rounded-[8px] bg-[#2563EB] px-3 text-[12px] font-bold text-white">
                + New
              </button>
              <button type="button" onClick={onClose} className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-[#E6ECF5] text-[#0B1F4D]" aria-label="Close">
                ✕
              </button>
            </div>
            <QueryList thread={thread} onPick={setOpenId} />
          </>
        )}
      </div>
    </div>
  );
}
