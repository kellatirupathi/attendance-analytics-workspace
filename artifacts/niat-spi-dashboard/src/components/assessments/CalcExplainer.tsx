import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { COMPLETION_BANDS } from "@/lib/assessmentMetrics";
import { FOCUS_RING } from "./parts";

const TERMS: [string, string][] = [
  ["Scheduled", "All assessments planned for a campus and semester."],
  ["Conducted", "Scheduled assessments whose date has passed and whose session is marked completed or partially completed. Only conducted assessments enter any calculation."],
  ["Roster", "Active students of that campus and semester."],
  ["Expected attempts", "Students × conducted assessments: one slot per student per conducted assessment."],
  ["Attempted", "A slot with a submitted attempt. A submitted 0 counts as attempted; absent and unsubmitted slots do not."],
  ["Score %", "Marks obtained ÷ max marks × 100, using the student's best attempt. Absent = 0."],
];

const FORMULAS: [string, string][] = [
  ["Completion %", "attempted ÷ expected attempts × 100"],
  ["Not attempted", "expected attempts − attempted"],
  ["Avg score (attempted only)", "sum of score % ÷ attempted"],
  ["Overall score (absent = 0)", "sum of score % ÷ expected attempts"],
];

export function CalcExplainer() {
  const [open, setOpen] = useState(false);
  return (
    <section className="border-y border-slate-200 bg-white">
      <h2>
        <button
          type="button"
          aria-expanded={open}
          aria-controls="calc-explainer"
          onClick={() => setOpen((v) => !v)}
          className={cn("flex w-full items-center justify-between px-5 py-3.5 text-left text-sm font-semibold text-slate-900 hover:bg-slate-50", FOCUS_RING)}
        >
          How these numbers are calculated
          <ChevronDown className={cn("h-4 w-4 text-slate-600 transition-transform", open && "rotate-180")} aria-hidden="true" />
        </button>
      </h2>
      {open && (
        <div id="calc-explainer" className="grid gap-6 border-t border-slate-200 px-5 py-4 text-sm text-slate-700 lg:grid-cols-2">
          <dl className="space-y-2">
            {TERMS.map(([term, text]) => (
              <div key={term}>
                <dt className="font-medium text-slate-900">{term}</dt>
                <dd>{text}</dd>
              </div>
            ))}
          </dl>
          <div className="space-y-4">
            <dl className="space-y-2">
              {FORMULAS.map(([term, text]) => (
                <div key={term} className="flex flex-wrap gap-x-2">
                  <dt className="font-medium text-slate-900">{term} =</dt>
                  <dd className="font-mono text-[13px]">{text}</dd>
                </div>
              ))}
            </dl>
            <p>
              <span className="font-medium text-slate-900">Roll-ups: sum first, divide last.</span> "All campuses" and "All semesters" add the raw
              counts (expected attempts, attempted, score sum) across rows and apply the formulas once. Percentages are never averaged.
            </p>
            <p>
              <span className="font-medium text-slate-900">No conducted assessments:</span> rates show "–", never 0%.
            </p>
            <p>
              <span className="font-medium text-slate-900">Completion bands:</span> Good ≥ {COMPLETION_BANDS.good}%, Watch {COMPLETION_BANDS.watch}–
              {COMPLETION_BANDS.good}%, Low &lt; {COMPLETION_BANDS.watch}%.
            </p>
            <p>
              <span className="font-medium text-slate-900">Skill assessments:</span> main assessments only (practice ones are left out). One slot per
              student per assessment that has been held: attempted and evaluated, or its window has closed. A held assessment that was not attempted
              counts as 0; an attempt still waiting for evaluation is left out. Students come from the Skill Assessment data, and its courses follow
              the Skill Assessment course map, so an unmapped course shows under its assessment code.
            </p>
            <p>
              <span className="font-medium text-slate-900">Semester dates:</span> each batch uses its own current semester window, so term-wise
              institutes can have batches on different semesters at once.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
