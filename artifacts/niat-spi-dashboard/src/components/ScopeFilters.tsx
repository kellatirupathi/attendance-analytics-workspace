/* ------------------------------------------------------------------ */
/*  The filter bar shared by Student Attendance Stats, Assessments    */
/*  and SPI Quiz Analytics: College › Batch › Semester always in view, */
/*  the rest behind "More filters" (a side panel, applied together),  */
/*  the filters in use as removable chips, and one Export menu.        */
/* ------------------------------------------------------------------ */
import { useState, type ReactNode } from "react";
import { Check, ChevronDown, Download, Loader2, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { CheckMenu } from "@/components/SpiRecordFilterBar";
import { cn } from "@/lib/utils";

/** A batch in the Batch menu: the semester it is in, whether that semester ended, and its students. */
export interface ScopeBatch {
  campus: string;
  batch: string;
  semester: string;
  ended: boolean;
  students: number;
}

/** "": this semester (every batch); running / ended: only batches whose semester is in progress / over. */
export type Term = "" | "running" | "ended";

export interface FilterChip {
  key: string;
  label: string;
  clear: () => void;
}

export const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-600 focus-visible:ring-offset-2";
/** Every filter field looks like a dropdown: full width, value on the left, arrow on the right (40px high). */
export const fieldTrigger = "h-10 w-full min-w-0 justify-between gap-2 rounded-lg border-slate-300 px-3 font-normal text-slate-900";
export const fieldBox = "flex h-10 w-full min-w-0 items-center rounded-lg border border-slate-300 px-3 text-sm text-slate-900";

export const TERM_LABEL: Record<Term, string> = { "": "This semester", running: "Running", ended: "Ended" };

/** "Semester 3" → "Sem 3"; other titles (e.g. "Year 2 - Term 2") as they are. */
export function shortSemester(title: string): string {
  return title.replace(/^Semester\s+/i, "Sem ");
}

export function FilterField({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn("flex min-w-0 flex-col gap-1.5 text-xs font-medium text-slate-600", className)}>
      {label}
      {children}
    </label>
  );
}

/** Marks a semester that has ended (the batch is between semesters); `label` e.g. "12 ended" for a mixed group. */
export function EndedTag({ label = "Ended", title }: { label?: string; title?: string }) {
  return (
    <span title={title} className="inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded-full bg-amber-50 px-2 text-[11px] font-semibold text-amber-800 ring-1 ring-inset ring-amber-200">
      {label}
    </span>
  );
}

/** One choice in a single-choice menu (Semester, Dates): a tick on the chosen one, an optional hint on the right. */
export function MenuOption({ on, label, hint, onSelect }: { on: boolean; label: string; hint?: string; onSelect: () => void }) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={on}
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-600",
        on ? "bg-violet-50 font-semibold text-violet-900" : "text-slate-700 hover:bg-slate-50",
      )}
    >
      <Check className={cn("h-4 w-4 shrink-0", on ? "text-violet-600" : "invisible")} aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint && <span className="shrink-0 text-xs font-normal text-slate-500 tabular-nums">{hint}</span>}
    </button>
  );
}

/** A small segmented control (e.g. Dates: Semester | One day | Date range). */
export function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly (readonly [T, string])[]; onChange: (next: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="grid gap-1 rounded-lg bg-slate-100 p-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map(([id, text]) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={value === id}
          onClick={() => onChange(id)}
          className={cn("h-9 rounded-md text-sm font-medium transition-colors motion-reduce:transition-none", focusRing, value === id ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900")}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

/**
 * College › Batch › Semester (always in view), "More filters" with a count, Clear all, and the filters in use as chips.
 * `semesterNote`: replaces the Semester choices with a note and an action (e.g. a date filter is on).
 */
export function ScopeFilterBar({
  campusOptions,
  campuses,
  onCampuses,
  lockedCampus,
  batchOptions,
  batches,
  onBatches,
  term,
  onTerm,
  semesterNote,
  moreCount,
  onMore,
  chips,
  anyFilter,
  onClearAll,
  extra,
  updating = false,
}: {
  campusOptions: string[];
  campuses: string[];
  onCampuses: (next: string[]) => void;
  /** A single-campus user: the college shows as fixed text. */
  lockedCampus?: string;
  batchOptions: ScopeBatch[];
  /** "college\tbatch" keys. */
  batches: string[];
  onBatches: (next: string[]) => void;
  term: Term;
  onTerm: (next: Term) => void;
  semesterNote?: { label: string; text: string; action: string; onAction: () => void };
  /** Filters set behind More filters; no button when onMore is missing. */
  moreCount: number;
  onMore?: () => void;
  chips: FilterChip[];
  anyFilter: boolean;
  onClearAll: () => void;
  /** One more field after Semester, always in view (e.g. SPI Quiz: Student search). */
  extra?: ReactNode;
  /** New numbers are loading for the filters just set: shown next to the buttons (no layout shift). */
  updating?: boolean;
}) {
  const multiCampus = campuses.length !== 1;
  const shownBatches = campuses.length ? batchOptions.filter((b) => campuses.includes(b.campus)) : batchOptions;
  const endedBatches = shownBatches.filter((b) => b.ended).length;
  return (
    <section aria-label="Filters" aria-busy={updating} className="relative mb-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
        <div className={cn("grid w-full min-w-0 grid-cols-1 gap-3 lg:flex-1", extra ? "sm:grid-cols-2 xl:grid-cols-4" : "sm:grid-cols-3")}>
          <FilterField label="College">
            {lockedCampus ? (
              <div className={cn(fieldBox, "cursor-default bg-slate-50")}>
                <span className="min-w-0 truncate">{lockedCampus}</span>
              </div>
            ) : (
              <CheckMenu
                chevron
                className={fieldTrigger}
                label={campuses.length === 1 ? campuses[0]! : campuses.length ? `${campuses.length} colleges` : "All colleges"}
                options={campusOptions.map((name) => ({ id: name, label: name }))}
                selected={campuses}
                onChange={onCampuses}
              />
            )}
          </FilterField>
          <FilterField label="Batch">
            <CheckMenu
              chevron
              className={fieldTrigger}
              label={batches.length === 1 ? batches[0]!.split("\t")[1]! : batches.length ? `${batches.length} batches` : "All batches"}
              options={shownBatches.map((item) => ({
                id: `${item.campus}\t${item.batch}`,
                label: multiCampus ? `${item.campus} — ${item.batch}` : item.batch,
                badge: item.ended ? "Ended" : undefined,
                hint: `${shortSemester(item.semester)} · ${item.students.toLocaleString("en-IN")}`,
              }))}
              selected={batches}
              onChange={onBatches}
            />
          </FilterField>
          <FilterField label="Semester">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className={fieldTrigger}>
                  <span className="min-w-0 truncate">{semesterNote ? semesterNote.label : TERM_LABEL[term]}</span>
                  <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-72 p-1.5">
                {semesterNote ? (
                  <div className="space-y-2 p-2 text-sm text-slate-600">
                    <p>{semesterNote.text}</p>
                    <Button type="button" size="sm" variant="outline" onClick={semesterNote.onAction}>{semesterNote.action}</Button>
                  </div>
                ) : (
                  <>
                    <MenuOption on={term === ""} label="This semester" hint="all batches" onSelect={() => onTerm("")} />
                    <MenuOption on={term === "running"} label="Running" hint="semester in progress" onSelect={() => onTerm("running")} />
                    <MenuOption on={term === "ended"} label="Ended" hint={endedBatches ? `${endedBatches} ${endedBatches === 1 ? "batch" : "batches"}` : undefined} onSelect={() => onTerm("ended")} />
                  </>
                )}
              </PopoverContent>
            </Popover>
          </FilterField>
          {extra}
        </div>
        <div className="flex items-center gap-2">
          {onMore && (
            <Button type="button" variant="outline" className="h-10 flex-1 gap-2 border-slate-300 lg:flex-none" onClick={onMore} aria-haspopup="dialog">
              <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
              More filters
              {moreCount > 0 && (
                <span className="rounded-full bg-violet-600 px-1.5 text-[11px] font-semibold leading-5 text-white tabular-nums" aria-label={`${moreCount} on`}>{moreCount}</span>
              )}
            </Button>
          )}
          {anyFilter && (
            <Button type="button" variant="ghost" className="h-10 px-3 text-slate-600" onClick={onClearAll}>Clear all</Button>
          )}
        </div>
      </div>
      {/* Top right, over the empty space beside the labels, so the page does not move when it shows. */}
      <p role="status" aria-live="polite" className="pointer-events-none absolute right-3 top-2.5 flex items-center gap-1.5 text-xs font-medium text-violet-700">
        {updating && (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            Updating for your filters…
          </>
        )}
      </p>
      {chips.length > 0 && (
        <ul aria-label="Filters in use" className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-3">
          {chips.map((chip) => (
            <li key={chip.key} className="inline-flex h-8 max-w-full items-center gap-1 rounded-full bg-violet-50 pl-3 pr-1 text-xs font-medium text-violet-800">
              <span className="min-w-0 truncate" title={chip.label}>{chip.label}</span>
              <button type="button" aria-label={`Remove ${chip.label}`} className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-full hover:bg-violet-100", focusRing)} onClick={chip.clear}>
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The More filters side panel: choices are a draft until Apply; Cancel, X or Esc drop them. */
export function MoreFiltersSheet({
  open,
  onOpenChange,
  description,
  onReset,
  onApply,
  applyDisabled,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  description: string;
  onReset: () => void;
  onApply: () => void;
  applyDisabled?: boolean;
  children: ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b border-slate-200 px-5 py-4 text-left">
          <SheetTitle>More filters</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>
        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">{children}</div>
        <SheetFooter className="flex-row justify-between gap-2 border-t border-slate-200 px-5 py-4 sm:justify-between">
          <Button type="button" variant="ghost" onClick={onReset}>Reset</Button>
          <div className="flex gap-2">
            <SheetClose asChild>
              <Button type="button" variant="outline">Cancel</Button>
            </SheetClose>
            <Button type="button" disabled={applyDisabled} onClick={onApply}>Apply</Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

export interface ExportChoice {
  title: string;
  detail: string;
  disabled?: boolean;
  /** Builds and saves the file; a thrown error shows "Export failed". */
  run: () => Promise<void>;
}

/** One Export button with a menu of what to download; "Preparing CSV…" while it builds. */
export function ExportMenu({ choices, disabled }: { choices: ExportChoice[]; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const start = async (choice: ExportChoice) => {
    setOpen(false);
    setBusy(true);
    setError("");
    try {
      await choice.run();
    } catch {
      setError("Export failed. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col items-end gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" className="h-10 gap-2" disabled={busy || disabled}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />}
            {busy ? "Preparing CSV…" : "Export"}
            {!busy && <ChevronDown className="h-4 w-4" aria-hidden="true" />}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 p-1.5">
          {choices.map((choice) => (
            <button
              key={choice.title}
              type="button"
              disabled={choice.disabled}
              onClick={() => void start(choice)}
              className="flex w-full flex-col items-start gap-0.5 rounded-md px-3 py-2 text-left hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="text-sm font-semibold text-slate-900">{choice.title}</span>
              <span className="text-xs text-slate-500">{choice.detail}</span>
            </button>
          ))}
        </PopoverContent>
      </Popover>
      {error && <p role="alert" className="text-xs font-medium text-red-700">{error}</p>}
    </div>
  );
}

/** "Updating for your filters…": shown while new numbers load and the old ones stay on screen, dimmed. */
export function UpdatingStatus({ updating, children }: { updating: boolean; children: ReactNode }) {
  return (
    <span role="status" aria-live="polite">
      {updating ? (
        <span className="inline-flex items-center gap-1.5 font-medium text-violet-700">
          <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          Updating for your filters…
        </span>
      ) : (
        children
      )}
    </span>
  );
}

/** A thin bar on top of a card while it updates. */
export function UpdatingBar({ updating }: { updating: boolean }) {
  return updating ? <div className="absolute inset-x-0 top-0 z-10 h-1 animate-pulse bg-violet-600 motion-reduce:animate-none" aria-hidden="true" /> : null;
}
