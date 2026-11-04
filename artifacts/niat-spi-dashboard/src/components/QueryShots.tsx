import { useCallback, useEffect, useRef, useState, type ClipboardEvent } from "react";
import { MAX_SHOTS, shrinkImage, uploadShot } from "@/lib/queryChat";

/**
 * Screenshots on a query: the student picks, pastes or drops up to 3 images, each is shrunk in the browser and
 * uploaded at once; the tokens go with the message. Shared by the "Raise a query" form and the chat box.
 */

export interface Shot {
  id: number;
  preview: string;
  status: "uploading" | "done" | "error";
  token?: string;
  error?: string;
}

const ACCEPT = "image/png,image/jpeg,image/webp";
let nextId = 1;

export function useShots(studentId: string) {
  const [shots, setShots] = useState<Shot[]>([]);
  const previews = useRef<string[]>([]);

  useEffect(
    () => () => {
      for (const p of previews.current) URL.revokeObjectURL(p);
    },
    [],
  );

  const add = useCallback(
    async (files: File[]) => {
      const images = files.filter((f) => ACCEPT.split(",").includes(f.type));
      if (images.length === 0) return;
      let room = MAX_SHOTS - shots.filter((s) => s.status !== "error").length;
      for (const file of images) {
        if (room-- <= 0) break;
        const id = nextId++;
        const preview = URL.createObjectURL(file);
        previews.current.push(preview);
        setShots((cur) => [...cur, { id, preview, status: "uploading" }]);
        try {
          const blob = await shrinkImage(file);
          const res = await uploadShot(studentId, blob);
          setShots((cur) => cur.map((s) => (s.id === id ? (res.ok ? { ...s, status: "done", token: res.token } : { ...s, status: "error", error: res.error }) : s)));
        } catch (err) {
          setShots((cur) => cur.map((s) => (s.id === id ? { ...s, status: "error", error: err instanceof Error ? err.message : "Could not add the screenshot." } : s)));
        }
      }
    },
    [studentId, shots],
  );

  const remove = useCallback((id: number) => setShots((cur) => cur.filter((s) => s.id !== id)), []);
  const reset = useCallback(() => setShots([]), []);
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
    add,
    remove,
    reset,
    onPaste,
    tokens: shots.filter((s) => s.status === "done" && s.token).map((s) => s.token!),
    busy: shots.some((s) => s.status === "uploading"),
    full: shots.filter((s) => s.status !== "error").length >= MAX_SHOTS,
  };
}

export type ShotsState = ReturnType<typeof useShots>;

/** The "Add screenshot" button and the thumbnails of what is added. `compact` is for the chat box. */
export function ShotPicker({ state, compact = false }: { state: ShotsState; compact?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const errors = [...new Set(state.shots.filter((s) => s.status === "error").map((s) => s.error))];
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
            aria-label="Add a screenshot"
            title="Add a screenshot"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-[8px] border border-[#CBD5E1] text-[#6B7280] hover:bg-[#F6F9FF] disabled:cursor-not-allowed disabled:opacity-40"
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
            className="inline-flex min-h-11 items-center gap-2 rounded-[10px] border-[1.5px] border-dashed border-[#9DB6F2] bg-[#F6F9FF] px-3 text-[13px] font-semibold text-[#2563EB] disabled:cursor-not-allowed disabled:opacity-50"
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
            <button type="button" onClick={() => state.remove(s.id)} aria-label="Remove screenshot" className="absolute -right-1.5 -top-1.5 grid h-[18px] w-[18px] place-items-center rounded-full bg-[#0B1F4D] text-[9px] text-white">
              ✕
            </button>
          </div>
        ))}
      </div>
      {errors.map((e) => (
        <p key={e} role="alert" className="mt-1.5 text-[11.5px] text-[#9F1239]">
          {e}
        </p>
      ))}
    </div>
  );
}

/** The screenshots on a message; click one to see it full size. */
export function MessageImages({ urls }: { urls: string[] }) {
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  if (urls.length === 0) return null;
  return (
    <>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {urls.map((u) => (
          <button key={u} type="button" onClick={() => setOpen(u)} className="overflow-hidden rounded-[8px] border border-white/40 bg-white/20" aria-label="View screenshot full size">
            <img src={u} alt="Screenshot" loading="lazy" className="h-14 w-[72px] object-cover" />
          </button>
        ))}
      </div>
      {open && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-black/70 p-4" onClick={() => setOpen(null)} role="dialog" aria-modal="true" aria-label="Screenshot">
          <img src={open} alt="Screenshot" className="max-h-full max-w-full rounded-lg bg-white object-contain" />
          <button type="button" onClick={() => setOpen(null)} aria-label="Close" className="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-full bg-white text-[#0B1F4D]">
            ✕
          </button>
        </div>
      )}
    </>
  );
}
