import assert from "node:assert/strict";
import { test } from "node:test";
import { savedReportEnded, savedReportTracked, savedReportTrackedSql, todayInIndia } from "./reportEnded.js";
import { untrackedKeysSqlList } from "./untrackedReports.js";

test("ended only when the semester end date is before today (India)", () => {
  // Sudheer Medepalli: section moved on 15 Nov 2026, semester ends 23 Jan 2027 → not ended.
  assert.equal(savedReportEnded({ semesterEnd: "2027-01-23" }, "2026-11-15"), false);
  // A semester that ended (e.g. Malla Reddy Semester 3) → ended.
  assert.equal(savedReportEnded({ semesterEnd: "2026-11-07" }, "2026-11-15"), true);
  // The last day itself is still running.
  assert.equal(savedReportEnded({ semesterEnd: "2026-11-15" }, "2026-11-15"), false);
  // A timestamp is read by its date part.
  assert.equal(savedReportEnded({ semesterEnd: "2026-11-14T18:30:00Z" }, "2026-11-15"), true);
});

test("no or unreadable end date keeps the old meaning (ended)", () => {
  assert.equal(savedReportEnded({}, "2026-11-15"), true);
  assert.equal(savedReportEnded({ semesterEnd: null }, "2026-11-15"), true);
  assert.equal(savedReportEnded({ semesterEnd: "23 Jan 2027" }, "2026-11-15"), true);
  assert.equal(savedReportEnded(null, "2026-11-15"), true);
});

test("today is the date in India (UTC+5:30)", () => {
  assert.equal(todayInIndia(new Date("2026-11-14T19:00:00Z")), "2026-11-15");
  assert.equal(todayInIndia(new Date("2026-11-14T18:00:00Z")), "2026-11-14");
});

test("tracked: a saved report counts only when first saved on or before its semester end", () => {
  // NIAT Chevella Year-1 "Semester 1": ended 31 Jul 2026, first saved 10 Nov 2026 (before SPI) → not counted.
  assert.equal(savedReportTracked({ semesterEnd: "2026-07-31" }, "2026-11-10"), false);
  // CDU Semester 3: ended 7 Nov, first saved 2 Nov while it ran → counted.
  assert.equal(savedReportTracked({ semesterEnd: "2026-11-07" }, "2026-11-02"), true);
  // Saved on the last day itself → counted.
  assert.equal(savedReportTracked({ semesterEnd: "2026-11-14" }, "2026-11-14"), true);
  // One day after the end → not counted.
  assert.equal(savedReportTracked({ semesterEnd: "2026-11-14" }, "2026-11-15"), false);
  // A running semester (end in the future) → counted.
  assert.equal(savedReportTracked({ semesterEnd: "2027-03-27" }, "2026-11-16"), true);
  // No end date (old reports) → counted, as before.
  assert.equal(savedReportTracked({}, "2026-11-16"), true);
  assert.equal(savedReportTracked(null, "2026-11-16"), true);
  assert.equal(savedReportTracked({ semesterEnd: "soon" }, "2026-11-16"), true);
  // Timestamps are cut to the date.
  assert.equal(savedReportTracked({ semesterEnd: "2026-11-07T00:00:00Z" }, "2026-11-07T23:59:00"), true);
});

test("tracked SQL compares the India date of first_built_at with the report's end date", () => {
  const sql = savedReportTrackedSql("h");
  assert.match(sql, /h\.first_built_at AT TIME ZONE 'Asia\/Kolkata'/);
  assert.match(sql, /<= LEFT\(h\.report->>'semesterEnd', 10\)::date/);
  assert.match(sql, /ELSE true END/);
});

test("untracked keys become safe BigQuery string literals (tab, quote and backslash escaped)", () => {
  assert.equal(untrackedKeysSqlList([]), "");
  assert.equal(untrackedKeysSqlList(["abc\tSemester 1"]), "'abc\\tSemester 1'");
  assert.equal(untrackedKeysSqlList(["a\tO'Neil \\ 2", "b\tSemester 2"]), "'a\\tO\\'Neil \\\\ 2', 'b\\tSemester 2'");
});
