/* ------------------------------------------------------------------ */
/*  Assessments: Classroom Quiz, Module Quiz and Skill Assessment.    */
/*  All three tabs share one view (cards, Campus | Students, panel,   */
/*  downloads) from /api/dashboard/assessments/quiz/*.                */
/* ------------------------------------------------------------------ */
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQueryParams } from "@/hooks/useQueryParams";
import type { AssessmentTypeId } from "@/lib/assessmentMetrics";
import { NO_FILTERS, type QuizFilters, type QuizType } from "@/lib/quizCoverage";
import { PageHeader } from "@/components/PageHeader";
import { AssessmentTypeTabs } from "@/components/assessments/AssessmentTypeTabs";
import { QuizCoverageTab } from "@/components/assessments/quiz/QuizCoverageTab";

const BASE = "/dashboard/assessments";

const TAB_QUIZ_TYPE: Partial<Record<AssessmentTypeId, QuizType>> = {
  cq: "CLASSROOM_QUIZ",
  mq: "MODULE_QUIZ",
  skill: "SKILL_ASSESSMENT",
};

/** Old links (/dashboard/assessments/students, /subjects) open this page. */
export default function Assessments() {
  const [location, setLocation] = useLocation();
  const legacy = location.startsWith(`${BASE}/`);

  useEffect(() => {
    if (legacy) setLocation(BASE, { replace: true });
  }, [legacy, setLocation]);

  return legacy ? null : <AssessmentsPage />;
}

function AssessmentsPage() {
  const query = useQueryParams();
  const [, setLocation] = useLocation();
  // One set of filters for every tab: choosing a college or semester on one tab keeps it on the others.
  const [filters, setFilters] = useState<QuizFilters>(NO_FILTERS);
  const raw = query.get("type") as AssessmentTypeId | null;
  const tab: AssessmentTypeId = raw && (TAB_QUIZ_TYPE[raw] || raw === "final") ? raw : "cq";
  const tabs = <AssessmentTypeTabs value={tab} onChange={(next) => setLocation(next === "cq" ? BASE : `${BASE}?type=${next}`)} />;
  const quizType = TAB_QUIZ_TYPE[tab];
  if (!quizType) {
    return (
      <div className="flex min-w-0 flex-col">
        <PageHeader title="Assessments" />
        <div className="mt-5">{tabs}</div>
        <div className="mt-5 rounded-xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
          <p className="text-base font-semibold text-slate-900">Final Skill Assessment</p>
          <p className="mt-1 text-sm text-slate-500">Coming soon</p>
        </div>
      </div>
    );
  }
  return <QuizCoverageTab key={tab} quizType={quizType} tabs={tabs} filters={filters} onFiltersChange={setFilters} />;
}
