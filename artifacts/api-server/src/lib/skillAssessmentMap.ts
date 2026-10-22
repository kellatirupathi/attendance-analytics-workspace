import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Skill Assessment course → report course, from config/skill-assessment-course-map.csv
 * (or SKILL_ASSESSMENT_MAP_PATH). Columns: College, Batch, Skill Assessment Course Name,
 * Report Course Name, Status. The Skill Assessment data has no semester_course_id and its
 * course names are the assessment team's own codes (e.g. BACKEND_DEVELOPMENT), so the link
 * is kept by hand until a course id is added. A row with a blank Report Course Name is not
 * mapped yet and its scores stay off the report. Names match ignoring case and extra spaces.
 * The file is re-read when it changes.
 */
const FILE_NAME = "skill-assessment-course-map.csv";

function candidatePaths(): string[] {
  const fromEnv = process.env["SKILL_ASSESSMENT_MAP_PATH"]?.trim();
  if (fromEnv) return [path.resolve(fromEnv)];
  return [
    path.resolve(process.cwd(), "config", FILE_NAME),
    path.resolve(process.cwd(), "artifacts", "api-server", "config", FILE_NAME),
  ];
}

const plain = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const mapKey = (college: string, batch: string, saCourse: string) => [college, batch, saCourse].map(plain).join("|");

/** Splits one CSV line, honouring double-quoted fields. */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { out.push(cell); cell = ""; }
    else cell += ch;
  }
  out.push(cell);
  return out;
}

interface SkillAssessmentMap {
  courses: Map<string, string>;
  /** Changes whenever the file changes; part of cache keys. */
  version: string;
}

const EMPTY: SkillAssessmentMap = { courses: new Map(), version: "none" };
let cached: { key: string; value: SkillAssessmentMap } | null = null;

function load(): SkillAssessmentMap {
  const file = candidatePaths().find((candidate) => existsSync(candidate));
  if (!file) return EMPTY;
  try {
    const mtime = statSync(file).mtimeMs;
    const key = `${file}:${mtime}`;
    if (cached?.key === key) return cached.value;
    const lines = readFileSync(file, "utf8").replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
    const header = parseCsvLine(lines[0] ?? "").map(plain);
    const col = (name: string) => header.indexOf(name);
    const [ci, bi, si, ri] = [col("college"), col("batch"), col("skill assessment course name"), col("report course name")];
    const courses = new Map<string, string>();
    if (ci >= 0 && bi >= 0 && si >= 0 && ri >= 0) {
      for (const line of lines.slice(1)) {
        const cells = parseCsvLine(line);
        const report = (cells[ri] ?? "").trim();
        if (report && cells[ci]?.trim() && cells[si]?.trim()) courses.set(mapKey(cells[ci], cells[bi] ?? "", cells[si]), report);
      }
    } else {
      console.error(`[skillAssessmentMap] ${file} is missing a required column; no Skill Assessments are mapped`);
    }
    const value = { courses, version: `sa-map:${mtime}` };
    cached = { key, value };
    return value;
  } catch (err) {
    console.error(`[skillAssessmentMap] could not read ${file}; keeping the last good map`, err);
    return cached?.value ?? EMPTY;
  }
}

/** The report course a Skill Assessment course belongs to at this college and batch; null when not mapped. */
export function reportCourseFor(college: string, batch: string, saCourse: string): string | null {
  return load().courses.get(mapKey(college, batch, saCourse)) ?? null;
}

export function skillAssessmentMapVersion(): string {
  return load().version;
}
