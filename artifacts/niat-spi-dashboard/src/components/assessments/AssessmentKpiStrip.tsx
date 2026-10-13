import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionError } from "@/components/dashboard/overview";
import { cn } from "@/lib/utils";
import { fmtInt, fmtPct, fmtScore, type AssessmentMetrics } from "@/lib/assessmentMetrics";
import { BandPill, MiniBar } from "./parts";

function Card({ label, children, updating }: { label: string; children: ReactNode; updating?: boolean }) {
  return (
    <div className="bg-white px-4 py-4" aria-busy={updating || undefined}>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-600">{label}</p>
      <div className={cn("mt-2 transition-opacity", updating && "opacity-60")}>{children}</div>
    </div>
  );
}

const Big = ({ children }: { children: ReactNode }) => (
  <span className="text-2xl font-semibold tabular-nums text-slate-900">{children}</span>
);

/** Four KPI cards for the selected assessment type. */
export function AssessmentKpiStrip({
  metrics,
  loading,
  updating,
  onRetry,
}: {
  metrics: AssessmentMetrics | null;
  loading: boolean;
  updating: boolean;
  onRetry?: () => void;
}) {
  if (onRetry) {
    return (
      <div className="border-y border-slate-200 bg-white">
        <SectionError what="the assessment summary" onRetry={onRetry} />
      </div>
    );
  }
  const m = metrics;
  const skeleton = <Skeleton className="h-14 w-full" />;
  return (
    <div className="grid grid-cols-1 gap-px border-y border-slate-200 bg-slate-200 sm:grid-cols-2 xl:grid-cols-4">
      <Card label="Assessments conducted" updating={updating}>
        {!m || loading ? skeleton : (
          <>
            <p className="text-sm text-slate-700">
              <Big>{fmtInt(m.conducted)}</Big> <span className="tabular-nums">of {fmtInt(m.scheduled)} scheduled</span>
            </p>
            <MiniBar pct={m.conductedPct} tone="neutral" className="mt-2" />
            <p className="mt-1 text-xs tabular-nums text-slate-600">{fmtPct(m.conductedPct)} conducted so far</p>
          </>
        )}
      </Card>
      <Card label="Completion" updating={updating}>
        {!m || loading ? skeleton : (
          <>
            <div className="flex items-center gap-2">
              <Big>{fmtPct(m.completionPct)}</Big>
              <BandPill pct={m.completionPct} />
            </div>
            <MiniBar pct={m.completionPct} className="mt-2" />
            <p className="mt-1 text-xs tabular-nums text-slate-600">
              {fmtInt(m.attempted)} attempted · {fmtInt(m.notAttempted)} not attempted
            </p>
          </>
        )}
      </Card>
      <Card label="Avg score · attempted only" updating={updating}>
        {!m || loading ? skeleton : (
          <>
            <Big>{fmtScore(m.avgScoreAttempted)}</Big>
            <p className="mt-1 text-xs text-slate-600">out of 100, over submitted attempts</p>
          </>
        )}
      </Card>
      <Card label="Overall score · absent = 0" updating={updating}>
        {!m || loading ? skeleton : (
          <>
            <Big>{fmtScore(m.overallScore)}</Big>
            <p className="mt-1 text-xs tabular-nums text-slate-600">across {fmtInt(m.expectedAttempts)} expected attempts</p>
          </>
        )}
      </Card>
    </div>
  );
}
