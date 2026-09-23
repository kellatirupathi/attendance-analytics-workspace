import {
  bqQuery,
  BQ_HEAVY_QUERY_TIMEOUT_MS,
  BQ_LOCATION,
} from "./bigquery.js";
import { excludeInstituteSql } from "./excludedInstitutes.js";

const DATASET =
  "kossip-helpers.niat_instructor_efficacy_ai_analytics_workspace";
const TABLE = `\`${DATASET}.niat_students_overall_attendance_details\``;

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface AttendanceSummaryRow {
  university: string;
  overallAttendancePct: number;
  subject: string;
  attendancePct: number;
  good: number;
  recovery: number;
  atRisk: number;
}

export interface AttendanceSummaryStudent {
  name: string;
  userId: string;
  batch: string;
  section: string;
  attendancePct: number;
}

interface TableShape {
  dateSql: string;
  dateColumnType: string;
  nameSql: string;
  batchSql: string;
  sectionSql: string;
}

let shapePromise: Promise<TableShape> | null = null;

function quoted(name: string): string {
  if (!IDENTIFIER.test(name)) {
    throw new Error(`Unexpected column name: ${name}`);
  }
  return `\`${name}\``;
}

function dateSql(dataType: string): string {
  const type = dataType.toUpperCase();
  if (type === "DATE") return quoted("date");
  if (type === "TIMESTAMP") return `DATE(${quoted("date")}, 'Asia/Kolkata')`;
  if (type === "DATETIME") return `DATE(${quoted("date")})`;
  if (type.startsWith("STRING")) {
    return `SAFE.PARSE_DATE('%Y-%m-%d', SUBSTR(CAST(${quoted("date")} AS STRING), 1, 10))`;
  }
  return `DATE(${quoted("date")})`;
}

function firstColumn(columns: Map<string, string>, names: string[]): string | null {
  for (const name of names) {
    if (columns.has(name)) return name;
  }
  return null;
}

function textAgg(column: string | null): string {
  if (!column) return "CAST(NULL AS STRING)";
  return `MAX(${quoted(column)})`;
}

async function tableShape(): Promise<TableShape> {
  if (!shapePromise) {
    shapePromise = loadTableShape().catch((err) => {
      shapePromise = null;
      throw err;
    });
  }
  return shapePromise;
}

async function loadTableShape(): Promise<TableShape> {
  const rows = await bqQuery<{ column_name: string; data_type: string }>(
    `SELECT column_name, data_type
     FROM \`${DATASET}.INFORMATION_SCHEMA.COLUMNS\`
     WHERE table_name = 'niat_students_overall_attendance_details'`,
  );
  const columns = new Map(
    rows.map((row) => [row.column_name, row.data_type]),
  );
  const dateType = columns.get("date");
  if (!dateType) {
    throw new Error(
      "Attendance summary table has no date column",
    );
  }
  return {
    dateSql: dateSql(dateType),
    dateColumnType: dateType,
    nameSql: textAgg(
      firstColumn(columns, ["student_name", "name", "full_name"]),
    ),
    batchSql: textAgg(
      firstColumn(columns, ["batch", "batch_name", "batch_title"]),
    ),
    sectionSql: textAgg(
      firstColumn(columns, [
        "section",
        "section_name",
        "batch_section_name",
      ]),
    ),
  };
}

function baseWhere(shape: TableShape, fromDate: string | null): string {
  const from = fromDate
    ? `AND ${shape.dateSql} >= DATE(@from_date)`
    : "";
  return `${shape.dateSql} <= DATE(@to_date)
    ${from}
    AND attendance_status IN ('PRESENT', 'ABSENT')
    AND ${excludeInstituteSql()}
    AND (ARRAY_LENGTH(@campuses) = 0 OR institute_name IN UNNEST(@campuses))`;
}

function paramsFor(
  fromDate: string | null,
  toDate: string,
  campuses: string[],
): Record<string, unknown> {
  const params: Record<string, unknown> = {
    to_date: toDate,
    campuses,
  };
  if (fromDate) params["from_date"] = fromDate;
  return params;
}

function round2(value: string | number | null | undefined): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

export async function getAttendanceSummary(opts: {
  fromDate: string | null;
  toDate: string;
  campuses: string[];
}): Promise<{ rows: AttendanceSummaryRow[]; dateColumnType: string }> {
  const shape = await tableShape();
  const rows = await bqQuery<{
    university: string;
    overall_attendance_pct: string;
    subject: string;
    attendance_pct: string;
    good: string;
    recovery: string;
    at_risk: string;
  }>(
    `WITH base AS (
      SELECT
        institute_name,
        student_user_id,
        COALESCE(NULLIF(TRIM(subject_title), ''), 'Unmapped') AS subject_title,
        attendance_status
      FROM ${TABLE}
      WHERE ${baseWhere(shape, opts.fromDate)}
    ),
    overall AS (
      SELECT institute_name,
        ROUND(SAFE_DIVIDE(COUNTIF(attendance_status = 'PRESENT'), COUNT(*)) * 100, 2) AS overall_attendance_pct
      FROM base GROUP BY 1
    ),
    subject_summary AS (
      SELECT institute_name, subject_title,
        ROUND(SAFE_DIVIDE(COUNTIF(attendance_status = 'PRESENT'), COUNT(*)) * 100, 2) AS attendance_pct
      FROM base GROUP BY 1, 2
    ),
    student_subject AS (
      SELECT institute_name, subject_title, student_user_id,
        SAFE_DIVIDE(COUNTIF(attendance_status = 'PRESENT'), COUNT(*)) * 100 AS pct
      FROM base GROUP BY 1, 2, 3
    ),
    bands AS (
      SELECT institute_name, subject_title,
        COUNTIF(pct >= 80) AS good,
        COUNTIF(pct >= 50 AND pct < 80) AS recovery,
        COUNTIF(pct < 50) AS at_risk
      FROM student_subject GROUP BY 1, 2
    )
    SELECT o.institute_name AS university, o.overall_attendance_pct,
           ss.subject_title AS subject, ss.attendance_pct,
           b.good, b.recovery, b.at_risk
    FROM subject_summary ss
    JOIN overall o USING (institute_name)
    JOIN bands b USING (institute_name, subject_title)
    ORDER BY university, ss.attendance_pct DESC, subject`,
    paramsFor(opts.fromDate, opts.toDate, opts.campuses),
    BQ_LOCATION,
    BQ_HEAVY_QUERY_TIMEOUT_MS,
  );
  return {
    dateColumnType: shape.dateColumnType,
    rows: rows.map((row) => ({
      university: row.university,
      overallAttendancePct: round2(row.overall_attendance_pct),
      subject: row.subject,
      attendancePct: round2(row.attendance_pct),
      good: Number(row.good),
      recovery: Number(row.recovery),
      atRisk: Number(row.at_risk),
    })),
  };
}

export async function getAttendanceSummaryCampuses(opts: {
  fromDate: string | null;
  toDate: string;
  campuses: string[];
}): Promise<string[]> {
  const shape = await tableShape();
  const rows = await bqQuery<{ institute_name: string }>(
    `SELECT DISTINCT institute_name
     FROM ${TABLE}
     WHERE ${baseWhere(shape, opts.fromDate)}
       AND institute_name IS NOT NULL
       AND TRIM(institute_name) != ''
     ORDER BY institute_name`,
    paramsFor(opts.fromDate, opts.toDate, opts.campuses),
    BQ_LOCATION,
    BQ_HEAVY_QUERY_TIMEOUT_MS,
  );
  return rows.map((row) => row.institute_name).filter(Boolean);
}

export async function getAttendanceSummaryStudents(opts: {
  fromDate: string | null;
  toDate: string;
  campus: string;
  subject: string;
  band: "good" | "recovery" | "at_risk";
}): Promise<AttendanceSummaryStudent[]> {
  const shape = await tableShape();
  const from = opts.fromDate
    ? `AND ${shape.dateSql} >= DATE(@from_date)`
    : "";
  const band =
    opts.band === "good"
      ? "pct >= 80"
      : opts.band === "recovery"
        ? "pct >= 50 AND pct < 80"
        : "pct < 50";
  const params: Record<string, unknown> = {
    to_date: opts.toDate,
    campus: opts.campus,
    subject: opts.subject,
  };
  if (opts.fromDate) params["from_date"] = opts.fromDate;
  const rows = await bqQuery<{
    student_name: string | null;
    student_user_id: string;
    batch: string | null;
    section: string | null;
    pct: string;
  }>(
    `SELECT
       ${shape.nameSql} AS student_name,
       student_user_id,
       ${shape.batchSql} AS batch,
       ${shape.sectionSql} AS section,
       ROUND(SAFE_DIVIDE(COUNTIF(attendance_status = 'PRESENT'), COUNT(*)) * 100, 2) AS pct
     FROM ${TABLE}
     WHERE ${shape.dateSql} <= DATE(@to_date)
       ${from}
       AND attendance_status IN ('PRESENT', 'ABSENT')
       AND ${excludeInstituteSql()}
       AND institute_name = @campus
       AND COALESCE(NULLIF(TRIM(subject_title), ''), 'Unmapped') = @subject
     GROUP BY student_user_id
     HAVING ${band}
     ORDER BY student_name, student_user_id`,
    params,
    BQ_LOCATION,
    BQ_HEAVY_QUERY_TIMEOUT_MS,
  );
  return rows.map((row) => ({
    name: row.student_name?.trim() || "—",
    userId: row.student_user_id,
    batch: row.batch?.trim() || "—",
    section: row.section?.trim() || "—",
    attendancePct: round2(row.pct),
  }));
}
