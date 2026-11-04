import { useEffect, useMemo, useState } from "react";
import { QUERY_CATEGORIES } from "@/lib/queryCategories";
import { CATEGORY_DOT, MAX_SHOTS, categoryLabel, type ThreadQuery } from "@/lib/queryChat";
import { ShotPicker, useShots } from "@/components/QueryShots";

/**
 * "Raise a query": pick a category, tick the subjects, say what is wrong, add screenshots if you like.
 * A category that already has an open chat takes the new subjects and message into that chat.
 */
const MAX_CHARS = 2000;
const FIELD = "w-full rounded-[10px] border border-[#CBD5E1] bg-white px-3 text-[13px] text-[#0B1F4D] focus:border-[#2563EB] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20";

export function RaiseQueryForm({
  studentId,
  subjects,
  chats,
  onClose,
  onSent,
  onOpenChat,
}: {
  studentId: string;
  /** Every subject the student's report shows. */
  subjects: string[];
  /** The student's chats so far (to find an open one in the chosen category). */
  chats: ThreadQuery[];
  onClose: () => void;
  onSent: () => void;
  /** Opens the student's chat list (shown after a query is sent). */
  onOpenChat: () => void;
}) {
  const [category, setCategory] = useState("");
  const [problem, setProblem] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [details, setDetails] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<null | { added: boolean }>(null);
  const shots = useShots(studentId);

  const problems = QUERY_CATEGORIES.find((c) => c.value === category)?.problems ?? [];
  // The newest chat in this category that is not resolved: new subjects go into it.
  const openChat = useMemo(() => [...chats].reverse().find((q) => q.category === category && q.status !== "resolved"), [chats, category]);
  const already = new Set(openChat?.subjects ?? []);
  const shown = subjects.filter((s) => s.toLowerCase().includes(search.trim().toLowerCase()));
  const selectable = shown.filter((s) => !already.has(s));
  const ready = Boolean(category && problem && details.trim() && (picked.length > 0 || openChat) && !shots.busy);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const toggle = (s: string) => setPicked((p) => (p.includes(s) ? p.filter((x) => x !== s) : [...p, s]));
  const allPicked = selectable.length > 0 && selectable.every((s) => picked.includes(s));

  const submit = async () => {
    if (!ready || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/spi-queries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          student: studentId,
          category,
          subCategory: problem,
          // Only existing subjects ticked (or none): the chat keeps what it has.
          subjects: picked.length > 0 ? picked : (openChat?.subjects ?? []),
          details: details.trim(),
          attachments: shots.tokens,
        }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string; added?: boolean } | null;
      if (!res.ok) throw new Error(res.status === 429 ? "Too many tries. Please wait a minute and submit again." : (body?.error ?? "Could not submit your query. Please try again."));
      setDone({ added: Boolean(body?.added) });
      onSent();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit your query. Please try again.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[#0B1F4D]/35 p-4" onClick={(e) => e.target === e.currentTarget && onClose()} role="dialog" aria-modal="true" aria-label="Raise a query">
      <div className="max-h-[92vh] w-full max-w-[460px] overflow-y-auto rounded-[18px] bg-white shadow-[0_24px_60px_rgba(11,31,77,0.25)]">
        {done ? (
          <div className="px-6 py-8 text-center">
            <span className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-[#E6F7EC] text-xl font-bold text-[#16A34A]" aria-hidden>
              ✓
            </span>
            <h2 className="text-base font-bold text-[#0B1F4D]">{done.added ? `Added to your ${categoryLabel(category)} query` : "Your query is sent"}</h2>
            <p className="mt-2 text-[13px] text-[#334155]">
              The SPI team will reply in <b className="text-[#0B1F4D]">My queries</b>.
            </p>
            <button type="button" onClick={onOpenChat} className="mt-5 min-h-11 w-full rounded-[10px] bg-[#2563EB] text-[13px] font-bold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563EB]">
              Open my chat
            </button>
            <button type="button" onClick={onClose} className="mt-2 min-h-11 w-full rounded-[10px] border border-[#BFD0F7] bg-white text-[13px] font-semibold text-[#2563EB] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#2563EB]">
              Back to report
            </button>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
            className="grid gap-4 px-5 pb-5 pt-[18px]"
          >
            <div className="flex items-center">
              <h2 className="text-base font-bold text-[#0B1F4D]">Raise a query</h2>
              <button type="button" onClick={onClose} className="ml-auto grid h-8 w-8 shrink-0 place-items-center rounded-full border border-[#E6ECF5] bg-white text-[#0B1F4D]" aria-label="Close">
                ✕
              </button>
            </div>

            <div className="grid gap-1.5">
              <span id="rq-category-label" className="text-xs font-semibold text-[#0B1F4D]">
                Category <span className="text-[#E11D48]">*</span>
              </span>
              <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-labelledby="rq-category-label">
                {QUERY_CATEGORIES.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    role="radio"
                    aria-checked={category === c.value}
                    onClick={() => {
                      setCategory(c.value);
                      setProblem("");
                      setPicked([]);
                    }}
                    className={`flex min-h-11 items-center justify-center gap-2 rounded-[10px] border px-2 text-[13px] font-semibold ${category === c.value ? "border-[#2563EB] bg-[#EAF1FF] text-[#2563EB]" : "border-[#D5DEEC] text-[#0B1F4D]"}`}
                  >
                    <span className="h-2 w-2 rounded-full" style={{ background: CATEGORY_DOT[c.value] }} aria-hidden />
                    {c.label}
                  </button>
                ))}
              </div>
            </div>

            {openChat && (
              <p className="flex gap-2 rounded-[10px] border border-[#BBD0FF] bg-[#EAF1FF] px-3 py-2.5 text-[12.5px] leading-snug text-[#1D4ED8]">
                <span aria-hidden>ⓘ</span>
                You already have an open {categoryLabel(category)} query. The subjects you tick are added to it.
              </p>
            )}

            {category && (
              <div className="grid gap-1.5">
                <span id="rq-subject-label" className="text-xs font-semibold text-[#0B1F4D]">
                  Subjects <span className="font-normal text-[#6B7280]">(tick all that apply)</span> <span className="text-[#E11D48]">*</span>
                </span>
                <div className="overflow-hidden rounded-[10px] border border-[#D5DEEC]" role="group" aria-labelledby="rq-subject-label">
                  <div className="flex items-center gap-2 border-b border-[#E6ECF5] bg-[#FAFCFF] px-3 py-1.5">
                    <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search subject" aria-label="Search subject" className="min-h-8 flex-1 bg-transparent text-[13px] focus:outline-none" />
                    {selectable.length > 1 && (
                      <button type="button" onClick={() => setPicked((p) => (allPicked ? p.filter((x) => !selectable.includes(x)) : [...new Set([...p, ...selectable])]))} className="text-[12px] font-bold text-[#2563EB]">
                        {allPicked ? "Clear" : "Select all"}
                      </button>
                    )}
                  </div>
                  <ul className="max-h-52 overflow-y-auto">
                    {shown.map((s) => {
                      const locked = already.has(s);
                      return (
                        <li key={s} className="border-t border-[#E6ECF5] first:border-t-0">
                          <label className={`flex min-h-10 items-center gap-2.5 px-3 text-[13px] text-[#0B1F4D] ${locked ? "cursor-not-allowed opacity-70" : "cursor-pointer hover:bg-[#F6F9FF]"}`}>
                            <input type="checkbox" checked={locked || picked.includes(s)} disabled={locked} onChange={() => toggle(s)} className="h-4 w-4 accent-[#2563EB]" />
                            <span className="min-w-0 flex-1">{s}</span>
                            {locked && <small className="shrink-0 text-[10.5px] text-[#6B7280]">already in your query</small>}
                          </label>
                        </li>
                      );
                    })}
                    {shown.length === 0 && <li className="px-3 py-2.5 text-[12px] text-[#6B7280]">No subject matches</li>}
                  </ul>
                </div>
              </div>
            )}

            <div className="grid gap-1.5">
              <label htmlFor="rq-problem" className="text-xs font-semibold text-[#0B1F4D]">
                What is the problem? <span className="text-[#E11D48]">*</span>
              </label>
              <select
                id="rq-problem"
                value={problem}
                disabled={!category}
                onChange={(e) => {
                  setProblem(e.target.value);
                  if (e.target.value === "something_else") document.getElementById("rq-details")?.focus();
                }}
                className={`${FIELD} min-h-11 font-medium disabled:cursor-not-allowed disabled:bg-[#F8FAFC] disabled:text-[#94A3B8]`}
              >
                <option value="" disabled>
                  {category ? "Choose the problem" : "Choose a category first"}
                </option>
                {problems.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-1.5">
              <label htmlFor="rq-details" className="text-xs font-semibold text-[#0B1F4D]">
                {problem === "something_else" ? "Write your problem" : "Issue details"} <span className="text-[#E11D48]">*</span>
              </label>
              <textarea
                id="rq-details"
                value={details}
                maxLength={MAX_CHARS}
                onChange={(e) => setDetails(e.target.value)}
                onPaste={shots.onPaste}
                placeholder={problem === "something_else" ? "Tell us your problem in your own words" : "Add details like the date, class or quiz name"}
                rows={5}
                className={`${FIELD} min-h-28 resize-y py-2.5 leading-relaxed`}
              />
              <p className="text-right text-[11px] tabular-nums text-[#6B7280]">
                {details.length} / {MAX_CHARS}
              </p>
            </div>

            <div className="grid gap-1.5">
              <span className="text-xs font-semibold text-[#0B1F4D]">
                Screenshots <span className="font-normal text-[#6B7280]">(optional, up to {MAX_SHOTS})</span>
              </span>
              <ShotPicker state={shots} />
            </div>

            {error && (
              <p role="alert" className="rounded-[10px] bg-[#FDECEF] px-3 py-2 text-[12px] text-[#9F1239]">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2.5">
              <button type="button" onClick={onClose} className="min-h-10 rounded-[10px] px-4 text-[13px] font-semibold text-[#6B7280]">
                Cancel
              </button>
              <button type="submit" disabled={!ready || sending} className="min-h-10 rounded-[10px] bg-[#2563EB] px-5 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
                {sending ? "Submitting…" : openChat ? `Add to my ${categoryLabel(category)} query` : "Submit"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
