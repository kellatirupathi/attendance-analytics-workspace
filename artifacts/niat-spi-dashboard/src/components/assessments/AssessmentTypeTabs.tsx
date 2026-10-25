import { useRef, type KeyboardEvent } from "react";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { ASSESSMENT_TYPES, type AssessmentTypeId } from "@/lib/assessmentMetrics";

/**
 * Assessment type tabs, styled like SubNav. Each tab shows its SPI weight;
 * locked types are visible but cannot be picked.
 */
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
    <div
      role="tablist"
      aria-label="Assessment type"
      className="flex items-center gap-1 overflow-x-auto rounded-[14px] border border-[#E6ECF5] bg-white px-2 shadow-[0_1px_2px_rgba(11,31,77,0.04)]"
    >
      {ASSESSMENT_TYPES.map((t, i) => {
        const active = t.id === value;
        return (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            aria-selected={active}
            aria-disabled={t.locked || undefined}
            tabIndex={active ? 0 : -1}
            onKeyDown={onKeyDown}
            onClick={() => !t.locked && onChange(t.id)}
            title={t.locked ? "Coming soon" : undefined}
            className={cn(
              "inline-flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-4 py-3 text-sm font-semibold transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-600",
              active ? "border-[#2563EB] text-[#2563EB]" : "border-transparent text-[#6B7280] hover:text-[#0B1F4D]",
              t.locked && "cursor-not-allowed text-[#6B7280] hover:text-[#6B7280]",
            )}
          >
            {t.locked && <Lock className="h-3.5 w-3.5" aria-hidden="true" />}
            {t.label}
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums",
                active ? "bg-[#EAF1FF] text-[#2563EB]" : "bg-[#F1F4F9] text-[#6B7280]",
              )}
            >
              {t.spiWeight}%
            </span>
            {t.locked && <span className="text-xs font-normal text-[#6B7280]">· Coming soon</span>}
          </button>
        );
      })}
    </div>
  );
}
