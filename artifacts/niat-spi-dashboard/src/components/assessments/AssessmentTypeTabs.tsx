import { useRef, type KeyboardEvent } from "react";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { ASSESSMENT_TYPES, type AssessmentTypeId } from "@/lib/assessmentMetrics";
import { FOCUS_RING } from "./parts";

/** Segmented control for the assessment type. Locked types are shown but cannot be picked. */
export function AssessmentTypeTabs({
  value,
  onChange,
}: {
  value: AssessmentTypeId;
  onChange: (next: AssessmentTypeId) => void;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const enabled = ASSESSMENT_TYPES.filter((t) => !t.locked);

  // Arrow keys move between the unlocked tabs (WAI-ARIA tabs pattern).
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const i = enabled.findIndex((t) => t.id === value);
    const next = enabled[(i + (event.key === "ArrowRight" ? 1 : enabled.length - 1)) % enabled.length]!;
    onChange(next.id);
    refs.current[ASSESSMENT_TYPES.indexOf(next)]?.focus();
  };

  return (
    <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <div role="tablist" aria-label="Assessment type" className="inline-flex min-w-max gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1">
        {ASSESSMENT_TYPES.map((t, i) => {
          const selected = t.id === value;
          return (
            <button
              key={t.id}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-disabled={t.locked || undefined}
              tabIndex={selected ? 0 : -1}
              onKeyDown={onKeyDown}
              onClick={() => !t.locked && onChange(t.id)}
              title={t.locked ? "Coming soon" : undefined}
              className={cn(
                "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors",
                FOCUS_RING,
                selected ? "bg-white font-semibold text-slate-900 shadow-sm ring-1 ring-slate-200" : "text-slate-700 hover:bg-white/70",
                t.locked && "cursor-not-allowed text-slate-500 hover:bg-transparent",
              )}
            >
              {t.locked && <Lock className="h-3.5 w-3.5" aria-hidden="true" />}
              {t.label}
              <span
                className={cn(
                  "rounded px-1.5 py-0.5 text-xs font-medium tabular-nums",
                  selected ? "bg-brand-50 text-brand-800" : "bg-slate-200/70 text-slate-700",
                )}
              >
                {t.spiWeight}%
              </span>
              {t.locked && <span className="text-xs text-slate-500">Coming soon</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
