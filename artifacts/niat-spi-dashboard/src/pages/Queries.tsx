import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCircle2, Clock, Hourglass, Inbox } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { MessageImages } from "@/components/QueryShots";
import { useQueryInboxSummary } from "@/hooks/useQueryInboxSummary";
import { QUERY_CATEGORIES, problemLabel } from "@/lib/queryCategories";
import {
  CATEGORY_DOT,
  STATUS_LABEL,
  STATUS_STYLE,
  categoryLabel,
  semesterLabel,
  sendJson,
  staffImageUrl,
  studentLabel,
  systemLine,
  timeLabel,
  type QueryStatus,
  type ThreadMessage,
  type ThreadQuery,
} from "@/lib/queryChat";

/**
 * Student queries (Admin and Super Admin only): a list with one row per category chat, and the selected chat
 * on the right. The subjects are shown once in the header; a reply goes to the chat that is open.
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
  subjectCount: number;
  status: QueryStatus;
  assignedTo: string | null;
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

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: "all", label: "All status" },
  { value: "received", label: "Needs reply" },
  { value: "in_progress", label: "In progress" },
  { value: "waiting_on_student", label: "Waiting on student" },
  { value: "resolved", label: "Resolved" },
];
const QUICK_REPLIES = [
  "Received, we are checking this.",
  "Please share more details (the date, class or quiz name).",
  "Fixed. It will show in your report within 24 hours.",
  "We checked, and your report is correct. Here is why: ",
];
const MAX_REPLY = 2000;
const SELECT = "h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-[12.5px] font-semibold text-brand-900";

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()) as T;
}

type StatusCounts = Record<QueryStatus, number>;

const KPI_CARDS: { status: QueryStatus; label: string; Icon: typeof Inbox; tint: string }[] = [
  { status: "received", label: "Needs reply", Icon: Inbox, tint: "bg-[#FDE8EE] text-[#BE123C]" },
  { status: "in_progress", label: "In progress", Icon: Clock, tint: "bg-[#FFF4DD] text-[#B45309]" },
  { status: "waiting_on_student", label: "Waiting on student", Icon: Hourglass, tint: "bg-[#EAF1FF] text-[#1D4FD8]" },
  { status: "resolved", label: "Resolved", Icon: CheckCircle2, tint: "bg-[#E8F7EE] text-[#15803D]" },
];

/**
 * How many chats are in each status (counted on the server for the chosen college, category and search).
 * Each card filters the list to that status; pressing the chosen card again shows every status.
 */
function KpiCards({ counts, status, onPick }: { counts: StatusCounts | undefined; status: string; onPick: (status: string) => void }) {
  return (
    <div className="mt-4 grid grid-cols-2 gap-2.5 lg:grid-cols-4" role="group" aria-label="Filter by status">
      {KPI_CARDS.map(({ status: s, label, Icon, tint }) => {
        const active = status === s;
        const n = counts?.[s];
        return (
          <button
            key={s}
            type="button"
            aria-pressed={active}
            aria-label={`${label}: ${n ?? "loading"}`}
            onClick={() => onPick(active ? "all" : s)}
            className={`flex min-h-14 items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 ${active ? "border-brand-600 bg-brand-50 ring-1 ring-brand-600" : "border-slate-200 bg-white"}`}
          >
            <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${tint}`} aria-hidden>
              <Icon className="h-[18px] w-[18px]" />
            </span>
            <span className="min-w-0">
              <span className="block min-w-[2ch] text-[22px] font-bold leading-none tabular-nums text-brand-900">{n ?? "–"}</span>
              <span className="mt-1 block truncate text-[12px] font-medium text-slate-600">{label}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
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
  const [allSubjects, setAllSubjects] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setText("");
    setNote(false);
    setError(null);
    setAllSubjects(false);
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
    // A reply moves a chat that was waiting for the team to "In progress"; any other status stays as the team set it.
    const status = data.query.status === "received" ? "in_progress" : data.query.status;
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

  const changeStatus = async (next: QueryStatus) => {
    setError(null);
    const res = await sendJson(`/api/query-inbox/queries/${queryId}/status`, { status: next });
    if (!res.ok) setError(res.error ?? "Could not change the status.");
    else await refreshAll();
  };

  /** Puts text into the reply box at the cursor: a quick reply or a subject name. */
  const insert = (piece: string) => {
    setText((t) => (t && !t.endsWith(" ") && !t.endsWith("\n") ? `${t} ${piece}` : `${t}${piece}`));
    boxRef.current?.focus();
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
          {query.status !== "resolved" && (
            <button type="button" onClick={() => void changeStatus("resolved")} className="min-h-8 shrink-0 rounded-lg border border-[#16A34A] px-3 text-[12px] font-bold text-[#16A34A] hover:bg-[#E8F7EE]">
              Mark resolved
            </button>
          )}
          <a href={`/spi/${student.studentId}`} target="_blank" rel="noreferrer" className="shrink-0 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11.5px] font-semibold text-brand-900 hover:bg-slate-50">
            Open report
          </a>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
          <span className="h-2 w-2 rounded-full" style={{ background: CATEGORY_DOT[query.category] ?? "#2563EB" }} aria-hidden />
          <b className="text-brand-900">{categoryLabel(query.category)}</b>
          <select
            value={query.status}
            onChange={(e) => void changeStatus(e.target.value as QueryStatus)}
            aria-label="Status"
            className={`cursor-pointer rounded-full border-0 px-2 py-0.5 text-[10.5px] font-bold focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 ${STATUS_STYLE[query.status]}`}
          >
            {(["received", "in_progress", "waiting_on_student", "resolved"] as QueryStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL.staff[s]}
              </option>
            ))}
          </select>
          {otherQueries > 0 && (
            <button type="button" onClick={() => onShowStudent(student.studentId)} className="ml-auto text-[11.5px] font-semibold text-brand-600 hover:underline">
              +{otherQueries} other {otherQueries === 1 ? "chat" : "chats"}
            </button>
          )}
        </div>
        <p className="mt-1.5 text-[12px] leading-snug text-slate-700">
          <b className="text-brand-900">{query.subjects.length === 1 ? "Subject:" : "Subjects:"}</b>{" "}
          {allSubjects || query.subjects.length <= 2 ? query.subjects.join(", ") : query.subjects.slice(0, 2).join(", ")}
          {query.subjects.length > 2 && (
            <button type="button" onClick={() => setAllSubjects((v) => !v)} className="ml-1.5 font-semibold text-brand-600 hover:underline">
              {allSubjects ? "show less" : `+${query.subjects.length - 2} more`}
            </button>
          )}
        </p>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto bg-[#FAFCFF] px-4 py-3">
        {messages.map((m) => {
          if (m.author === "system") {
            return (
              <p key={m.id} className="self-center rounded-full bg-slate-100 px-2.5 py-1 text-[11px] text-slate-500">
                {systemLine(m.body, "staff")}
              </p>
            );
          }
          const images = (m.attachments ?? []).map((a) => staffImageUrl(a.token));
          const problem = problemLabel(query.category, m.problem);
          if (m.internal) {
            return (
              <div key={m.id} className="w-[78%] self-center rounded-[10px] border border-dashed border-[#F0C96B] bg-[#FFF8E1] px-3 py-2 text-[12px] text-[#7A5B00]">
                Internal note (the student cannot see this) · {m.authorName}
                <p className="mt-0.5 whitespace-pre-wrap break-words">{m.body}</p>
              </div>
            );
          }
          return m.author === "student" ? (
            <div key={m.id} className="max-w-[72%] self-start whitespace-pre-wrap break-words rounded-[12px] rounded-bl-[3px] border border-slate-200 bg-white px-3 py-2 text-[12.5px] leading-snug text-brand-900">
              {problem && <b className="mb-0.5 block">{problem}</b>}
              {m.body}
              <MessageImages urls={images} />
              <small className="mt-1 block text-[10.5px] opacity-60">
                Student · {timeLabel(m.createdAt)}
                {images.length > 0 ? ` · ${images.length} screenshot${images.length === 1 ? "" : "s"}` : ""}
              </small>
            </div>
          ) : (
            <div key={m.id} className="max-w-[72%] self-end whitespace-pre-wrap break-words rounded-[12px] rounded-br-[3px] bg-[#2563EB] px-3 py-2 text-[12.5px] leading-snug text-white">
              {m.body}
              <small className="mt-1 block text-[10.5px] opacity-75">
                {m.authorName} · {timeLabel(m.createdAt)}
              </small>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      <div className="border-t border-slate-200 bg-white px-4 py-2.5">
        <div className="mb-2 flex flex-wrap items-center gap-1">
          <div className="flex items-center gap-1" role="tablist" aria-label="Message type">
            <button type="button" role="tab" aria-selected={!note} onClick={() => setNote(false)} className={`rounded-md px-2.5 py-1 text-[12px] font-bold ${!note ? "bg-[#EAF1FF] text-[#2563EB]" : "text-slate-500"}`}>
              Reply
            </button>
            <button type="button" role="tab" aria-selected={note} onClick={() => setNote(true)} className={`rounded-md px-2.5 py-1 text-[12px] font-bold ${note ? "bg-[#FFF4DD] text-[#D97706]" : "text-slate-500"}`}>
              Internal note
            </button>
          </div>
          <span className="ml-auto flex flex-wrap items-center gap-2">
            {!note && (
              <select aria-label="Quick reply" value="" onChange={(e) => e.target.value && insert(e.target.value)} className="h-8 max-w-[160px] rounded-md border border-slate-200 bg-white px-2 text-[12px] font-semibold text-slate-600">
                <option value="">Quick reply</option>
                {QUICK_REPLIES.map((c) => (
                  <option key={c} value={c}>
                    {c.length > 48 ? `${c.slice(0, 46)}…` : c}
                  </option>
                ))}
              </select>
            )}
            {query.subjects.length > 1 && (
              <select aria-label="Add a subject name to the message" value="" onChange={(e) => e.target.value && insert(e.target.value)} className="h-8 max-w-[160px] rounded-md border border-slate-200 bg-white px-2 text-[12px] font-semibold text-slate-600">
                <option value="">Add subject</option>
                {query.subjects.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            )}
          </span>
        </div>
        {error && (
          <p role="alert" className="mb-2 rounded-lg bg-[#FDECEF] px-2.5 py-1.5 text-[12px] text-[#9F1239]">
            {error}
          </p>
        )}
        <div className="flex items-end gap-2">
          <textarea
            ref={boxRef}
            value={text}
            maxLength={MAX_REPLY}
            rows={2}
            onChange={(e) => setText(e.target.value)}
            placeholder={note ? "Write a note for the team (the student will not see it)…" : "Write a reply the student will see…"}
            aria-label={note ? "Internal note" : "Reply"}
            className={`min-w-0 flex-1 resize-y rounded-lg border px-3 py-2 text-[12.5px] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 ${note ? "border-[#F0C96B] bg-[#FFFDF3]" : "border-slate-300"}`}
          />
          <button type="button" onClick={() => void send()} disabled={!text.trim() || sending} className="min-h-10 shrink-0 rounded-lg bg-[#2563EB] px-4 text-[12.5px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">
            {sending ? "Sending…" : note ? "Save note" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Queries() {
  // The team opens on what is waiting for a reply.
  const [status, setStatus] = useState("received");
  const [category, setCategory] = useState("all");
  const [college, setCollege] = useState("all");
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
    queryKey: ["query-inbox", status, category, college, term, page],
    refetchInterval: 30_000,
    // Keep the old rows and counts on screen while a filter change loads, so nothing jumps.
    placeholderData: (previous) => previous,
    queryFn: () => getJson<{ queries: InboxQuery[]; hasMore: boolean; counts: StatusCounts }>(`/api/query-inbox/queries?status=${status}&category=${category}&college=${encodeURIComponent(college)}&q=${encodeURIComponent(term)}&page=${page}`),
  });
  const queries = data?.queries ?? [];
  const { data: collegeData } = useQuery({ queryKey: ["query-inbox-colleges"], staleTime: 5 * 60_000, queryFn: () => getJson<{ colleges: string[] }>("/api/query-inbox/colleges") });

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Student queries"
        subtitle="Replies appear in the student's SPI report."
        right={
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by student name or ID"
              aria-label="Search queries"
              className="h-9 w-52 rounded-lg border border-slate-200 bg-white px-2.5 text-[12.5px] focus:border-brand-600 focus:outline-none"
            />
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(0);
              }}
              aria-label="Status"
              className={SELECT}
            >
              {STATUS_FILTERS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
            <select
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                setPage(0);
              }}
              aria-label="Category"
              className={SELECT}
            >
              <option value="all">All categories</option>
              {QUERY_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
            <select
              value={college}
              onChange={(e) => {
                setCollege(e.target.value);
                setPage(0);
              }}
              aria-label="College"
              className={`${SELECT} max-w-[200px] truncate`}
            >
              <option value="all">All colleges</option>
              {(collegeData?.colleges ?? []).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <QueryBell onOpen={(id) => setSelected(id)} />
          </div>
        }
      />

      <KpiCards
        counts={data?.counts}
        status={status}
        onPick={(next) => {
          setStatus(next);
          setPage(0);
        }}
      />

      <div className="mt-3 grid h-[calc(100vh-300px)] min-h-[480px] overflow-hidden rounded-xl border border-slate-200 bg-white md:grid-cols-[340px_minmax(0,1fr)]">
        <div className={`min-h-0 flex-col overflow-hidden border-r border-slate-200 ${selected ? "hidden md:flex" : "flex"}`}>
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {isLoading && <li className="px-4 py-6 text-center text-[12.5px] text-slate-500">Loading…</li>}
            {isError && <li className="px-4 py-6 text-center text-[12.5px] text-red-600">Could not load the queries.</li>}
            {!isLoading && !isError && queries.length === 0 && <li className="px-4 py-8 text-center text-[12.5px] text-slate-500">{status === "received" ? "Nothing is waiting for a reply." : "No queries found."}</li>}
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
                    <b className="text-slate-700">{categoryLabel(q.category)}</b>
                  </span>
                  <span className="mt-1 flex items-center justify-between gap-2 text-[11.5px] text-slate-500">
                    <span>
                      {q.subjectCount} {q.subjectCount === 1 ? "subject" : "subjects"}
                    </span>
                    <span className="shrink-0 text-slate-400">{timeLabel(q.lastAt)}</span>
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
                setStatus("all");
                setCategory("all");
                setCollege("all");
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
