import assert from "node:assert/strict";
import { test } from "node:test";
import { readSemesterParam, reportSemesterMenu, reportSemesterTitle, sortReportSemesters, type ReportSemester } from "./reportSemesters.js";

const s3: ReportSemester = { semester: "Semester 3", start: "2026-06-11", end: "2026-11-07", ended: true };
const s4: ReportSemester = { semester: "Semester 4", start: "2026-11-16", end: "2027-03-27", ended: false };

test("semesters newest first by start date; Semester 10 after Semester 9 when dates are missing", () => {
  assert.deepEqual(sortReportSemesters([s3, s4]).map((s) => s.semester), ["Semester 4", "Semester 3"]);
  const noDates = [9, 10, 2].map((n) => ({ semester: `Semester ${n}`, start: null, end: null, ended: true }));
  assert.deepEqual(sortReportSemesters(noDates).map((s) => s.semester), ["Semester 10", "Semester 9", "Semester 2"]);
  assert.deepEqual(sortReportSemesters([]), []);
});

test("semester link parameter: trimmed, at most 60 characters, nothing for empty or non-text", () => {
  assert.equal(readSemesterParam(" Semester 3 "), "Semester 3");
  assert.equal(readSemesterParam(""), undefined);
  assert.equal(readSemesterParam(undefined), undefined);
  assert.equal(readSemesterParam(["Semester 3"]), undefined);
  assert.equal(readSemesterParam("x".repeat(100))!.length, 60);
});

test("report title: a saved report's semester, else the live report's semesterTitle", () => {
  assert.equal(reportSemesterTitle({ semester: "Semester 3", semesterTitle: "Semester 4" }), "Semester 3");
  assert.equal(reportSemesterTitle({ semesterTitle: " Semester 4 " }), "Semester 4");
  assert.equal(reportSemesterTitle({ semester: "  " , semesterTitle: "Semester 4" }), "Semester 4");
  assert.equal(reportSemesterTitle({}), "");
});

test("menu: saved semesters; the semester on screen is added when it is not saved yet", () => {
  // CDU: Semester 3 ended and Semester 4 both saved → both, newest first.
  assert.deepEqual(reportSemesterMenu([s3, s4], { semesterTitle: "Semester 4" }, false).map((s) => s.semester), ["Semester 4", "Semester 3"]);
  // A report built live, not saved yet → added with its dates.
  const menu = reportSemesterMenu([s3], { semesterTitle: "Semester 4", semesterStart: "2026-11-16T00:00:00Z", semesterEnd: "2027-03-27" }, false);
  assert.deepEqual(menu[0], { semester: "Semester 4", start: "2026-11-16", end: "2027-03-27", ended: false });
  assert.equal(menu.length, 2);
  // One semester only (most students) → one entry: the page shows no menu.
  assert.equal(reportSemesterMenu([s4], { semesterTitle: "Semester 4" }, false).length, 1);
  // A report with no semester title → the saved list as it is.
  assert.deepEqual(reportSemesterMenu([s3], {}, false), [s3]);
  // Nothing saved and no title → empty.
  assert.deepEqual(reportSemesterMenu([], {}, false), []);
});

test("menu leaves out a saved semester that has not ended and is not the current one (a stale copy)", () => {
  // Yenapoya: once reported on Semester 3 by mistake (not ended), now Semester 1 → only Semester 1.
  const wrong: ReportSemester = { semester: "Semester 3", start: "2026-08-01", end: "2026-12-04", ended: false };
  const right: ReportSemester = { semester: "Semester 1", start: "2026-08-04", end: "2026-12-04", ended: false };
  assert.deepEqual(reportSemesterMenu([wrong, right], { semesterTitle: "Semester 1" }, false).map((s) => s.semester), ["Semester 1"]);
  // The current one is kept even when it has not ended; ended ones are always kept.
  assert.deepEqual(reportSemesterMenu([s3, s4, wrong], { semesterTitle: "Semester 4" }, false).map((s) => s.semester), ["Semester 4", "Semester 3"]);
  // A student whose current report is itself ended (batch between semesters) keeps it.
  assert.deepEqual(reportSemesterMenu([s3], { semester: "Semester 3", semesterStatus: "ended" }, true).map((s) => s.semester), ["Semester 3"]);
});
