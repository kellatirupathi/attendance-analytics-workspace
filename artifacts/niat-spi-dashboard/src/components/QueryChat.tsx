import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CATEGORY_DOT,
  STATUS_LABEL,
  STATUS_STYLE,
  categoryLabel,
  sendJson,
  timeLabel,
  type Thread,
  type ThreadQuery,
} from "@/lib/queryChat";

/**
 * The student's side of "Raise a query": one chat with the SPI team for all of their queries.
 * useStudentThread keeps the conversation fresh (the report page uses it for the "My queries" badge);
 * QueryChatSheet is the chat itself.
 */

interface StudentThread extends Thread {
  unread: number;
}

const EMPTY: StudentThread = { queries: [], messages: [], unread: 0 };
const MAX_CHARS = 2000;

/** Loads the student's conversation and refreshes it every `pollMs` while the tab is visible. */
export function useStudentThread(studentId: string | undefined, pollMs: number) {
  const [thread, setThread] = useState<StudentThread>(EMPTY);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    if (!studentId) return;
    try {
      const res = await fetch(`/api/spi-queries/thread?student=${encodeURIComponent(studentId)}`, { credentials: "include" });
      if (!res.ok) return;
      setThread((await res.json()) as StudentThread);
      setLoaded(true);
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

  return { thread, loaded, refresh, setThread };
}

function Dot({ category }: { category: string }) {
  return <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: CATEGORY_DOT[category] ?? "#2563EB" }} aria-hidden />;
}

function QueryHeader({ q }: { q: ThreadQuery }) {
  return (
    <div className="flex items-center gap-2 rounded-[10px] border border-[#D5DEEC] bg-white px-2.5 py-2 text-[12px]">
      <Dot category={q.category} />
      <span className="min-w-0 truncate">
        <b className="text-[#0B1F4D]">{categoryLabel(q.category)}</b> <span className="text-[#6B7280]">· {q.subject}</span>
      </span>
      <span className={`ml-auto shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold ${STATUS_STYLE[q.status]}`}>{STATUS_LABEL.student[q.status]}</span>
    </div>
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
  const { queries, messages } = thread;
  const byId = useMemo(() => new Map(queries.map((q) => [q.id, q])), [queries]);
  // The reply is about the newest query that is still open (else the newest one); the chips switch it.
  const defaultQuery = useMemo(() => [...queries].reverse().find((q) => q.status !== "resolved")?.id ?? queries[queries.length - 1]?.id ?? 0, [queries]);
  const [picked, setPicked] = useState<number | null>(null);
  const target = picked && byId.has(picked) ? picked : defaultQuery;
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // Opening the chat counts the team's replies as read.
  useEffect(() => {
    void sendJson("/api/spi-queries/read", { student: studentId }).then(() => onRefresh());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  const send = async () => {
    const body = text.trim();
    if (!body || !target || sending) return;
    setSending(true);
    setError(null);
    const res = await sendJson(`/api/spi-queries/${target}/messages`, { student: studentId, body });
    setSending(false);
    if (!res.ok) {
      setError(res.error ?? "Could not send your message.");
      return;
    }
    setText("");
    await onRefresh();
  };

  return (
    <div className="fixed inset-0 z-50 grid bg-[#0B1F4D]/35 sm:place-items-end sm:p-6" onClick={(e) => e.target === e.currentTarget && onClose()} role="dialog" aria-modal="true" aria-label="My queries">
      <div className="flex h-full w-full flex-col overflow-hidden bg-white shadow-[0_24px_60px_rgba(11,31,77,0.25)] sm:h-[min(640px,92vh)] sm:max-w-[400px] sm:rounded-[18px]">
        <div className="flex items-center gap-2 border-b border-[#E6ECF5] px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-[14px] font-bold text-[#0B1F4D]">My queries</h2>
            <p className="text-[11px] text-[#6B7280]">Chat with the SPI team</p>
          </div>
          <button type="button" onClick={onNew} className="ml-auto min-h-9 rounded-[8px] bg-[#2563EB] px-3 text-[12px] font-bold text-white">
            + New
          </button>
          <button type="button" onClick={onClose} className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-[#E6ECF5] text-[#0B1F4D]" aria-label="Close">
            ✕
          </button>
        </div>

        <div className="flex flex-1 flex-col gap-2 overflow-y-auto bg-[#FAFCFF] px-3.5 py-3" aria-live="polite">
          {messages.map((m) => {
            const q = byId.get(m.queryId);
            return (
              <div key={m.id} className="contents">
                {m.id < 0 && q && <QueryHeader q={q} />}
                {m.author === "student" ? (
                  <div className="max-w-[82%] self-end whitespace-pre-wrap break-words rounded-[12px] rounded-br-[3px] bg-[#2563EB] px-3 py-2 text-[12.5px] leading-snug text-white">
                    {m.body}
                    <small className="mt-1 block text-[10.5px] opacity-75">{timeLabel(m.createdAt)}</small>
                  </div>
                ) : (
                  <div className="max-w-[82%] self-start whitespace-pre-wrap break-words rounded-[12px] rounded-bl-[3px] bg-[#F1F5FB] px-3 py-2 text-[12.5px] leading-snug text-[#0B1F4D]">
                    <b className="mb-0.5 block text-[10.5px] text-[#2563EB]">SPI team{q ? ` · ${categoryLabel(q.category)}` : ""}</b>
                    {m.body}
                    <small className="mt-1 block text-[10.5px] text-[#6B7280]">{timeLabel(m.createdAt)}</small>
                  </div>
                )}
              </div>
            );
          })}
          {messages.length > 0 && messages[messages.length - 1]!.author === "student" && (
            <p className="self-center rounded-full bg-[#EEF2F8] px-2.5 py-1 text-[10.5px] text-[#6B7280]">Received. The SPI team will reply here.</p>
          )}
          <div ref={endRef} />
        </div>

        <div className="border-t border-[#E6ECF5] px-3 py-2.5">
          {queries.length > 1 && (
            <div className="mb-2 flex flex-wrap gap-1.5" role="group" aria-label="This reply is about">
              {queries.map((q) => (
                <button
                  key={q.id}
                  type="button"
                  onClick={() => setPicked(q.id)}
                  aria-pressed={q.id === target}
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${q.id === target ? "border-[#BBD0FF] bg-[#EAF1FF] text-[#2563EB]" : "border-[#D5DEEC] bg-white text-[#6B7280]"}`}
                >
                  {categoryLabel(q.category)}
                  {q.status === "resolved" ? " ✓" : ""}
                </button>
              ))}
            </div>
          )}
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
              placeholder={target && byId.get(target) ? `Reply about ${categoryLabel(byId.get(target)!.category)}…` : "Write a message…"}
              aria-label="Your message"
              className="max-h-28 min-h-10 flex-1 resize-none rounded-[8px] border border-[#CBD5E1] px-3 py-2 text-[12.5px] text-[#0B1F4D] focus:border-[#2563EB] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20"
            />
            <button type="submit" disabled={!text.trim() || sending || !target} className="min-h-10 rounded-[8px] bg-[#2563EB] px-4 text-[12.5px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">
              {sending ? "…" : "Send"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
