export interface SpiDetailRow {
  studentId: string;
  studentName: string;
  university: string;
  semester: string;
  section: string;
  classroomAvg: number | null;
  moduleAvg: number | null;
  presentN: number;
  scheduledN: number;
}

interface PersonScore {
  studentId: string;
  studentName: string;
  spi: number;
  skill: string;
  classroom: number | null;
  module: number | null;
  attendance: number | null;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function spiPointsOf(classroom: number | null, module: number | null): number {
  return (((classroom ?? 0) * 10 + (module ?? 0) * 15) / 100) / 10;
}

export function skillLevelOf(classroom: number | null, module: number | null): string {
  if (classroom == null && module == null) return "Ab";
  const weakest = Math.min(classroom ?? 100, module ?? 100);
  if (weakest < 50) return "F";
  if (weakest >= 90) return "A+";
  if (weakest >= 80) return "A";
  if (weakest >= 70) return "B";
  if (weakest >= 60) return "C";
  return "D";
}

function componentPointsOf(value: number | null): number {
  if (value == null || value < 50) return 0;
  if (value >= 90) return 10;
  if (value >= 80) return 9;
  if (value >= 70) return 8;
  if (value >= 60) return 7;
  return 6;
}

function passesBound(value: number | null, op?: string, a?: number, b?: number): boolean {
  if ((op !== "gte" && op !== "lte" && op !== "between") || a == null || Number.isNaN(a) || value == null) {
    return true;
  }
  if (op === "gte") return value >= a;
  if (op === "lte") return value <= a;
  if (op === "between" && b != null && !Number.isNaN(b)) {
    return value >= Math.min(a, b) && value <= Math.max(a, b);
  }
  return true;
}

function mean(values: number[]): number | null {
  if (!values.length) return null;
  return round1(values.reduce((sum, value) => sum + value, 0) / values.length);
}

type SpiGrain = "all" | "campus" | "semester" | "section" | "student";

export function aggregateSpiRecord(
  detail: SpiDetailRow[],
  grain: SpiGrain,
  bounds: {
    spiOp?: string;
    spiA?: number;
    spiB?: number;
    attendanceOp?: string;
    attendanceA?: number;
    attendanceB?: number;
    singleCampus: boolean;
  },
): {
  summary: {
    students: number;
    campuses: number;
    avgSpi: number | null;
    attendancePct: number | null;
    levelAPlus: number;
    levelA: number;
    levelB: number;
    levelC: number;
    levelD: number;
    skillDebt: number;
  };
  rows: Array<{
    university: string | null;
    semester: string | null;
    section: string | null;
    studentId: string | null;
    studentName: string | null;
    students: number;
    avgSpi: number | null;
    classroomPoints: number | null;
    modulePoints: number | null;
    sections: number;
    skillLevel: string | null;
    levelAPlus: number;
    levelA: number;
    levelB: number;
    levelC: number;
    levelD: number;
    skillDebt: number;
    attendancePct: number | null;
  }>;
} {
  const campusPct = new Map<string, number | null>();
  const seenCampus = new Set<string>();
  const byStudent = new Map<string, SpiDetailRow[]>();
  for (const row of detail) {
    const list = byStudent.get(row.studentId);
    if (list) list.push(row);
    else byStudent.set(row.studentId, [row]);
    const campusKey = `${row.studentId}\t${row.university}`;
    if (!seenCampus.has(campusKey)) {
      seenCampus.add(campusKey);
      campusPct.set(
        campusKey,
        row.scheduledN > 0 ? round1((row.presentN / row.scheduledN) * 100) : null,
      );
    }
  }

  const people = new Map<string, PersonScore>();
  for (const [studentId, rows] of byStudent) {
    const first = rows[0]!;
    const campusesSeen = new Set<string>();
    let present = 0;
    let scheduled = 0;
    let studentName = "";
    for (const row of rows) {
      if (row.studentName.length > studentName.length) studentName = row.studentName;
      if (campusesSeen.has(row.university)) continue;
      campusesSeen.add(row.university);
      present += row.presentN;
      scheduled += row.scheduledN;
    }
    people.set(studentId, {
      studentId,
      studentName,
      spi: spiPointsOf(first.classroomAvg, first.moduleAvg),
      skill: skillLevelOf(first.classroomAvg, first.moduleAvg),
      classroom: first.classroomAvg,
      module: first.moduleAvg,
      attendance: scheduled > 0 ? round1((present / scheduled) * 100) : null,
    });
  }

  const eligible = new Map<string, PersonScore>();
  for (const person of people.values()) {
    if (!passesBound(person.spi, bounds.spiOp, bounds.spiA, bounds.spiB)) continue;
    if (!passesBound(person.attendance, bounds.attendanceOp, bounds.attendanceA, bounds.attendanceB)) continue;
    eligible.set(person.studentId, person);
  }

  const buckets = new Map<string, {
    university: string | null;
    semester: string | null;
    section: string | null;
    studentId: string | null;
    studentName: string | null;
    ids: Set<string>;
    sections: Set<string>;
    universities: Set<string>;
  }>();

  for (const row of detail) {
    if (!eligible.has(row.studentId)) continue;
    const key = grain === "all"
      ? "all"
      : grain === "campus"
        ? row.university
        : grain === "semester"
          ? `${row.university}\t${row.semester}`
          : grain === "section"
            ? `${row.university}\t${row.section}`
            : `${row.university}\t${row.semester}\t${row.section}\t${row.studentId}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        university: grain === "all" ? null : row.university,
        semester: grain === "semester" || grain === "student" ? row.semester : null,
        section: grain === "section" || grain === "student" ? row.section : null,
        studentId: grain === "student" ? row.studentId : null,
        studentName: grain === "student" ? eligible.get(row.studentId)?.studentName ?? row.studentName : null,
        ids: new Set(),
        sections: new Set(),
        universities: new Set(),
      };
      buckets.set(key, bucket);
    }
    bucket.ids.add(row.studentId);
    bucket.sections.add(row.section);
    bucket.universities.add(row.university);
  }

  const rows = [...buckets.values()].map((bucket) => {
    const members = [...bucket.ids].map((id) => eligible.get(id)!);
    const attendanceValues = members
      .map((person) => bucket.university
        ? campusPct.get(`${person.studentId}\t${bucket.university}`) ?? null
        : person.attendance)
      .filter((value): value is number => value != null);
    const level = (name: string) => members.filter((person) => person.skill === name).length;
    return {
      university: bucket.university,
      semester: bucket.semester,
      section: bucket.section,
      studentId: bucket.studentId,
      studentName: bucket.studentName,
      students: members.length,
      avgSpi: mean(members.map((person) => person.spi)),
      classroomPoints: mean(members.map((person) => componentPointsOf(person.classroom))),
      modulePoints: mean(members.map((person) => componentPointsOf(person.module))),
      sections: bucket.sections.size,
      skillLevel: grain === "student" ? members[0]?.skill ?? null : null,
      levelAPlus: level("A+"),
      levelA: level("A"),
      levelB: level("B"),
      levelC: level("C"),
      levelD: level("D"),
      skillDebt: level("F") + level("Ab"),
      attendancePct: mean(attendanceValues),
    };
  }).sort((a, b) =>
    (a.university ?? "").localeCompare(b.university ?? "")
    || (a.semester ?? "").localeCompare(b.semester ?? "")
    || (a.section ?? "").localeCompare(b.section ?? "")
    || (a.studentName ?? "").localeCompare(b.studentName ?? "")
    || (a.studentId ?? "").localeCompare(b.studentId ?? ""),
  );

  const summaryPeople = [...eligible.values()];
  const summaryAttendance = summaryPeople
    .map((person) => person.attendance)
    .filter((value): value is number => value != null);
  const summary = {
    students: summaryPeople.length,
    campuses: bounds.singleCampus
      ? 1
      : new Set(detail.filter((row) => eligible.has(row.studentId)).map((row) => row.university)).size,
    avgSpi: mean(summaryPeople.map((person) => person.spi)),
    attendancePct: mean(summaryAttendance),
    levelAPlus: summaryPeople.filter((person) => person.skill === "A+").length,
    levelA: summaryPeople.filter((person) => person.skill === "A").length,
    levelB: summaryPeople.filter((person) => person.skill === "B").length,
    levelC: summaryPeople.filter((person) => person.skill === "C").length,
    levelD: summaryPeople.filter((person) => person.skill === "D").length,
    skillDebt: summaryPeople.filter((person) => person.skill === "F" || person.skill === "Ab").length,
  };

  return { summary, rows };
}
