import { useRef, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import type { AssessmentTypeId } from "@/lib/assessmentMetrics";

/** Plain tab labels: no SPI weights. Final Skill Assessment is marked "Soon". */
const TABS: { id: AssessmentTypeId; label: string; soon?: boolean }[] = [
  { id: "cq", label: "Classroom Quiz" },
  { id: "mq", label: "Module Quiz" },
  { id: "skill", label: "Skill Assessment" },
  { id: "final", label: "Final Skill Assessment", soon: true },
];

/** Assessment type tabs, styled like SubNav. */
export function AssessmentTypeTabs({
  value,
  onChange,
}: {
  value: AssessmentTypeId;
  onChange: (next: AssessmentTypeId) => void;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  // Arrow keys move between the tabs (WAI-ARIA tabs pattern).
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const i = TABS.findIndex((t) => t.id === value);
    const nextIndex = (i + (event.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length;
    onChange(TABS[nextIndex]!.id);
    refs.current[nextIndex]?.focus();
  };

  return (
    <div role="tablist" aria-label="Assessment type" className="flex items-center gap-1 overflow-x-auto border-b border-gray-200">
      {TABS.map((t, i) => {
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
            tabIndex={active ? 0 : -1}
            onKeyDown={onKeyDown}
            onClick={() => onChange(t.id)}
            className={cn(
              "-mb-px inline-flex shrink-0 items-center whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-600",
              active ? "border-brand-600 text-brand-700" : "border-transparent text-gray-600 hover:border-gray-300 hover:text-gray-900",
            )}
          >
            {t.label}
            {t.soon && <span className="ml-2 rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700">Soon</span>}
          </button>
        );
      })}
    </div>
  );
}
