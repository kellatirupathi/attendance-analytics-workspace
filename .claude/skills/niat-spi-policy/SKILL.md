---
name: niat-spi-policy
description: The NIAT Skill Performance Index (NIAT-SPI) policy from the NIAT-SPI Execution Plan v1.0, plus the implementation decisions agreed for this dashboard. Use it whenever you calculate, change, explain or check anything about SPI, Skill Track / course scores, skill levels and points (A+ to F/Ab), Classroom or Module Quizzes, Skill Assessments, the Final Skill Assessment, eligibility criteria, Skill Debt, Recovery Mode / RAF, attendance tiers (80/60/50), or the student SPI report / scorecard, the SPI Record page and quiz or attendance data checks — even if the user does not say "policy" (e.g. "why is this student F?", "badge shows ON TRACK", "check SPI for this student").
---

# NIAT-SPI policy and dashboard rules

This skill keeps every SPI number, label and message on the dashboard consistent with the policy document **NIAT-SPI Execution Plan v1.0 (June 2026, NIAT Academics)**, and with the decisions the user has already taken where the policy is silent or the data is incomplete.

- The policy itself, section by section: [references/execution-plan.md](references/execution-plan.md). Read the relevant section before answering a policy question or writing student-facing text, and cite it as "§x.y".
- The scoring code: `artifacts/api-server/src/lib/spiScorecardRules.ts` (pure rules, tested by `pnpm --filter @workspace/api-server run test:scorecard`) and `spiScorecard.ts` (loads data). The report UI is `artifacts/niat-spi-dashboard/src/pages/StudentReportView.tsx`.

## The policy in one screen

**Course score (Skill Track Score)** — per course, §3.1:
`Classroom Quizzes × 10% + Module Quizzes × 15% + Skill Assessments × 25% + Final Skill Assessment × 50%`
A format scored below 50% earns 0 for that component (§3.2 note).

**Level and points** — from the course score, §3.2:

| Score % | Level | Points |
|---|---|---|
| 90 – 100 | A+ | 10 |
| 80 – 89.99 | A | 9 |
| 70 – 79.99 | B | 8 |
| 60 – 69.99 | C | 7 |
| 50 – 59.99 | D | 6 |
| Below 50 | F | 0 — Skill Debt |
| Absent | Ab | 0 — Skill Debt |

**SPI (0–10)** — §3.3: `Σ (course level points × course weight) ÷ total weight`. The weights in the plan (4,4,4,3,1,3,3 = 22) are for one sample cycle only; real course names differ by university.

**Eligibility** — all must be met to earn SPI, §4: attendance ≥ 80% **in every course**; Classroom Quizzes 100% participation; Module Quizzes 100% completion; Skill Assessments 100% participation; Final Skill Assessment mandatory; no malpractice (the user removed "Academic Integrity" from the report).

**Skill Debt** — any F or Ab in a course, §6.1: Final < 50%, absent from the Final, skipping assigned recovery classes, or eligibility not met by cycle end. While active it pauses MINT, BRAVE, GRIT, placements, internships and co-curricular support (§6.2); must be cleared within 2 years.

**Attendance tiers** — §7.4: Eligible ≥ 80%, Recovery Eligible 60–79%, At Risk 50–59%, Ineligible < 50%. Below 80% puts the student in Recovery Mode with recovery classes after college hours (Week N → N+1, 90 min); benefits continue while recovering (§7.2).

## Decisions already agreed (apply them; don't re-ask)

These fill gaps in the policy or in the data. Change one only when the user says so, and mention which one you are relying on when it affects a number.

1. **Equal course weights.** No course-weight data exists anywhere in BigQuery, so every course counts 1 and SPI = Σ points ÷ number of scored courses. Don't show a weight column or "÷ 22" to students.
2. **Skill Assessment and Final scores are not in the data yet.** Leave them out of the course score (re-scale over the types that have data: today `(CQ × 10 + MQ × 15) ÷ 25`) and show "Not available yet" — never 0. Some institutes did hold Skill Assessments; the table just isn't available.
3. **Quiz counting** (same as the Assessments page): denominator = quizzes held so far (`total_scheduled_quizes`), attempted = `LEAST(total_completed_quizzes, total_scheduled_quizes)`, score = best-attempt scores ÷ quizzes held, so a **missed quiz counts as 0** (§4, Ab). A quiz type with 0 held is "Not conducted yet" and is left out — never scored as 0.
4. **Classroom vs Module** comes from `derived_unit_type` read as text. BigQuery returns every value as a string, so never branch on a BOOL column (`"false"` is truthy).
5. **Quiz rows map to courses** by `semester_course_title`, then `course_title`, exact match ignoring case; rows matching none of the student's current courses are dropped (keeps other semesters out).
6. **Attendance = NIAT course session slots only** (`entity_type = SESSION_SLOT`, current semester, dated up to today IST). Day-level `ATTENDANCE_SLOT` rows never count. Rows with a blank `subject_title` belong to no course.
7. **Categories shown:** today the code *excludes* PHYSICS, CHEMISTRY, OTHERS, INDIAN KNOWLEDGE SYSTEM CSC (`config/attendance-exclusions.json`). The user wants only TECH, MATH, APTITUDE, ENGLISH; switching to an include list is pending their decision on scope and on courses with no category.
8. **Report wording:** simple English for students; policy terms (Skill Track Score, Skill Level, Level Points, Skill Debt, Recovery Mode). Under the SPI gauge show "Provisional. SPI counts only once every eligibility rule is met." while any rule is not met. No Student ID, no Skill Cycle, no course weights on the report. Say "Attendance is counted for NIAT course sessions only."

## How to work with this

- **Before changing a rule**, state the current rule, the proposed one and a worked example with real numbers; the user reviews rules before they ship. Skill Debt and eligibility labels reach every student, so a wrong label has real consequences (paused placements).
- **Explain numbers with arithmetic**, e.g. "AI For Finance: CQ 54.5% (17 of 26), MQ 22% → MQ below 50 earns 0 → (545 + 0) ÷ 25 = 21.8 → F, 0 points".
- **Staff pages still use the old formula** `(CQ avg × 10 + MQ avg × 15) ÷ 100 ÷ 10` (max 2.5, no levels): `spiRecordAggregate.ts`, `SPI_POINTS_SQL` in `queries.ts`, `lib/spiScore.ts`. Expect the student report and the SPI Record / Students pages to disagree until those are switched; say so when comparing.
- **Open questions the user has not settled** (ask, don't assume): SPI badge thresholds (proposed GOOD ≥ 8 / NEEDS IMPROVEMENT 6–7.99 / AT RISK < 6, plus SKILL DEBT or RECOVERY MODE); whether to show attendance rows with no course as "Other sessions"; category include list; whether Skill Debt should show before Final scores exist.
- **Data checks:** BigQuery is read-only; ask before running queries locally (key at `.secrets/bigquery-service-account.json`, gitignored). Log data gaps with the `findings-log` skill.
