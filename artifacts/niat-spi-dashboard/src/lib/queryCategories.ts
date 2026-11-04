/**
 * Categories and "What is the problem?" options of "Raise a query", in the student's words. The keys must match
 * QUERY_CATEGORIES in api-server lib/studentQueries.ts. Final Skill Assessment comes later.
 */
export interface QueryProblem {
  value: string;
  label: string;
}
export interface QueryCategory {
  value: string;
  label: string;
  problems: QueryProblem[];
}

const QUIZ_PROBLEMS: QueryProblem[] = [
  { value: "shows_not_attempted", label: "I attempted the quiz, but it shows not attempted" },
  { value: "completed_count_wrong", label: "My completed count is wrong" },
  { value: "score_wrong", label: "My score is wrong" },
  { value: "cannot_open", label: "I could not find / open the quiz" },
  { value: "technical_problem", label: "The quiz stopped / had a technical problem" },
  { value: "something_else", label: "Something else" },
];

export const QUERY_CATEGORIES: QueryCategory[] = [
  {
    value: "attendance",
    label: "Attendance",
    problems: [
      { value: "shows_absent", label: "I attended the class, but it shows absent" },
      { value: "class_missing", label: "A class I attended is missing" },
      { value: "percentage_wrong", label: "My attendance % is wrong" },
      { value: "not_updated", label: "My attendance is not updated for recent classes" },
      { value: "something_else", label: "Something else" },
    ],
  },
  { value: "classroom_quiz", label: "Classroom Quiz", problems: QUIZ_PROBLEMS },
  { value: "module_quiz", label: "Module Quiz", problems: QUIZ_PROBLEMS },
  {
    value: "skill_assessment",
    label: "Skill Assessment",
    problems: [
      { value: "score_not_showing", label: "I took the assessment, but my score is not showing" },
      { value: "completed_count_wrong", label: "My completed count is wrong" },
      { value: "score_wrong", label: "My score is wrong" },
      { value: "wrong_subject", label: "My score is shown under the wrong subject" },
      { value: "could_not_take", label: "I could not take it (technical problem)" },
      { value: "something_else", label: "Something else" },
    ],
  },
];

/** The wording of a problem key within a category ("My score is wrong"), or null when unknown. */
export function problemLabel(category: string, key: string | null | undefined): string | null {
  if (!key) return null;
  return QUERY_CATEGORIES.find((c) => c.value === category)?.problems.find((p) => p.value === key)?.label ?? null;
}
