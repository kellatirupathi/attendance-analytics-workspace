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
    <div role="tablist" aria-label="Assessment type" className="flex items-center gap-1 overflow-x-auto border-b border-gray-200">
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
              "-mb-px inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-600",
              active ? "border-brand-600 text-brand-700" : "border-transparent text-gray-600 hover:border-gray-300 hover:text-gray-900",
              t.locked && "cursor-not-allowed text-gray-500 hover:border-transparent hover:text-gray-500",
            )}
          >
            {t.locked && <Lock className="h-3.5 w-3.5" aria-hidden="true" />}
            {t.label}
            <span className="text-xs font-normal tabular-nums text-gray-500">{t.spiWeight}%</span>
            {t.locked && <span className="text-xs font-normal text-gray-500">· Coming soon</span>}
          </button>
        );
      })}
    </div>
  );
}
