import { useCallback, useEffect, useRef, useState, type ClipboardEvent } from "react";
import { MAX_SHOTS, SHOT_RULES, formatSize, shrinkImage, uploadShot } from "@/lib/queryChat";

/**
 * Screenshots on a query: the student picks or pastes up to MAX_SHOTS images, each is shrunk in the browser and
 * uploaded at once; the tokens go with the message. Shared by the "Raise a query" form and the chat box.
 * ShotGallery shows the images of a message (student chat and admin page) with a full-size viewer.
 */

export interface Shot {
  id: number;
  preview: string;
  status: "uploading" | "done" | "error";
  token?: string;
  error?: string;
}

const TYPES = ["image/png", "image/jpeg", "image/webp"];
const ACCEPT = TYPES.join(",");
let nextId = 1;

export function useShots(studentId: string) {
  const [shots, setShots] = useState<Shot[]>([]);
  /** Why some chosen files were not added (wrong type, or over the limit). */
  const [notice, setNotice] = useState<string | null>(null);
  const previews = useRef<string[]>([]);

  useEffect(
    () => () => {
      for (const p of previews.current) URL.revokeObjectURL(p);
    },
    [],
  );

  const add = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      const wrong = files.filter((f) => !TYPES.includes(f.type));
      const right = files.filter((f) => TYPES.includes(f.type));
      let room = MAX_SHOTS - shots.filter((s) => s.status !== "error").length;
      const messages: string[] = [];
      if (wrong.length > 0) {
        const names = wrong.slice(0, 2).map((f) => f.name || "file").join(", ");
        messages.push(`Only PNG, JPG or WebP images can be added. Skipped: ${names}${wrong.length > 2 ? ` and ${wrong.length - 2} more` : ""}.`);
      }
      if (right.length > Math.max(room, 0)) messages.push(`You can add up to ${MAX_SHOTS} screenshots. The extra ${right.length - Math.max(room, 0)} were skipped.`);
      setNotice(messages.length > 0 ? messages.join(" ") : null);

      for (const file of right) {
        if (room-- <= 0) break;
        const id = nextId++;
        const preview = URL.createObjectURL(file);
        previews.current.push(preview);
        setShots((cur) => [...cur, { id, preview, status: "uploading" }]);
        try {
          const blob = await shrinkImage(file);
          const res = await uploadShot(studentId, blob, file.name || "screenshot.png");
          setShots((cur) => cur.map((s) => (s.id === id ? (res.ok ? { ...s, status: "done", token: res.token } : { ...s, status: "error", error: res.error }) : s)));
        } catch (err) {
          setShots((cur) => cur.map((s) => (s.id === id ? { ...s, status: "error", error: err instanceof Error ? err.message : "Could not add the screenshot." } : s)));
        }
      }
    },
    [studentId, shots],
  );

  const remove = useCallback((id: number) => {
    setNotice(null);
    setShots((cur) => cur.filter((s) => s.id !== id));
  }, []);
  const reset = useCallback(() => {
    setNotice(null);
    setShots([]);
  }, []);
  const onPaste = useCallback(
    (e: ClipboardEvent) => {
      const files = [...e.clipboardData.items].filter((i) => i.kind === "file").map((i) => i.getAsFile()).filter((f): f is File => Boolean(f));
      if (files.length > 0) {
        e.preventDefault();
        void add(files);
      }
    },
    [add],
  );

  return {
    shots,
    notice,
    add,
    remove,
    reset,
    onPaste,
    tokens: shots.filter((s) => s.status === "done" && s.token).map((s) => s.token!),
    busy: shots.some((s) => s.status === "uploading"),
    full: shots.filter((s) => s.status !== "error").length >= MAX_SHOTS,
    count: shots.filter((s) => s.status !== "error").length,
  };
}

export type ShotsState = ReturnType<typeof useShots>;

/** The "Add screenshot" button, what is accepted, and the thumbnails of what is added. `compact` is for the chat box. */
export function ShotPicker({ state, compact = false }: { state: ShotsState; compact?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const errors = [...new Set(state.shots.filter((s) => s.status === "error").map((s) => s.error))];
  const message = [state.notice, ...errors].filter(Boolean) as string[];
  return (
    <div>
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          void state.add([...(e.target.files ?? [])]);
          e.target.value = "";
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        {compact ? (
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={state.full}
            aria-label={`Add a screenshot. ${SHOT_RULES}`}
            title={SHOT_RULES}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-[8px] border border-[#CBD5E1] text-[#6B7280] hover:bg-[#F6F9FF] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563EB] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="m21 12-9 9a5 5 0 0 1-7-7l9-9a3 3 0 0 1 4 4l-9 9a1 1 0 0 1-2-2l8-8" />
            </svg>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={state.full}
            className="inline-flex min-h-11 items-center gap-2 rounded-[10px] border-[1.5px] border-dashed border-[#9DB6F2] bg-[#F6F9FF] px-3 text-[13px] font-semibold text-[#2563EB] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563EB] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="m21 15-5-5L5 21" />
            </svg>
            Add screenshot
          </button>
        )}
        {state.shots.map((s) => (
          <div key={s.id} className="relative">
            <img src={s.preview} alt="" className={`h-11 w-14 rounded-[8px] border border-[#E6ECF5] object-cover ${s.status === "uploading" ? "opacity-50" : ""} ${s.status === "error" ? "opacity-40 ring-2 ring-[#E11D48]" : ""}`} />
            {s.status === "uploading" && <span className="absolute inset-0 grid place-items-center text-[10px] font-bold text-[#0B1F4D]">…</span>}
            <button type="button" onClick={() => state.remove(s.id)} aria-label="Remove screenshot" className="absolute -right-1.5 -top-1.5 grid h-[18px] w-[18px] place-items-center rounded-full bg-[#0B1F4D] text-[9px] text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#2563EB]">
              ✕
            </button>
          </div>
        ))}
      </div>
      {!compact && (
        <p className="mt-1.5 text-[12px] text-[#6B7280]">
          {SHOT_RULES}
          {state.count > 0 && <span className="ml-1.5 font-semibold text-[#334155]">· {state.count} of {MAX_SHOTS} added</span>}
        </p>
      )}
      {compact && state.shots.length > 0 && (
        <p className="mt-1 text-[12px] text-[#6B7280]">
          {state.count} of {MAX_SHOTS} · PNG, JPG or WebP
        </p>
      )}
      {message.map((m) => (
        <p key={m} role="alert" className="mt-1.5 text-[12px] text-[#9F1239]">
          {m}
        </p>
      ))}
    </div>
  );
}

export interface GalleryItem {
  url: string;
  name?: string | null;
  size?: number | null;
}

/**
 * The screenshots on one message. `large` (the admin page) shows a grid of bigger tiles with the file name and size;
 * the default is a small row for the student's chat. Either opens the viewer at the chosen image.
 */
export function ShotGallery({ items, large = false, onBlue = false }: { items: GalleryItem[]; large?: boolean; onBlue?: boolean }) {
  const [open, setOpen] = useState<number | null>(null);
  if (items.length === 0) return null;
  return (
    <>
      {large ? (
        <div className="mt-2.5">
          <p className="mb-1.5 text-[11.5px] font-semibold text-slate-500">
            {items.length} {items.length === 1 ? "screenshot" : "screenshots"}
          </p>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {items.map((it, i) => (
              <li key={it.url}>
                <button
                  type="button"
                  onClick={() => setOpen(i)}
                  aria-label={`View screenshot ${i + 1} of ${items.length}${it.name ? `: ${it.name}` : ""}`}
                  className="group block w-full overflow-hidden rounded-lg border border-slate-200 bg-white text-left shadow-sm transition-shadow hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563EB]"
                >
                  <span className="block aspect-[4/3] w-full overflow-hidden bg-slate-100">
                    <img src={it.url} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100" />
                  </span>
                  <span className="flex items-center justify-between gap-2 px-2 py-1.5">
                    <span className="min-w-0 truncate text-[11.5px] font-medium text-slate-700">{it.name || `Screenshot ${i + 1}`}</span>
                    {it.size ? <span className="shrink-0 text-[11px] tabular-nums text-slate-400">{formatSize(it.size)}</span> : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {items.map((it, i) => (
            <button
              key={it.url}
              type="button"
              onClick={() => setOpen(i)}
              aria-label={`View screenshot ${i + 1} of ${items.length}`}
              className={`overflow-hidden rounded-[8px] border focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-white ${onBlue ? "border-white/40 bg-white/20" : "border-slate-200 bg-white"}`}
            >
              <img src={it.url} alt="" loading="lazy" className="h-14 w-[72px] object-cover" />
            </button>
          ))}
        </div>
      )}
      {open !== null && <Viewer items={items} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />}
    </>
  );
}

/** Full-size viewer: previous / next, a counter, the file name, and the image in a new tab. Escape closes it. */
function Viewer({ items, index, onIndex, onClose }: { items: GalleryItem[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const item = items[index]!;
  const many = items.length > 1;
  const go = useCallback((delta: number) => onIndex((index + delta + items.length) % items.length), [index, items.length, onIndex]);

  useEffect(() => {
    const returnTo = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => returnTo?.focus?.();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && many) go(-1);
      else if (e.key === "ArrowRight" && many) go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, many, onClose]);

  const btn = "grid h-11 w-11 place-items-center rounded-full bg-white/95 text-[#0B1F4D] shadow focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white hover:bg-white";
  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black/80" role="dialog" aria-modal="true" aria-label="Screenshot viewer" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="flex items-center gap-3 px-4 py-3 text-white">
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">
          {item.name || `Screenshot ${index + 1}`}
          {item.size ? <span className="ml-2 font-normal text-white/70">{formatSize(item.size)}</span> : null}
        </span>
        {many && (
          <span className="shrink-0 text-[12px] tabular-nums text-white/80" aria-live="polite">
            {index + 1} / {items.length}
          </span>
        )}
        <a href={item.url} target="_blank" rel="noreferrer" className="shrink-0 rounded-lg bg-white/15 px-3 py-2 text-[12px] font-semibold text-white hover:bg-white/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">
          Open in new tab
        </a>
        <button ref={closeRef} type="button" onClick={onClose} aria-label="Close viewer" className={btn}>
          ✕
        </button>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-4 pb-6" onClick={(e) => e.target === e.currentTarget && onClose()}>
        {many && (
          <button type="button" onClick={() => go(-1)} aria-label="Previous screenshot" className={`${btn} absolute left-3 z-10 sm:left-5`}>
            ‹
          </button>
        )}
        <img src={item.url} alt={item.name || `Screenshot ${index + 1}`} className="max-h-full max-w-full rounded-lg bg-white object-contain" />
        {many && (
          <button type="button" onClick={() => go(1)} aria-label="Next screenshot" className={`${btn} absolute right-3 z-10 sm:right-5`}>
            ›
          </button>
        )}
      </div>
    </div>
  );
}
