/**
 * Overview numbers from the saved student reports, with the report's own rules (see directoryReportModel.ts):
 *  - Tiers (Eligible / Recovery / At risk / Ineligible): the report's attendance tier, from the student's weakest course.
 *  - Average attendance: the report's overall attendance; Average SPI: the report's SPI out of 10.
 *  - Skill debt: students with at least one level-F course on their report.
 *  - Assessment averages: the same quiz and Skill Assessment averages as the Student Directory.
 *  - Subject figures: the course's own attendance %, its course score and its level points on the report.
 * Pure functions; the route filters by the user's scope and sends the result.
 */
import { matches, overallAttendance, plain, subjectSet, type DirectoryFilter, type DirectoryStudent, type ReportTier } from "./directoryReportModel.js";

export interface OverviewRank {
  name: string;
  /** The college a section belongs to (sections only). */
  college?: string;
  students: number;
  attendance: number | null;
  /** Colleges and sections: average SPI of the students. Subjects: average level points of the course (0–10). */
  spi: number | null;
  /** Subjects only: average course score (out of 100). */
  score: number | null;
  /** Students with a level-F course (subjects: in that course). */
  debt: number;
}

export interface OverviewAttentionRow {
  studentId: string;
  name: string | null;
  college: string;
  section: string;
  attendancePct: number | null;
}

export interface Overview {
  summary: {
    students: number;
    avgAttendance: number | null;
    avgSpi: number | null;
    eligible: number;
    recovery: number;
    atRisk: number;
    ineligible: number;
    /** Students with no sessions yet: in no tier. */
    noSessions: number;
    skillDebt: number;
  };
  assessment: { classroom: number | null; module: number | null; skill: number | null };
  spiBins: { label: string; count: number }[];
  colleges: OverviewRank[];
  sections: OverviewRank[];
  subjects: OverviewRank[];
  attention: { atRisk: { total: number; rows: OverviewAttentionRow[] }; ineligible: { total: number; rows: OverviewAttentionRow[] } };
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;
const mean = (values: number[], round: (n: number) => number): number | null => (values.length ? round(values.reduce((s, v) => s + v, 0) / values.length) : null);
const nums = (values: (number | null | undefined)[]) => values.filter((v): v is number => v != null);

const TIER_OF: Record<ReportTier, "eligible" | "recovery" | "atRisk" | "ineligible"> = { eligible: "eligible", recovery_eligible: "recovery", at_risk: "atRisk", ineligible: "ineligible" };

export function overviewOf(students: DirectoryStudent[], f: DirectoryFilter, attentionRows = 8): Overview {
  const subjects = subjectSet(f);
  const mine = students.filter((s) => matches(s, f, subjects));
  const courseOf = (s: DirectoryStudent) => (subjects ? s.courses.filter((c) => subjects.has(plain(c.name))) : s.courses);

  const tiers = { eligible: 0, recovery: 0, atRisk: 0, ineligible: 0 };
  let noSessions = 0;
  for (const s of mine) {
    if (s.tier) tiers[TIER_OF[s.tier]]++;
    else noSessions++;
  }

  /* quiz and Skill Assessment averages: quizzes held weighted for classroom and module, mean of course scores for skill */
  const weighted = (pick: (c: DirectoryStudent["courses"][number]) => { avgPct: number; total: number } | null) => {
    let points = 0;
    let held = 0;
    for (const s of mine) for (const c of courseOf(s)) {
      const p = pick(c);
      if (p && p.total > 0) {
        points += p.avgPct * p.total;
        held += p.total;
      }
    }
    return held > 0 ? r1(points / held) : null;
  };
  const skillScores = mine.flatMap((s) => courseOf(s).map((c) => c.skill).filter((p): p is { avgPct: number; total: number } => p != null && p.total > 0).map((p) => p.avgPct));

  const bands: [number, number][] = [[0, 2], [2, 4], [4, 6], [6, 8], [8, 10.01]];
  const spiBins = bands.map(([a, b]) => ({ label: `${a}–${Math.round(b)}`, count: mine.filter((s) => s.spi != null && s.spi >= a && s.spi < b).length }));

  const group = (key: (s: DirectoryStudent) => string, extra?: (s: DirectoryStudent) => string): OverviewRank[] => {
    const by = new Map<string, DirectoryStudent[]>();
    for (const s of mine) {
      const k = key(s);
      by.set(k, [...(by.get(k) ?? []), s]);
    }
    return [...by.entries()].map(([name, list]) => ({
      name,
      ...(extra ? { college: extra(list[0]!) } : {}),
      students: list.length,
      attendance: overallAttendance(list),
      spi: mean(nums(list.map((s) => s.spi)), r2),
      score: null,
      debt: list.filter((s) => courseOf(s).some((c) => c.levelF)).length,
    }));
  };

  const bySubject = new Map<string, { name: string; present: number; held: number; score: number[]; pts: number[]; debt: number; students: number }>();
  for (const s of mine) for (const c of courseOf(s)) {
    const key = plain(c.name);
    const g = bySubject.get(key) ?? { name: c.name, present: 0, held: 0, score: [], pts: [], debt: 0, students: 0 };
    g.students++;
    g.present += c.present ?? 0;
    g.held += c.held ?? 0;
    if (c.score != null) g.score.push(c.score);
    if (c.points != null) g.pts.push(c.points);
    if (c.levelF) g.debt++;
    bySubject.set(key, g);
  }

  const attention = (tier: ReportTier) => {
    const list = mine.filter((s) => s.tier === tier).sort((a, b) => (a.attendancePct ?? 101) - (b.attendancePct ?? 101) || (a.name ?? "").localeCompare(b.name ?? ""));
    return { total: list.length, rows: list.slice(0, attentionRows).map((s) => ({ studentId: s.studentId, name: s.name, college: s.college, section: s.section, attendancePct: s.attendancePct })) };
  };

  return {
    summary: {
      students: mine.length,
      // Σ present ÷ Σ held, as Student Attendance Stats and the Student Directory.
      avgAttendance: overallAttendance(mine),
      avgSpi: mean(nums(mine.map((s) => s.spi)), r2),
      ...tiers,
      noSessions,
      skillDebt: mine.filter((s) => courseOf(s).some((c) => c.levelF)).length,
    },
    assessment: { classroom: weighted((c) => c.classroom), module: weighted((c) => c.module), skill: mean(skillScores, r1) },
    spiBins,
    colleges: group((s) => s.college),
    sections: group((s) => s.section, (s) => s.college),
    subjects: [...bySubject.values()].map((g) => ({ name: g.name, students: g.students, attendance: overallAttendance([{ attPresent: g.present, attHeld: g.held }]), spi: mean(g.pts, r2), score: mean(g.score, r1), debt: g.debt })),
    attention: { atRisk: attention("at_risk"), ineligible: attention("ineligible") },
  };
}
