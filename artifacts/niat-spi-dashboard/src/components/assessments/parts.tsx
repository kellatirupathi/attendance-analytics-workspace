/* Small building blocks shared by the Assessments page sections. */
import { CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
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

/** Completion value + mini bar + band pill, as used in table cells. */
export function CompletionCell({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-slate-500">–</span>;
  return (
    <div className="flex min-w-[11rem] items-center justify-end gap-2">
      <span className="w-12 text-right font-semibold tabular-nums text-slate-900">{fmtPct(pct)}</span>
      <MiniBar pct={pct} className="w-14" />
      <BandPill pct={pct} className="w-[4.5rem]" />
    </div>
  );
}

export function fmtDateRange(start?: string, end?: string): string {
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
