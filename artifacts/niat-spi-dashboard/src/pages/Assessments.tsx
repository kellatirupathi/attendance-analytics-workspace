/* ------------------------------------------------------------------ */
/*  Assessments: Classroom Quiz, Module Quiz and Skill Assessment.    */
/*  All three tabs share one view (cards, Campus | Students, panel,   */
/*  downloads) from /api/dashboard/assessments/quiz/*.                */
/* ------------------------------------------------------------------ */
import { useEffect } from "react";
import { useLocation } from "wouter";
import { useQueryParams } from "@/hooks/useQueryParams";
import type { AssessmentTypeId } from "@/lib/assessmentMetrics";
import type { QuizType } from "@/lib/quizCoverage";
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
  const raw = query.get("type") as AssessmentTypeId | null;
  const tab: AssessmentTypeId = raw && TAB_QUIZ_TYPE[raw] ? raw : "cq";
  return (
    <QuizCoverageTab
      key={tab}
      quizType={TAB_QUIZ_TYPE[tab]!}
      tabs={<AssessmentTypeTabs value={tab} onChange={(next) => setLocation(next === "cq" ? BASE : `${BASE}?type=${next}`)} />}
    />
  );
}
