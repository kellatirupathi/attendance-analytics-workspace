import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { useQueryInboxSummary } from "@/hooks/useQueryInboxSummary";
import {
  CATEGORY_DOT,
  STATUS_LABEL,
  STATUS_STYLE,
  categoryLabel,
  semesterLabel,
  sendJson,
  studentLabel,
  timeLabel,
  type QueryStatus,
  type ThreadMessage,
  type ThreadQuery,
} from "@/lib/queryChat";

/**
 * Student queries (Admin and Super Admin only): a list with one row per query, and the chat of the
 * selected query on the right. A reply always goes to the query that is open, so nothing is mixed.
 */

interface InboxQuery {
  id: number;
  studentId: string;
  name: string | null;
  college: string | null;
  section: string | null;
  isTest: boolean;
  category: string;
  subject: string;
  status: QueryStatus;
  assignedTo: string | null;
  lastAuthor: "student" | "ops";
  preview: string;
  lastAt: string;
}
interface QueryDetail {
  query: ThreadQuery;
  student: { studentId: string; name: string | null; college: string | null; semester: string | null; section: string | null };
  messages: ThreadMessage[];
  otherQueries: number;
}
interface BellItem {
  kind: "new_query" | "student_reply";
  studentId: string;
  name: string | null;
  queryId: number;
  category: string;
  subject: string;
  preview: string;
  at: string;
  unread: boolean;
}

const FILTERS = [
  { value: "needs_reply", label: "Needs reply" },
  { value: "open", label: "All open" },
  { value: "all", label: "Everything" },
];
const CANNED = [
  "Received, we are checking this.",
  "Please share more details (the date, class or quiz name).",
  "Fixed. It will show in your report within 24 hours.",
  "We checked, and your report is correct. Here is why: ",
];
const MAX_REPLY = 2000;

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()) as T;
}

function StatusPill({ status }: { status: QueryStatus }) {
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold ${STATUS_STYLE[status]}`}>{STATUS_LABEL.staff[status]}</span>;
}

function QueryBell({ onOpen }: { onOpen: (queryId: number) => void }) {
  const qc = useQueryClient();
  const { data: summary } = useQueryInboxSummary(true);
  const [open, setOpen] = useState(false);
  const { data } = useQuery({ queryKey: ["query-inbox-bell"], enabled: open, queryFn: () => getJson<{ items: BellItem[] }>("/api/query-inbox/bell") });
  const items = data?.items ?? [];
  const unread = summary?.unread ?? 0;

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next) await qc.invalidateQueries({ queryKey: ["query-inbox-bell"] });
  };
  const markSeen = async () => {
    await sendJson("/api/query-inbox/bell/seen", {});
    await qc.invalidateQueries({ queryKey: ["query-inbox-summary"] });
  };

  return (
    <div className="relative">
      <button type="button" onClick={() => void toggle()} aria-label={`Notifications, ${unread} new`} aria-expanded={open} className="relative grid h-9 w-9 place-items-center rounded-lg border border-slate-200 bg-white text-brand-900 hover:bg-slate-50">
        <Bell className="h-4 w-4" />
        {unread > 0 && <span className="absolute -right-1.5 -top-1.5 rounded-full border-2 border-white bg-[#E11D48] px-1.5 text-[10px] font-bold text-white">{unread > 99 ? "99+" : unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-30 w-[min(380px,calc(100vw-2rem))] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_16px_36px_rgba(11,31,77,0.18)]">
          <div className="flex items-center border-b border-slate-100 px-3.5 py-2.5">
            <b className="text-[13px] text-brand-900">Notifications</b>
            <button type="button" onClick={() => void markSeen()} className="ml-auto text-[11.5px] font-semibold text-brand-600">
              Mark all read
            </button>
          </div>
          <ul className="max-h-[360px] overflow-y-auto">
            {items.length === 0 && <li className="px-3.5 py-6 text-center text-[12px] text-slate-500">Nothing yet</li>}
            {items.map((n) => (
              <li key={`${n.kind}-${n.queryId}-${n.at}`}>
                <button
                  type="button"
                  onClick={() => {
                    onOpen(n.queryId);
                    setOpen(false);
                    void markSeen();
                  }}
                  className={`flex w-full gap-2.5 border-b border-slate-100 px-3.5 py-2.5 text-left hover:bg-slate-50 ${n.unread ? "bg-[#F6F9FF]" : ""}`}
                >
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: n.unread ? "#2563EB" : "transparent" }} aria-hidden />
                  <span className="min-w-0">
                    <b className="block truncate text-[12.5px] text-brand-900">
                      {n.kind === "new_query" ? "New query" : "Student replied"} · {studentLabel(n.name, n.studentId)}
                    </b>
                    <span className="block truncate text-[11.5px] text-slate-600">
                      {categoryLabel(n.category)}: {n.preview}
                    </span>
                    <small className="text-[10.5px] text-slate-400">{timeLabel(n.at)}</small>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ChatPane({ queryId, onBack, onShowStudent }: { queryId: number; onBack: () => void; onShowStudent: (studentId: string) => void }) {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["query-inbox-query", queryId],
    refetchInterval: 15_000,
    queryFn: () => getJson<QueryDetail>(`/api/query-inbox/queries/${queryId}`),
  });
  const [text, setText] = useState("");
  const [note, setNote] = useState(false);
  const [status, setStatus] = useState<QueryStatus>("in_progress");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setText("");
    setNote(false);
    setError(null);
    setStatus("in_progress");
  }, [queryId]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [data?.messages.length, queryId]);

  const refreshAll = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["query-inbox-query", queryId] }),
      qc.invalidateQueries({ queryKey: ["query-inbox"] }),
      qc.invalidateQueries({ queryKey: ["query-inbox-summary"] }),
    ]);
  };

  const send = async () => {
    const body = text.trim();
    if (!body || sending || !data) return;
    setSending(true);
    setError(null);
    const res = await sendJson("/api/query-inbox/reply", { studentId: data.student.studentId, queryIds: [queryId], body, internal: note, status });
    setSending(false);
    if (!res.ok) {
      setError(res.error ?? "Could not send the reply.");
      return;
    }
    setText("");
    setNote(false);
    await refreshAll();
  };

  const resolve = async () => {
    const res = await sendJson(`/api/query-inbox/queries/${queryId}/status`, { status: "resolved" });
    if (!res.ok) setError(res.error ?? "Could not change the status.");
    else await refreshAll();
  };

  if (isLoading) return <div className="grid flex-1 place-items-center text-[13px] text-slate-500">Loading…</div>;
  if (isError || !data) return <div className="grid flex-1 place-items-center text-[13px] text-red-600">Could not load this query.</div>;

  const { query, student, messages, otherQueries } = data;
  const place = [student.college, semesterLabel(student.semester), student.section].filter(Boolean).join(" · ");
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="border-b border-slate-200 px-4 py-3">
        <div className="flex items-start gap-2">
          <button type="button" onClick={onBack} className="rounded-md px-1.5 py-1 text-[12px] font-semibold text-brand-600 md:hidden">
            ← Back
          </button>
          <div className="min-w-0 flex-1">
            <b className="block truncate text-[15px] text-brand-900">{studentLabel(student.name, student.studentId)}</b>
            <small className="block truncate text-[11.5px] text-slate-500">{place || student.studentId}</small>
          </div>
          <StatusPill status={query.status} />
          <a href={`/spi/${student.studentId}`} target="_blank" rel="noreferrer" className="shrink-0 rounded-lg border border-slate-200 px-2.5 py-1 text-[11.5px] font-semibold text-brand-900 hover:bg-slate-50">
            Open report
          </a>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
          <span className="h-2 w-2 rounded-full" style={{ background: CATEGORY_DOT[query.category] ?? "#2563EB" }} aria-hidden />
          <b className="text-brand-900">{categoryLabel(query.category)}</b>
          <span className="text-slate-500">· {query.subject}</span>
          {otherQueries > 0 && (
            <button type="button" onClick={() => onShowStudent(student.studentId)} className="ml-auto text-[11.5px] font-semibold text-brand-600 hover:underline">
              This student has {otherQueries} other {otherQueries === 1 ? "query" : "queries"}
            </button>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto bg-[#FAFCFF] px-4 py-3">
        {messages.map((m) =>
          m.internal ? (
            <div key={m.id} className="w-[78%] self-center rounded-[10px] border border-dashed border-[#F0C96B] bg-[#FFF8E1] px-3 py-2 text-[12px] text-[#7A5B00]">
              Internal note (the student cannot see this) · {m.authorName}
              <p className="mt-0.5 whitespace-pre-wrap break-words">{m.body}</p>
            </div>
          ) : m.author === "student" ? (
            <div key={m.id} className="max-w-[72%] self-start whitespace-pre-wrap break-words rounded-[12px] rounded-bl-[3px] border border-slate-200 bg-white px-3 py-2 text-[12.5px] leading-snug text-brand-900">
              {m.body}
              <small className="mt-1 block text-[10.5px] opacity-60">{timeLabel(m.createdAt)}</small>
            </div>
          ) : (
            <div key={m.id} className="max-w-[72%] self-end whitespace-pre-wrap break-words rounded-[12px] rounded-br-[3px] bg-[#2563EB] px-3 py-2 text-[12.5px] leading-snug text-white">
              {m.body}
              <small className="mt-1 block text-[10.5px] opacity-75">
                {m.authorName} · {timeLabel(m.createdAt)}
              </small>
            </div>
          ),
        )}
        <div ref={endRef} />
      </div>

      <div className="border-t border-slate-200 bg-white px-4 py-2.5">
        <div className="mb-2 flex items-center gap-1" role="tablist" aria-label="Message type">
          <button type="button" role="tab" aria-selected={!note} onClick={() => setNote(false)} className={`rounded-md px-2.5 py-1 text-[12px] font-bold ${!note ? "bg-[#EAF1FF] text-[#2563EB]" : "text-slate-500"}`}>
            Reply to student
          </button>
          <button type="button" role="tab" aria-selected={note} onClick={() => setNote(true)} className={`rounded-md px-2.5 py-1 text-[12px] font-bold ${note ? "bg-[#FFF4DD] text-[#D97706]" : "text-slate-500"}`}>
            Internal note
          </button>
        </div>
        {!note && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {CANNED.map((c) => (
              <button key={c} type="button" onClick={() => setText((t) => (t ? `${t} ${c}` : c))} className="rounded-full bg-[#EAF1FF] px-2.5 py-1 text-[11px] font-semibold text-[#2563EB]">
                {c.length > 34 ? `${c.slice(0, 32)}…` : c}
              </button>
            ))}
          </div>
        )}
        {error && (
          <p role="alert" className="mb-2 rounded-lg bg-[#FDECEF] px-2.5 py-1.5 text-[12px] text-[#9F1239]">
            {error}
          </p>
        )}
        <textarea
          value={text}
          maxLength={MAX_REPLY}
          rows={3}
          onChange={(e) => setText(e.target.value)}
          placeholder={note ? "Write a note for the team (the student will not see it)…" : "Write a reply the student will see in their report…"}
          aria-label={note ? "Internal note" : "Reply"}
          className={`w-full resize-y rounded-lg border px-3 py-2 text-[12.5px] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 ${note ? "border-[#F0C96B] bg-[#FFFDF3]" : "border-slate-300"}`}
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {!note && (
            <label className="flex items-center gap-1.5 text-[12px] text-slate-600">
              After sending:
              <select value={status} onChange={(e) => setStatus(e.target.value as QueryStatus)} className="rounded-md border border-slate-200 px-1.5 py-1 text-[12px] font-semibold text-brand-900">
                <option value="in_progress">In progress</option>
                <option value="waiting_on_student">Waiting on student</option>
                <option value="resolved">Resolved</option>
              </select>
            </label>
          )}
          <span className="ml-auto flex items-center gap-2">
            {query.status !== "resolved" && (
              <button type="button" onClick={() => void resolve()} className="min-h-9 rounded-lg border border-[#16A34A] px-3 text-[12px] font-bold text-[#16A34A] hover:bg-[#E8F7EE]">
                Mark resolved
              </button>
            )}
            <button type="button" onClick={() => void send()} disabled={!text.trim() || sending} className="min-h-9 rounded-lg bg-[#2563EB] px-4 text-[12.5px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">
              {sending ? "Sending…" : note ? "Save note" : "Send reply"}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}

export default function Queries() {
  const [filter, setFilter] = useState("needs_reply");
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);

  useEffect(() => {
    const id = setTimeout(() => {
      setTerm(search.trim());
      setPage(0);
    }, 300);
    return () => clearTimeout(id);
  }, [search]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["query-inbox", filter, term, page],
    refetchInterval: 30_000,
    queryFn: () => getJson<{ queries: InboxQuery[]; hasMore: boolean }>(`/api/query-inbox/queries?filter=${filter}&q=${encodeURIComponent(term)}&page=${page}`),
  });
  const queries = data?.queries ?? [];

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Student queries"
        subtitle="Each query is its own chat. Your reply appears in that query in the student's SPI report."
        right={
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                setPage(0);
              }}
              aria-label="Show"
              className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-[12.5px] font-semibold text-brand-900"
            >
              {FILTERS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name or student ID"
              aria-label="Search queries"
              className="h-9 w-48 rounded-lg border border-slate-200 bg-white px-2.5 text-[12.5px] focus:border-brand-600 focus:outline-none"
            />
            <QueryBell onOpen={(id) => setSelected(id)} />
          </div>
        }
      />

      <div className="mt-4 grid h-[calc(100vh-210px)] min-h-[520px] overflow-hidden rounded-xl border border-slate-200 bg-white md:grid-cols-[340px_minmax(0,1fr)]">
        <div className={`min-h-0 flex-col overflow-hidden border-r border-slate-200 ${selected ? "hidden md:flex" : "flex"}`}>
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {isLoading && <li className="px-4 py-6 text-center text-[12.5px] text-slate-500">Loading…</li>}
            {isError && <li className="px-4 py-6 text-center text-[12.5px] text-red-600">Could not load the queries.</li>}
            {!isLoading && !isError && queries.length === 0 && <li className="px-4 py-8 text-center text-[12.5px] text-slate-500">{filter === "needs_reply" ? "Nothing is waiting for a reply." : "No queries found."}</li>}
            {queries.map((q) => (
              <li key={q.id}>
                <button
                  type="button"
                  onClick={() => setSelected(q.id)}
                  aria-current={selected === q.id}
                  className={`block w-full border-b border-slate-100 px-3.5 py-3 text-left hover:bg-slate-50 ${selected === q.id ? "bg-[#F3F7FF] shadow-[inset_3px_0_0_#2563EB]" : ""}`}
                >
                  <span className="flex items-center gap-2">
                    <b className="min-w-0 flex-1 truncate text-[13px] text-brand-900">
                      {studentLabel(q.name, q.studentId)}
                      {q.isTest && <span className="ml-1.5 rounded bg-slate-100 px-1 text-[9.5px] font-bold text-slate-500">TEST</span>}
                    </b>
                    <StatusPill status={q.status} />
                  </span>
                  <span className="mt-1 flex items-center gap-1.5 text-[12px]">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: CATEGORY_DOT[q.category] ?? "#2563EB" }} aria-hidden />
                    <b className="shrink-0 text-slate-700">{categoryLabel(q.category)}</b>
                    <span className="truncate text-slate-500">· {q.subject}</span>
                  </span>
                  <span className="mt-1 flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[12px] text-slate-600">
                      <span className="text-slate-400">{q.lastAuthor === "ops" ? "You: " : "Student: "}</span>
                      {q.preview}
                    </span>
                    <small className="shrink-0 text-[10.5px] text-slate-400">{timeLabel(q.lastAt)}</small>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {(page > 0 || data?.hasMore) && (
            <div className="flex items-center justify-between border-t border-slate-200 px-3 py-2 text-[12px]">
              <button type="button" disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="font-semibold text-brand-600 disabled:opacity-40">
                Previous
              </button>
              <span className="text-slate-500">Page {page + 1}</span>
              <button type="button" disabled={!data?.hasMore} onClick={() => setPage((p) => p + 1)} className="font-semibold text-brand-600 disabled:opacity-40">
                Next
              </button>
            </div>
          )}
        </div>
        <div className={`min-h-0 min-w-0 ${selected ? "flex" : "hidden md:flex"}`}>
          {selected ? (
            <ChatPane
              queryId={selected}
              onBack={() => setSelected(null)}
              onShowStudent={(id) => {
                setFilter("all");
                setSearch(id);
              }}
            />
          ) : (
            <div className="grid flex-1 place-items-center text-[13px] text-slate-500">Choose a query to open its chat.</div>
          )}
        </div>
      </div>
    </div>
  );
}
