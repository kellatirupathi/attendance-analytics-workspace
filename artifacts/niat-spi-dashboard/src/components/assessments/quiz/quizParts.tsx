import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { bandOf, QUIZ_LABEL, type BandMetric, type QuizKpis, type QuizType } from "@/lib/quizCoverage";
import { fmtInt } from "@/lib/assessmentMetrics";

const BAND_CLASS = {
  green: "bg-emerald-50 text-emerald-700",
  amber: "bg-amber-50 text-amber-700",
  red: "bg-red-50 text-red-700",
  none: "bg-slate-100 text-slate-500",
} as const;

/** A percent in a coloured pill (colours from BANDS); a missing value shows "–" in a grey pill. */
export function Pill({ metric, value }: { metric: BandMetric; value: number | null }) {
  return (
    <span className={cn("inline-block min-w-[3.5rem] rounded-full px-2.5 py-0.5 text-center text-xs font-semibold tabular-nums", BAND_CLASS[bandOf(metric, value)])}>
      {value == null ? "–" : `${value.toFixed(1)}%`}
    </span>
  );
}

/** The (i) next to a card label; the text opens on hover and on keyboard focus. */
export function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" aria-label={`About ${label}`} className="rounded-full text-slate-400 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600">
          <Info className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs leading-relaxed">{children}</TooltipContent>
    </Tooltip>
  );
}

function Bar({ pct }: { pct: number | null }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
      <div className="h-full rounded-full bg-brand-600" style={{ width: `${Math.max(0, Math.min(100, pct ?? 0))}%` }} />
    </div>
  );
}

function Card({ label, tip, value, children, loading }: { label: string; tip: ReactNode; value: string; children?: ReactNode; loading: boolean }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
        <span>{label}</span>
        <InfoTip label={label}>{tip}</InfoTip>
      </div>
      {loading ? <Skeleton className="h-9 w-28" /> : <p className="text-3xl font-bold tracking-tight text-slate-900 tabular-nums">{value}</p>}
      {!loading && children}
    </div>
  );
}

const pctText = (v: number | null) => (v == null ? "–" : `${v.toFixed(1)}%`);

/** The four cards: Available, Scheduled so far (with completion rate), Avg score, Student participation. */
export function QuizKpiCards({ kpis, loading, quizType, onRetry, failed }: { kpis: QuizKpis | undefined; loading: boolean; quizType: QuizType; onRetry: () => void; failed: boolean }) {
  const kind = QUIZ_LABEL[quizType].short;
  const Quizzes = `${QUIZ_LABEL[quizType].name.split(" ")[0]} quizzes`;
  if (failed && !kpis) {
    return (
      <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        <span>We couldn't load the numbers.</span>
        <button type="button" onClick={onRetry} className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold">
          Retry
        </button>
      </div>
    );
  }
  const k = kpis;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Card label="Available (prod sequence)" tip={`${Quizzes} planned in the prod sequence for the current semester, counted per section`} value={fmtInt(k?.available ?? 0)} loading={loading || !k} />
      <Card
        label="Scheduled so far"
        tip={`${Quizzes} whose session is scheduled on or before today, counted per section. Completion rate = quizzes marked Completed on the learning portal ÷ quizzes scheduled for each student`}
        value={fmtInt(k?.scheduledSoFar ?? 0)}
        loading={loading || !k}
      >
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>Completion rate</span>
          <span className="font-semibold tabular-nums text-slate-700">{pctText(k?.completionRate ?? null)}</span>
        </div>
        <Bar pct={k?.completionRate ?? null} />
      </Card>
      <Card label="Avg score" tip="Average score over all scheduled quizzes. A quiz a student did not complete counts as 0" value={pctText(k?.avgScore ?? null)} loading={loading || !k} />
      <Card label="Student participation" tip={`Students who completed at least one ${kind}`} value={pctText(k?.participation ?? null)} loading={loading || !k}>
        <p className="text-xs tabular-nums text-slate-500">
          {fmtInt(k?.participants ?? 0)} / {fmtInt(k?.students ?? 0)} students
        </p>
        <Bar pct={k?.participation ?? null} />
      </Card>
    </div>
  );
}
