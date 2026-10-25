/* Small building blocks shared by the Assessments page sections. */
import type { ReactNode } from "react";
import { CheckCircle2, AlertTriangle, CircleDashed, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  BAND_LABEL,
  BAND_STYLE,
  completionBand,
  fmtPct,
  type CompletionBand,
} from "@/lib/assessmentMetrics";

/** Visible keyboard focus, same as the Overview. */
export const FOCUS_RING =
  "rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2";

const BAND_ICON: Record<CompletionBand, typeof CheckCircle2> = {
  good: CheckCircle2,
  watch: AlertTriangle,
  low: XCircle,
};

/** The student report's card: white, 14px radius, hairline border, a barely-there navy shadow. */
export const CARD = "rounded-[14px] border border-[#E6ECF5] bg-white p-4 shadow-[0_1px_2px_rgba(11,31,77,0.04)] sm:px-[18px]";

/** Table / panel card with the report's title style and an optional leading icon tile. */
export function AssessmentCard({
  title,
  subtitle,
  icon,
  children,
  updating,
}: {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  children: ReactNode;
  updating?: boolean;
}) {
  return (
    <section className="overflow-hidden rounded-[14px] border border-[#E6ECF5] bg-white shadow-[0_1px_2px_rgba(11,31,77,0.04)]">
      <div className="flex items-center gap-3 border-b border-[#E6ECF5] px-5 py-4">
        {icon && <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#EAF1FF] text-[#2563EB]">{icon}</span>}
        <div className="min-w-0">
          <h3 className="text-[15px] font-bold text-[#0B1F4D]">{title}</h3>
          {subtitle && <p className="text-xs text-[#6B7280]">{subtitle}</p>}
        </div>
      </div>
      <div className={cn("transition-opacity", updating && "opacity-60")} aria-busy={updating || undefined}>
        {children}
      </div>
    </section>
  );
}

/** Campus × subject pairs whose quizzes were held but that have no quiz-table records (null = not computed). */
export interface CoverageCounts {
  unitSubjects?: number | null;
  uncoveredSubjects?: number | null;
}

export const isDataIncomplete = (m: CoverageCounts): boolean => (m.uncoveredSubjects ?? 0) > 0;

const coverageText = (m: CoverageCounts) =>
  `${m.uncoveredSubjects} of ${m.unitSubjects} campus-subject pairs have quizzes held but no quiz records. Completion and scores cover only the rest.`;

/** Data coverage, kept apart from the Good / Watch / Low performance band (neutral grey, dashed icon). */
export function CoveragePill({ m }: { m: CoverageCounts }) {
  if (!isDataIncomplete(m)) return null;
  return (
    <span
      title={coverageText(m)}
      className="inline-flex items-center gap-1 rounded border border-slate-300 bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-800"
    >
      <CircleDashed className="h-3 w-3 shrink-0" aria-hidden="true" />
      Data incomplete
      <span className="sr-only">: {coverageText(m)}</span>
    </span>
  );
}

/** Shown above the table only when the selected filters include subjects without quiz records. */
export function CoverageNotice({ m }: { m: CoverageCounts }) {
  if (!isDataIncomplete(m)) return null;
  return (
    <div role="note" className="flex items-start gap-2 rounded-[14px] border border-slate-300 bg-slate-100 px-5 py-3 text-sm text-slate-800">
      <CircleDashed className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <p>
        <span className="font-semibold">Data incomplete.</span> {coverageText(m)} Their expected attempts are not estimated, so these figures do
        not represent the whole institute.
      </p>
    </div>
  );
}

/** Good / Watch / Low with an icon and text, never colour alone. */
export function BandPill({ pct, className }: { pct: number | null | undefined; className?: string }) {
  const band = completionBand(pct);
  if (!band) return null;
  const Icon = BAND_ICON[band];
  const style = BAND_STYLE[band];
  return (
    <span
      className={cn("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium", className)}
      style={{ color: style.color, background: style.bg }}
    >
      <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
      {BAND_LABEL[band]}
    </span>
  );
}

/** Thin progress bar. Purely visual; the number is always shown next to it. */
export function MiniBar({ pct, className, tone = "band" }: { pct: number | null | undefined; className?: string; tone?: "band" | "neutral" }) {
  const band = completionBand(pct);
  const color = tone === "neutral" || !band ? "#2563eb" : BAND_STYLE[band].color;
  return (
    <div className={cn("h-1.5 overflow-hidden rounded bg-slate-100", className)} aria-hidden="true">
      {pct != null && <div className="h-full rounded" style={{ width: `${Math.min(100, Math.max(0, pct))}%`, background: color }} />}
    </div>
  );
}

/** Completion value + mini bar, as used in table cells. The band lives in its own Performance status column. */
export function CompletionCell({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-slate-500">–</span>;
  return (
    <div className="flex min-w-[8rem] items-center justify-end gap-2">
      <MiniBar pct={pct} className="w-14" />
      <span className="w-14 text-right font-semibold tabular-nums text-[#0B1F4D]">{fmtPct(pct)}</span>
    </div>
  );
}

export function fmtDateRange(start?: string | null, end?: string | null): string {
  if (!start || !end) return "–";
  const f = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  return `${f(start)} – ${f(end)}`;
}

/** "Term-wise" tag for institutes that run terms, not two semesters a year. */
export function TermWiseTag() {
  return (
    <span
      className="inline-flex items-center rounded border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-xs font-medium text-indigo-800"
      title="This institute runs terms, so its batches can be on different semesters at the same time."
    >
      Term-wise
    </span>
  );
}
