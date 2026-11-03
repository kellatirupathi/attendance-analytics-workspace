import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { useQueryInboxSummary } from "@/hooks/useQueryInboxSummary";
import {
  CATEGORY_DOT,
  STATUS_LABEL,
  STATUS_STYLE,
  categoryLabel,
  sendJson,
  timeLabel,
  type QueryStatus,
  type Thread,
} from "@/lib/queryChat";

/**
 * Student queries (Admin and Super Admin only): one conversation per student, with every query they raised
 * as a header line inside it. The reply goes to the query chosen in "Replying to" (newest needing a reply by
 * default), or to all of the student's open queries at once.
 */

interface InboxStudent {
  studentId: string;
  name: string | null;
  college: string | null;
  section: string | null;
  isTest: boolean;
  total: number;
  needsReply: number;
  open: number;
  lastAt: string;
}
interface Conversation extends Thread {
  studentId: string;
  name: string | null;
  college: string | null;
  semester: string | null;
  section: string | null;
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

function QueryBell({ onOpen }: { onOpen: (studentId: string) => void }) {
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
                    onOpen(n.studentId);
                    setOpen(false);
                    void markSeen();
                  }}
                  className={`flex w-full gap-2.5 border-b border-slate-100 px-3.5 py-2.5 text-left hover:bg-slate-50 ${n.unread ? "bg-[#F6F9FF]" : ""}`}
                >
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: n.unread ? "#2563EB" : "transparent" }} aria-hidden />
                  <span className="min-w-0">
                    <b className="block truncate text-[12.5px] text-brand-900">
                      {n.kind === "new_query" ? "New query" : "Student replied"} · {n.name ?? n.studentId}
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

function StatusPill({ status }: { status: QueryStatus }) {
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold ${STATUS_STYLE[status]}`}>{STATUS_LABEL.staff[status]}</span>;
}

function ConversationPane({ studentId, onBack }: { studentId: string; onBack: () => void }) {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["query-inbox-student", studentId],
    refetchInterval: 15_000,
    queryFn: () => getJson<Conversation>(`/api/query-inbox/students/${encodeURIComponent(studentId)}`),
  });
  const queries = data?.queries ?? [];
  const messages = data?.messages ?? [];
  const byId = useMemo(() => new Map(queries.map((q) => [q.id, q])), [queries]);
  const openQueries = queries.filter((q) => q.status !== "resolved");
  const defaultTarget = useMemo(
    () => [...queries].reverse().find((q) => q.status === "received")?.id ?? [...queries].reverse().find((q) => q.status !== "resolved")?.id ?? queries[queries.length - 1]?.id ?? 0,
    [queries],
  );
  const [picked, setPicked] = useState<number | "all" | null>(null);
  const target: number | "all" = picked === "all" && openQueries.length > 1 ? "all" : typeof picked === "number" && byId.has(picked) ? picked : defaultTarget;
  const [text, setText] = useState("");
  const [internal, setInternal] = useState(false);
  const [status, setStatus] = useState<QueryStatus>("in_progress");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setPicked(null);
    setText("");
    setError(null);
  }, [studentId]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, studentId]);

  const refreshAll = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["query-inbox-student", studentId] }),
      qc.invalidateQueries({ queryKey: ["query-inbox"] }),
      qc.invalidateQueries({ queryKey: ["query-inbox-summary"] }),
    ]);
  };

  const send = async () => {
    const body = text.trim();
    if (!body || sending || !target) return;
    setSending(true);
    setError(null);
    const queryIds = target === "all" ? openQueries.map((q) => q.id) : [target];
    const res = await sendJson("/api/query-inbox/reply", { studentId, queryIds, body, internal, status });
    setSending(false);
    if (!res.ok) {
      setError(res.error ?? "Could not send the reply.");
      return;
    }
    setText("");
    setInternal(false);
    await refreshAll();
  };

  const resolve = async () => {
    if (target === "all" || !target) return;
    const res = await sendJson(`/api/query-inbox/queries/${target}/status`, { status: "resolved" });
    if (!res.ok) setError(res.error ?? "Could not change the status.");
    else await refreshAll();
  };

  if (isLoading) return <div className="grid flex-1 place-items-center text-[13px] text-slate-500">Loading…</div>;
  if (isError || !data) return <div className="grid flex-1 place-items-center text-[13px] text-red-600">Could not load this conversation.</div>;

  const targetQuery = target === "all" ? null : byId.get(target);
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-slate-200 px-4 py-2.5">
        <button type="button" onClick={onBack} className="rounded-md px-1.5 py-1 text-[12px] font-semibold text-brand-600 md:hidden">
          ← Back
        </button>
        <b className="text-[14px] text-brand-900">{data.name ?? data.studentId}</b>
        <small className="text-[11px] text-slate-500">{[data.college, data.semester && `Sem ${data.semester}`, data.section && `Sec ${data.section}`].filter(Boolean).join(" · ")}</small>
        <a href={`/spi/${data.studentId}`} target="_blank" rel="noreferrer" className="ml-auto rounded-lg border border-slate-200 px-2.5 py-1 text-[11.5px] font-semibold text-brand-900 hover:bg-slate-50">
          Open report
        </a>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto bg-[#FAFCFF] px-4 py-3">
        {messages.map((m) => {
          const q = byId.get(m.queryId);
          return (
            <div key={m.id} className="contents">
              {m.id < 0 && q && (
                <div className="mt-1 flex items-center gap-2 rounded-[10px] border border-slate-300 bg-white px-2.5 py-2 text-[12px]">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: CATEGORY_DOT[q.category] ?? "#2563EB" }} aria-hidden />
                  <span className="min-w-0 truncate">
                    <b className="text-brand-900">
                      #{q.id} {categoryLabel(q.category)}
                    </b>{" "}
                    <span className="text-slate-500">· {q.subject}</span>
                  </span>
                  <span className="ml-auto flex shrink-0 items-center gap-2">
                    {q.assignedTo && <small className="text-[10.5px] text-slate-400">{q.assignedTo}</small>}
                    <StatusPill status={q.status} />
                  </span>
                </div>
              )}
              {m.internal ? (
                <div className="w-[78%] self-center rounded-[10px] border border-dashed border-[#F0C96B] bg-[#FFF8E1] px-3 py-2 text-[12px] text-[#7A5B00]">
                  Internal note (the student cannot see this) · {m.authorName}
                  <p className="mt-0.5 whitespace-pre-wrap break-words">{m.body}</p>
                </div>
              ) : m.author === "student" ? (
                <div className="max-w-[70%] self-start whitespace-pre-wrap break-words rounded-[12px] rounded-bl-[3px] border border-slate-200 bg-white px-3 py-2 text-[12.5px] leading-snug text-brand-900">
                  {m.id > 0 && q && <span className="mr-1.5 rounded-full bg-slate-100 px-1.5 py-px text-[10px] font-bold text-slate-600">{categoryLabel(q.category)}</span>}
                  {m.body}
                  <small className="mt-1 block text-[10.5px] opacity-60">{timeLabel(m.createdAt)}</small>
                </div>
              ) : (
                <div className="max-w-[70%] self-end whitespace-pre-wrap break-words rounded-[12px] rounded-br-[3px] bg-[#2563EB] px-3 py-2 text-[12.5px] leading-snug text-white">
                  {q && <span className="mr-1.5 rounded-full bg-white/20 px-1.5 py-px text-[10px] font-bold">{categoryLabel(q.category)}</span>}
                  {m.body}
                  <small className="mt-1 block text-[10.5px] opacity-75">
                    {m.authorName} · {timeLabel(m.createdAt)}
                  </small>
                </div>
              )}
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      <div className="border-t border-slate-200 bg-white px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 rounded-lg border border-[#BBD0FF] bg-[#EAF1FF] px-2 py-1 text-[12px] font-bold text-[#2563EB]">
            <span className="sr-only">Replying to</span>
            {targetQuery && <span className="h-2 w-2 rounded-full" style={{ background: CATEGORY_DOT[targetQuery.category] ?? "#2563EB" }} aria-hidden />}
            Replying to:
            <select
              value={target === "all" ? "all" : String(target)}
              onChange={(e) => setPicked(e.target.value === "all" ? "all" : Number(e.target.value))}
              className="max-w-[220px] bg-transparent font-bold focus:outline-none"
            >
              {queries.map((q) => (
                <option key={q.id} value={q.id}>
                  #{q.id} {categoryLabel(q.category)} · {STATUS_LABEL.staff[q.status]}
                </option>
              ))}
              {openQueries.length > 1 && <option value="all">All open queries ({openQueries.length})</option>}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-[12px] text-slate-600">
            <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} />
            Internal note
          </label>
          {!internal && (
            <label className="ml-auto flex items-center gap-1.5 text-[12px] text-slate-600">
              After sending:
              <select value={status} onChange={(e) => setStatus(e.target.value as QueryStatus)} className="rounded-md border border-slate-200 px-1.5 py-1 text-[12px] font-semibold text-brand-900">
                <option value="in_progress">In progress</option>
                <option value="waiting_on_student">Waiting on student</option>
                <option value="resolved">Resolved</option>
              </select>
            </label>
          )}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {CANNED.map((c) => (
            <button key={c} type="button" onClick={() => setText((t) => (t ? `${t} ${c}` : c))} className="rounded-full bg-[#EAF1FF] px-2.5 py-1 text-[11px] font-semibold text-[#2563EB]">
              {c.length > 34 ? `${c.slice(0, 32)}…` : c}
            </button>
          ))}
        </div>
        {error && (
          <p role="alert" className="mt-2 rounded-lg bg-[#FDECEF] px-2.5 py-1.5 text-[12px] text-[#9F1239]">
            {error}
          </p>
        )}
        <form
          className="mt-2 flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <textarea
            value={text}
            maxLength={MAX_REPLY}
            rows={2}
            onChange={(e) => setText(e.target.value)}
            placeholder={internal ? "Write a note for the team (the student will not see it)…" : target === "all" ? "This message goes into every open query of this student…" : "Write a reply the student will see in their report…"}
            aria-label="Reply"
            className={`min-h-12 flex-1 resize-y rounded-lg border px-3 py-2 text-[12.5px] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 ${internal ? "border-[#F0C96B] bg-[#FFFDF3]" : "border-slate-300"}`}
          />
          {targetQuery && targetQuery.status !== "resolved" && (
            <button type="button" onClick={() => void resolve()} className="min-h-10 rounded-lg border border-[#16A34A] px-3 text-[12px] font-bold text-[#16A34A] hover:bg-[#E8F7EE]">
              Mark resolved
            </button>
          )}
          <button type="submit" disabled={!text.trim() || sending} className="min-h-10 rounded-lg bg-[#2563EB] px-4 text-[12.5px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">
            {sending ? "Sending…" : internal ? "Save note" : "Send reply"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function Queries() {
  const [filter, setFilter] = useState("needs_reply");
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);

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
    queryFn: () => getJson<{ students: InboxStudent[]; hasMore: boolean }>(`/api/query-inbox/students?filter=${filter}&q=${encodeURIComponent(term)}&page=${page}`),
  });
  const students = data?.students ?? [];

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Student queries"
        subtitle="Replies appear in the student's chat in their SPI report."
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
              aria-label="Search students"
              className="h-9 w-48 rounded-lg border border-slate-200 bg-white px-2.5 text-[12.5px] focus:border-brand-600 focus:outline-none"
            />
            <QueryBell onOpen={(id) => setSelected(id)} />
          </div>
        }
      />

      <div className="mt-4 grid h-[calc(100vh-210px)] min-h-[520px] overflow-hidden rounded-xl border border-slate-200 bg-white md:grid-cols-[280px_minmax(0,1fr)]">
        <div className={`min-h-0 flex-col overflow-hidden border-r border-slate-200 ${selected ? "hidden md:flex" : "flex"}`}>
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {isLoading && <li className="px-4 py-6 text-center text-[12.5px] text-slate-500">Loading…</li>}
            {isError && <li className="px-4 py-6 text-center text-[12.5px] text-red-600">Could not load the queries.</li>}
            {!isLoading && !isError && students.length === 0 && <li className="px-4 py-8 text-center text-[12.5px] text-slate-500">{filter === "needs_reply" ? "Nothing is waiting for a reply." : "No queries found."}</li>}
            {students.map((s) => (
              <li key={s.studentId}>
                <button
                  type="button"
                  onClick={() => setSelected(s.studentId)}
                  aria-current={selected === s.studentId}
                  className={`flex w-full items-center gap-2.5 border-b border-slate-100 px-3 py-2.5 text-left hover:bg-slate-50 ${selected === s.studentId ? "bg-[#F3F7FF] shadow-[inset_3px_0_0_#2563EB]" : ""}`}
                >
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#EAF1FF] text-[10.5px] font-bold text-[#2563EB]">
                    {(s.name ?? s.studentId).split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <b className="block truncate text-[12.5px] text-brand-900">
                      {s.name ?? s.studentId}
                      {s.isTest && <span className="ml-1.5 rounded bg-slate-100 px-1 text-[9.5px] font-bold text-slate-500">TEST</span>}
                    </b>
                    <small className="block truncate text-[11px] text-slate-500">
                      {[s.college, `${s.total} ${s.total === 1 ? "query" : "queries"}`].filter(Boolean).join(" · ")}
                    </small>
                  </span>
                  {s.needsReply > 0 ? (
                    <span className="rounded-full bg-[#E11D48] px-1.5 text-[10.5px] font-bold text-white" aria-label={`${s.needsReply} need a reply`}>
                      {s.needsReply}
                    </span>
                  ) : (
                    <span className="rounded-full bg-slate-200 px-1.5 text-[10.5px] font-bold text-slate-600">{s.open > 0 ? "waiting" : "done"}</span>
                  )}
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
          {selected ? <ConversationPane studentId={selected} onBack={() => setSelected(null)} /> : <div className="grid flex-1 place-items-center text-[13px] text-slate-500">Choose a student to see the conversation.</div>}
        </div>
      </div>
    </div>
  );
}
