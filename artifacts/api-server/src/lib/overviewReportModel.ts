/**
 * Overview numbers from the saved student reports, with the report's own rules (see directoryReportModel.ts), so every
 * figure agrees with the Student Directory and the reports:
 *  - Attendance: Σ present ÷ Σ held (cut to one decimal); tiers (Eligible / Recovery / At risk / Ineligible) are the
 *    report's tier, from the student's weakest course.
 *  - Quiz and Skill Assessment averages (Method A): the simple average of the course scores, each student × course with
 *    one held counting once, as the Student Directory and Assessments.
 *  - No SPI figures: the SPI waits for the Final Skill Assessment ("Coming soon" on every page).
 * Pure functions; the route filters by the user's scope and sends the result.
 */
import { matches, overallAttendance, plain, scoreAverage, subjectSet, type DirectoryCourse, type DirectoryFilter, type DirectoryPart, type DirectoryStudent, type ReportTier } from "./directoryReportModel.js";

/** Quiz and Skill Assessment averages of a group (null when nothing was held). */
export interface AssessmentAverages {
  classroom: number | null;
  module: number | null;
  skill: number | null;
}

export interface OverviewRank extends AssessmentAverages {
  name: string;
  /** The college a section belongs to (sections only). */
  college?: string;
  students: number;
  attendance: number | null;
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
    eligible: number;
    recovery: number;
    atRisk: number;
    ineligible: number;
    /** Students with no sessions yet: in no tier. */
    noSessions: number;
  };
  assessment: AssessmentAverages;
  colleges: OverviewRank[];
  sections: OverviewRank[];
  subjects: OverviewRank[];
  attention: { atRisk: { total: number; rows: OverviewAttentionRow[] }; ineligible: { total: number; rows: OverviewAttentionRow[] } };
}

const TIER_OF: Record<ReportTier, "eligible" | "recovery" | "atRisk" | "ineligible"> = { eligible: "eligible", recovery_eligible: "recovery", at_risk: "atRisk", ineligible: "ineligible" };

/** Running sums for one group: attendance and the three course-score averages. */
class Acc {
  students = 0;
  present = 0;
  held = 0;
  cq = [0, 0];
  mq = [0, 0];
  sa = [0, 0];
  addPart(sum: number[], p: DirectoryPart | null) {
    if (p && p.total > 0) {
      sum[0] += p.avgPct;
      sum[1]! += 1;
    }
  }
  addCourse(c: DirectoryCourse) {
    this.addPart(this.cq, c.classroom);
    this.addPart(this.mq, c.module);
    this.addPart(this.sa, c.skill);
  }
  averages(): AssessmentAverages {
    return { classroom: scoreAverage(this.cq[0]!, this.cq[1]!), module: scoreAverage(this.mq[0]!, this.mq[1]!), skill: scoreAverage(this.sa[0]!, this.sa[1]!) };
  }
  attendance(): number | null {
    return overallAttendance([{ attPresent: this.present, attHeld: this.held }]);
  }
}

export function overviewOf(students: DirectoryStudent[], f: DirectoryFilter, attentionRows = 8): Overview {
  const subjects = subjectSet(f);
  const mine = students.filter((s) => matches(s, f, subjects));
  const courseOf = (s: DirectoryStudent) => (subjects ? s.courses.filter((c) => subjects.has(plain(c.name))) : s.courses);

  const tiers = { eligible: 0, recovery: 0, atRisk: 0, ineligible: 0 };
  let noSessions = 0;
  const all = new Acc();
  const colleges = new Map<string, Acc>();
  const sections = new Map<string, Acc & { college?: string; label?: string }>();
  const bySubject = new Map<string, Acc & { label?: string }>();
  const get = <T extends Acc>(map: Map<string, T>, key: string, make: () => T) => {
    let a = map.get(key);
    if (!a) map.set(key, (a = make()));
    return a;
  };

  for (const s of mine) {
    if (s.tier) tiers[TIER_OF[s.tier]]++;
    else noSessions++;
    const college = get(colleges, s.college, () => new Acc());
    // A section name repeats across colleges: keep them apart.
    const section = get(sections, `${s.college}\t${s.section}`, () => Object.assign(new Acc(), { college: s.college, label: s.section }));
    for (const g of [all, college, section]) {
      g.students++;
      g.present += s.attPresent ?? 0;
      g.held += s.attHeld ?? 0;
    }
    for (const c of courseOf(s)) {
      for (const g of [all, college, section]) g.addCourse(c);
      const subject = get(bySubject, plain(c.name), () => Object.assign(new Acc(), { label: c.name }));
      subject.students++;
      subject.present += c.present ?? 0;
      subject.held += c.held ?? 0;
      subject.addCourse(c);
    }
  }

  const rank = (name: string, a: Acc, college?: string): OverviewRank => ({ name, ...(college ? { college } : {}), students: a.students, attendance: a.attendance(), ...a.averages() });

  const attention = (tier: ReportTier) => {
    const list = mine.filter((s) => s.tier === tier).sort((a, b) => (a.attendancePct ?? 101) - (b.attendancePct ?? 101) || (a.name ?? "").localeCompare(b.name ?? ""));
    return { total: list.length, rows: list.slice(0, attentionRows).map((s) => ({ studentId: s.studentId, name: s.name, college: s.college, section: s.section, attendancePct: s.attendancePct })) };
  };

  return {
    summary: {
      students: mine.length,
      // Σ present ÷ Σ held, as Student Attendance Stats and the Student Directory.
      avgAttendance: overallAttendance(mine),
      ...tiers,
      noSessions,
    },
    assessment: all.averages(),
    colleges: [...colleges].map(([name, a]) => rank(name, a)),
    sections: [...sections.values()].map((a) => rank(a.label!, a, a.college)),
    subjects: [...bySubject.values()].map((a) => rank(a.label!, a)),
    attention: { atRisk: attention("at_risk"), ineligible: attention("ineligible") },
  };
}
