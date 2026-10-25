import type { ReactNode } from "react";
import { AlertTriangle, BarChart3, ClipboardCheck, Target, Users, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtInt, fmtPct, fmtScore, type AssessmentMetrics } from "@/lib/assessmentMetrics";
import { BandPill, CARD, FOCUS_RING, MiniBar } from "./parts";

/** Icon tile colours of the student report's tones. */
const TONES = {
  blue: "bg-[#EAF1FF] text-[#2563EB]",
  purple: "bg-[#F5F3FF] text-[#7C3AED]",
  green: "bg-[#E6F7EC] text-[#15803D]",
  red: "bg-[#FDECEF] text-[#BE123C]",
} as const;

function KpiCard({
  icon: Icon,
  tone,
  label,
  value,
  unit,
  badge,
  bar,
  hint,
  updating,
  onRetry,
}: {
  icon: LucideIcon;
  tone: keyof typeof TONES;
  label: string;
  value: string | null;
  unit?: string;
  badge?: ReactNode;
  bar?: ReactNode;
  hint?: ReactNode;
  updating: boolean;
  onRetry?: () => void;
}) {
  return (
    <div className={cn(CARD, "flex min-w-0 flex-col gap-3")} aria-busy={updating || undefined}>
      <div className="flex items-center gap-3">
        <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", TONES[tone])}>
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <p className="text-[13px] font-bold text-[#0B1F4D]">{label}</p>
      </div>
      {onRetry ? (
        <div>
          <p className="flex items-center gap-1.5 text-sm text-red-700">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" /> Couldn't load
          </p>
          <button type="button" onClick={onRetry} className={cn("mt-1 text-xs font-medium text-brand-800 hover:underline", FOCUS_RING)}>
            Retry
          </button>
        </div>
      ) : (
        <>
          <div className={cn("flex flex-wrap items-baseline justify-between gap-2 transition-opacity", updating && "opacity-60")}>
            <p className="text-[28px] font-extrabold leading-none tabular-nums text-[#0B1F4D]">
              {value ?? "…"}
              {unit && value && <small className="ml-1 text-[13px] font-medium text-[#6B7280]">{unit}</small>}
            </p>
            {badge}
          </div>
          {bar}
          {hint && <p className="text-xs tabular-nums text-[#6B7280]">{hint}</p>}
        </>
      )}
    </div>
  );
}

/** Four KPI cards for the selected assessment type, in the student report's card style. */
export function AssessmentKpiStrip({
  metrics,
  updating,
  onRetry,
}: {
  metrics: AssessmentMetrics | null;
  updating: boolean;
  onRetry?: () => void;
}) {
  const m = metrics;
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <KpiCard
        icon={ClipboardCheck}
        tone="blue"
        label="Conducted assessments"
        value={m ? `${fmtInt(m.conducted)} / ${fmtInt(m.scheduled)}` : null}
        badge={m && m.conductedPct != null ? <span className="rounded-full bg-[#E6F7EC] px-2 py-0.5 text-xs font-semibold tabular-nums text-[#15803D]">{fmtPct(m.conductedPct)}</span> : undefined}
        bar={m ? <MiniBar pct={m.conductedPct} tone="neutral" className="h-2 rounded-full" /> : undefined}
        hint={m ? "Conducted out of scheduled" : undefined}
        updating={updating}
        onRetry={onRetry}
      />
      <KpiCard
        icon={Users}
        tone="purple"
        label="Student completion"
        value={m ? fmtPct(m.completionPct) : null}
        badge={m ? <BandPill pct={m.completionPct} /> : undefined}
        bar={m ? <MiniBar pct={m.completionPct} className="h-2 rounded-full" /> : undefined}
        hint={m ? `${fmtInt(m.attempted)} of ${fmtInt(m.expectedAttempts)} attempts` : undefined}
        updating={updating}
        onRetry={onRetry}
      />
      <KpiCard
        icon={BarChart3}
        tone="green"
        label="Average score (attempted)"
        value={m ? fmtScore(m.avgScoreAttempted) : null}
        unit="/ 100"
        bar={m ? <MiniBar pct={m.avgScoreAttempted} tone="neutral" className="h-2 rounded-full" /> : undefined}
        hint={m ? "Best attempt of submitted quizzes" : undefined}
        updating={updating}
        onRetry={onRetry}
      />
      <KpiCard
        icon={Target}
        tone="red"
        label="Overall score (incl. absent)"
        value={m ? fmtScore(m.overallScore) : null}
        unit="/ 100"
        bar={m ? <MiniBar pct={m.overallScore} tone="neutral" className="h-2 rounded-full" /> : undefined}
        hint={m ? "Absent students count as zero" : undefined}
        updating={updating}
        onRetry={onRetry}
      />
    </div>
  );
}
