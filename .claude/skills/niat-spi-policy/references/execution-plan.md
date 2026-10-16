# NIAT-SPI Execution Plan v1.0 (June 2026) — policy reference

Source: *NIAT Skill Performance Index (NIAT-SPI) — Complete Execution-Level Implementation Plan*, Version 1.0, June 2026, prepared by NIAT Academics (16 pages). Section numbers match the document; cite them as §x.y.

## Contents
1. Overview (§1)
2. Roles (§2)
3. Scoring (§3)
4. Eligibility (§4)
5. Assessment operations (§5)
6. Skill Debt (§6)
7. Recovery Attendance Framework (§7)
8. Dashboard (§8)
9. Academic integrity (§9)
10. Infrastructure (§10)
11. Success metrics (§11)

---

## §1 Overview

The plan covers SPI scoring, assessment management, eligibility enforcement, Skill Debt handling, academic integrity and the Recovery Attendance Framework (RAF). It applies to all students in an active NIAT skill cycle and to Instructors, BOAs, the Training Team and HODs.

| Component | What it does |
|---|---|
| SPI Score (0–10) | Composite skill score per student per skill cycle, across all enrolled courses |
| Course Score | Weighted blend of 4 assessment types per course, mapped to a level (A+ to F) and points (0–10) |
| Assessment Framework | Classroom Quizzes → Module Quizzes → Skill Assessments → Final Skill Assessment |
| Eligibility Criteria | Thresholds for attendance, quiz participation and assessment honesty; all must be met to earn SPI |
| Skill Debt | F or Ab in any course creates a Skill Debt, locking NIAT activities until cleared within 2 years |
| RAF | Students below 80% attendance recover credits through post-hours sessions (Week N → N+1) |
| Academic Integrity | Zero tolerance: course reset, removal from roles, exclusion from external activities |

## §2 Roles and responsibilities

- **BOA:** checks the SPI dashboard daily for students below 80% per subject; assigns an instructor per subject/session; creates daily Learning Portal events for recovery classes (for now one combined group open to all; later only students below 80%); schedules recovery classes per pending topics, prod sequence and timetable; validates attendance credit mapping; validates and flags Skill Debt cases; compiles monthly instructor incentive data; maintains dashboard accuracy.
- **Instructor:** delivers all 4 assessment types on schedule; runs 90-minute recovery sessions; submits session completion reports to the BOA within 24 hours and updates session status in the SPI dashboard; reports malpractice immediately.
- **Training Team:** framework oversight, incentive processing (validate, forward to HR/Payroll), SPI system governance and health across campuses, monthly framework effectiveness reports for the HOD.
- **HOD:** reviews the HOD admin dashboard weekly — campus-wise SPI, eligibility rates, Skill Debt counts; escalates systemic issues.
- **Student:** takes part in all 4 assessment types; keeps ≥ 80% attendance; attends recovery sessions when in Recovery Mode; clears Skill Debts within 2 years; reports genuine absences with proof within 5 days.

## §3 SPI scoring

### §3.1 Assessment framework — 4 checkpoint types

| # | Type | Frequency | SPI weight | Purpose |
|---|---|---|---|---|
| 1 | Classroom Quizzes | 2 per topic | 10% | Topic-level clarity check |
| 2 | Module Quizzes | Every 3 topics | 15% | Cross-topic concept application |
| 3 | Skill Assessments | Every 15–30 days | 25% | Speed, accuracy and retention |
| 4 | Final Skill Assessment | Once, end of course | 50% | Full skill readiness — most critical |

**Skill Track Score = (Classroom Quizzes × 10%) + (Module Quizzes × 15%) + (Skill Assessments × 25%) + (Final Skill Assessment × 50%)**

### §3.2 Skill level and points mapping

| Score % | Level | Points | Interpretation |
|---|---|---|---|
| 90 – 100 | A+ | 10 | Exceptional mastery |
| 80 – 89.99 | A | 9 | Strong skill-readiness |
| 70 – 79.99 | B | 8 | Competent |
| 60 – 69.99 | C | 7 | Developing |
| 50 – 59.99 | D | 6 | Borderline — needs improvement |
| Below 50 | F | 0 — Skill Debt | Failed — triggers Skill Debt |
| Absent | Ab | 0 — Skill Debt | No-show — triggers Skill Debt |

Note: a minimum of 50% is required in each quiz format to receive SPI credit; below that, the format counts as 0 points for that component.

### §3.3 Skill Cycle SPI (step 2)

**SPI = Σ (Course Level Points × Course Weight) ÷ Total Weights**

Current skill cycle course weights (sample cycle in the document):

| Course | Weight | Impact |
|---|---|---|
| Back End Development | 4 | High |
| Design and Analysis of Algorithms | 4 | High |
| AI for Finance | 4 | High |
| Probability and Statistics | 3 | Medium |
| Statistical Computing Lab | 1 | Low |
| Logical Reasoning | 3 | Medium |
| Applied Communicative English | 3 | Medium |
| **Total** | **22** | |

BOA note: weight-4 courses affect SPI the most; students at risk in Back End Development, DAA or AI for Finance must be flagged and prioritised for recovery.

*Dashboard reality:* these names don't match most universities' data (e.g. "Logical Reasoning and Analytical Skills", "Advanced Communication Skills", "AI For Finanace"), and no weight data exists in BigQuery — hence equal weights for now.

## §4 Eligibility criteria

SPI is earned only when **all** criteria are met at the same time; failing any one disqualifies the student for that cycle. BOAs track and enforce.

| Requirement | Minimum | Owner | If not met |
|---|---|---|---|
| Attendance | 80% per course | BOA | Recovery Mode; RAF schedule assigned; course marked Skill Debt if recovery classes are skipped |
| Classroom Quizzes | 100% participation | Instructor + Ops | Missing quiz = Ab (0 points); counts against eligibility; recovery assessment only for genuine absences |
| Module Quizzes | 100% completion | Instructor + Ops | Incomplete = Ab (0 points); system flags and a report is circulated; pending work must be done before the Final |
| Skill Assessments | 100% participation | Instructor + Ops | No-show = Ab (0 points); recovery assessment only for approved exceptional cases with prior notice |
| Final Skill Assessment | Mandatory | Instructor + Ops | Non-participation = course grade Ab and automatic Skill Debt; no exceptions without pre-approved medical/emergency proof |
| Assessment Honesty | No malpractice | Instructor | Course reset to Fail; no retake in the same cycle; removal from positions; excluded from external PR activities |

### §4.1 Genuine absence provisions
- Medical or emergency absence: notify COS/PM and submit proof (e.g. medical certificate) **within 5 days** of the missed session.
- Reviewed case by case; approved absences allow a re-sit of the Final as a first attempt, with no grade cap and no fee.
- Approvals are documented with timestamp, approver and proof reference in the attendance system.
- COS/PM escalates borderline cases to the Training Team.

## §5 Assessment operations

### §5.1 Scheduling rules
- Classroom Quizzes: 2 per topic, scheduled by the instructor at the start of each topic, within the topic's delivery window.
- Module Quizzes: 1 per module (every 3 topics), scheduled at module close; BOA confirms in the system.
- Skill Assessments: every 15–30 days; dates fixed by the Training Team at cycle start; told to BOAs 2 weeks ahead.
- Final Skill Assessment: once at the end of each course; date published by the Training Team; BOA tells students at least 4 weeks ahead.

### §5.2 Pre-assessment BOA checklist (before every Skill Assessment and Final)
1. All students confirmed eligible (attendance ≥ 80%, all quizzes completed).
2. Date and venue communicated to all students.
3. Ineligible students flagged and notified with a recovery pathway.
4. Invigilation roster confirmed with instructors.
5. Genuine absence requests decided before assessment day (COS/PM).

## §6 Skill Debt

### §6.1 Triggers (each one independently)
- Final Skill Assessment below 50% (F).
- Absent from the Final without an approved excuse (Ab).
- Skipping assigned recovery classes while in Recovery Mode — course automatically marked Skill Debt.
- Eligibility not met by the end of the cycle (attendance, participation, honesty).

### §6.2 Impact
While any Skill Debt is active: no MINT, BRAVE or GRIT; no placement drives; no internship nominations; co-curricular support suspended. All Skill Debts must be cleared **within 2 years**; beyond that, a mandatory review (possible program extension or discontinuation).

### §6.3 Clearance pathway
1. Auto-enrolment in the recovery window for the debt course (BOA confirms and notifies).
2. Attend all assigned RAF recovery sessions — skipping reinstates the debt and blocks the re-sit.
3. Complete pending assignments, module assessments and practice work before the re-sit.
4. Re-sit the Final Skill Assessment (no grade cap if approved as a medical/emergency case within 5 days).
5. BOA validates the score; ≥ 50% clears the debt and reinstates all activities immediately.

### §6.4 Special conditions
- 2+ F/Ab in one cycle: mandatory counselling with a mentor before clearance starts; a tracked recovery plan is agreed.
- BOA cross-verifies with dashboard data; Training Team flags debts nearing the 2-year limit to the HOD.

## §7 Recovery Attendance Framework (RAF)

### §7.1 Model
Triggered when attendance drops below 80%. Not a punishment — a mandatory path back to eligibility. Week N topics are revised in Week N+1 after college hours.
- 90 minutes per recovery class, after regular hours (e.g. 5:00–6:30 PM).
- 2–3 subjects per day based on attendance deficit; up to 2 sessions per subject per week for very high absenteeism (> 30% deficit).
- Instructor incentive ₹500 per recovery class.
- Credit restoration capped at the institutional maximum.
- Online recovery sessions: camera on, treated as a normal class.

### §7.2 Recovery Mode
| Scenario | Consequence |
|---|---|
| Attendance drops below 80% | Recovery Mode; RAF sessions assigned; **all benefits continue** while recovering |
| Attends recovery, reaches 80% | Recovery Mode cleared; eligibility restored |
| Skips recovery sessions | Ineligible for assessments; course marked Skill Debt; NIAT activities suspended |
| Genuine medical/emergency absence (proof within 5 days) | Reviewed by COS/PM; may get an adjusted plan without penalty |

### §7.3 Weekly cycle
End of Week N: pull attendance, BOA identifies students below 80% per subject → start of Week N+1: BOA assigns instructors and creates Learning Portal events → during Week N+1: instructor delivers, reports within 24 h and updates session status; Training Team validates → end of Week N+1: Training Team audits participation and flags students still below threshold.

### §7.4 Eligibility status tiers
| Status | Attendance | Owner | Action |
|---|---|---|---|
| Eligible | ≥ 80% | Training Team + BOA | Keep monitoring |
| Recovery Eligible | 60–79%; recovery can restore eligibility | BOA | Assign recovery schedule; notify via Learning Portal |
| At Risk | 50–59%; very limited recovery capacity | BOA | Flag immediately; escalate to Training Team |
| Ineligible | < 50%; recovery cannot restore eligibility | BOA + Training Team | Escalate to academic committee; notify HOD; document as Skill Debt |

### §7.5 Instructor incentive flow
Instructor reports within 24 h → BOA validates by the 25th of each month → Training Team cross-verifies and forwards to HR/Payroll within 3 working days → paid in the payroll cycle → disputes within 5 working days.

## §8 Centralized attendance and SPI dashboard

### §8.1 Views
| Viewer | Data | Update |
|---|---|---|
| Student | Attendance % per course; attendance deficit per subject; eligibility status; recovery schedule and history; SPI score; Skill Debt status | Within 24 h of session completion |
| BOA | Batch attendance analytics; eligibility per student; recovery completion log; monthly incentive data | Daily; weekly summary |
| Training Team | Recovery session counts; instructor session tally; SPI system health; compliance; debts near the 2-year limit | Weekly; monthly |
| HOD (all campuses) | Campus eligibility compliance; SPI distribution; Skill Debt counts; recovery completion rate; subject absenteeism heatmap; week-on-week defaulter trend | Weekly rollup every Monday; monthly report |

### §8.2 Compliance requirements
- Session completion status updated within 24 h; recovery credit reflected within 48 h of BOA validation; Skill Debt status within 24 h of grade entry or clearance.
- Auto-flag students who drop below the recovery-eligible threshold.
- Audit logs of all attendance and grade changes; HOD view refreshed every Monday; monthly PDF/Excel export for the HOD.

## §9 Academic integrity
Breaches: cheating, plagiarism, fabricating data, unauthorised collaboration, falsifying records (attendance, timestamps, medical certificates). Consequences: course reset to Fail (no retake in the same cycle), removal from official positions, exclusion from external PR activities, and the Fail triggers a Skill Debt. Process: instructor documents and reports to BOA within 24 h → BOA records, notifies Training Team, holds the grade → Training Team investigates within 5 working days and rules → HOD notified of confirmed breaches; ruling logged permanently.

## §10 Infrastructure readiness
Before each cycle: attendance tracking platform with recovery credit mapping; all dashboard views tested; **automated SPI calculation engine** (Skill Track Score and Skill Cycle SPI from grades and weightages); assessment platform for all 4 types; classrooms, power/connectivity, faculty roster with backups, templates, after-hours transport. Contingencies: backup instructor or reschedule within the week; alternate venue ≥ 24 h ahead; manual recording during outages, entered within 24 h; paper-based assessment if the platform is down > 30 minutes.

## §11 Success metrics

| Metric | Target |
|---|---|
| Average Skill Cycle SPI | ≥ 7.0 |
| SPI Eligibility Rate | ≥ 85% |
| Assessment Participation Rate (all 4 types) | 100% |
| Attendance Achievement Rate | ≥ 80% |
| Recovery Participation Rate (≥ 1 session) | ≥ 75% |
| Recovery Class Completion Rate | ≥ 95% |
| Skill Debt Rate (end of cycle) | < 10% |
| Skill Debt Clearance Rate (same academic year) | ≥ 70% |
| Dashboard Compliance Rate (updated within 24 h) | 100% |
| Campus Compliance Rate | ≥ 90% |
| Academic Integrity Breach Rate | 0 |

Reporting cadence (§11.2): recovery schedule weekly (BOA → students, instructors); session completion report within 24 h; eligibility and Skill Debt update weekly (to students via dashboard, HOD); assessment score summary within 72 h; incentive summary monthly; campus data validation every Monday; framework effectiveness and Skill Debt status reports monthly to the HOD.
