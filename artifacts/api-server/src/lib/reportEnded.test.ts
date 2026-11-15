import assert from "node:assert/strict";
import { test } from "node:test";
import { savedReportEnded, todayInIndia } from "./reportEnded.js";

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
