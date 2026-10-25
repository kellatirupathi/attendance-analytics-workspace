import { StatTile } from "@/components/dashboard/overview";
import { fmtInt, fmtPct, fmtScore, type AssessmentMetrics } from "@/lib/assessmentMetrics";
import { BandPill, MiniBar } from "./parts";

/** Four KPI tiles for the selected assessment type, in the same tile grid as the Overview. */
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
    <div className="grid grid-cols-2 gap-px border-y border-slate-200 bg-slate-200 md:grid-cols-4">
      <StatTile
        label="Assessments conducted"
        value={m ? `${fmtInt(m.conducted)} of ${fmtInt(m.scheduled)}` : null}
        hint={
          m ? (
            <>
              <MiniBar pct={m.conductedPct} tone="neutral" className="mb-1 mt-1" />
              {fmtPct(m.conductedPct)} of scheduled quizzes held so far
            </>
          ) : undefined
        }
        updating={updating}
        onRetry={onRetry}
      />
      <StatTile
        label="Completion"
        value={m ? fmtPct(m.completionPct) : null}
        hint={
          m ? (
            <>
              <span className="mb-1 mt-1 flex items-center gap-2">
                <MiniBar pct={m.completionPct} className="flex-1" />
                <BandPill pct={m.completionPct} />
              </span>
              <span className="tabular-nums">
                {fmtInt(m.attempted)} attempted · {fmtInt(m.notAttempted)} not attempted
              </span>
            </>
          ) : undefined
        }
        updating={updating}
        onRetry={onRetry}
      />
      <StatTile
        label="Avg score · attempted"
        value={m ? fmtScore(m.avgScoreAttempted) : null}
        hint="Out of 100, best attempt of submitted quizzes"
        updating={updating}
        onRetry={onRetry}
      />
      <StatTile
        label="Overall score · absent = 0"
        value={m ? fmtScore(m.overallScore) : null}
        hint={m ? <span className="tabular-nums">Across {fmtInt(m.expectedAttempts)} expected attempts</span> : undefined}
        updating={updating}
        onRetry={onRetry}
      />
    </div>
  );
}
