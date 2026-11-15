import assert from "node:assert/strict";
import { test } from "node:test";
import { trendOf, weekOf, type TrendRow } from "./overviewTrendModel.js";

const row = (over: Partial<TrendRow>): TrendRow => ({
  date: "2026-11-10", college: "Alpha", batch: "B1", section: "S-001", semester: "Semester 1", subject: "Maths", ended: false, present: 8, scheduled: 10, ...over,
});

test("weeks start on Monday (as BigQuery WEEK(MONDAY))", () => {
  assert.equal(weekOf("2026-11-09"), "2026-11-09"); // Monday
  assert.equal(weekOf("2026-11-15"), "2026-11-09"); // Sunday
  assert.equal(weekOf("2026-11-16"), "2026-11-16");
  assert.equal(weekOf("2026-01-01"), "2025-12-29"); // across a year
});

test("days add up into weeks, oldest first; weeks with nothing held are left out", () => {
  const pts = trendOf([row({ date: "2026-11-10" }), row({ date: "2026-11-12", present: 2, scheduled: 4 }), row({ date: "2026-11-03", present: 1, scheduled: 2 }), row({ date: "2026-10-27", present: 0, scheduled: 0 })], {});
  assert.deepEqual(pts, [{ week: "2026-11-02", present: 1, scheduled: 2 }, { week: "2026-11-09", present: 10, scheduled: 14 }]);
});

test("filters mean what they mean on the Student Directory", () => {
  const rows = [
    row({ college: "Alpha", batch: "B1", section: "S-001", subject: "Maths" }),
    row({ college: "Alpha", batch: "B2", section: "S-001", subject: "Python", ended: true }),
    row({ college: "Beta", batch: "B1", section: "S-002", subject: "Maths", semester: "Semester 3" }),
  ];
  const total = (f: Parameters<typeof trendOf>[1]) => trendOf(rows, f).reduce((n, p) => n + p.scheduled, 0);
  assert.equal(total({}), 30);
  assert.equal(total({ colleges: ["Alpha"] }), 20);
  assert.equal(total({ scopeCampuses: ["Beta"] }), 10);
  assert.equal(total({ batches: ["Alpha\tB2"] }), 10);
  assert.equal(total({ term: "running" }), 20);
  assert.equal(total({ term: "ended" }), 10);
  assert.equal(total({ semester: "Semester 3" }), 10);
  assert.equal(total({ sections: ["B1\tS-001"] }), 10); // a section of one batch, not the same name in batch B2
  assert.equal(total({ subject: "  maths " }), 20); // case and spaces ignored, as the report
  assert.equal(total({ scopeSubjects: ["Python"] }), 10);
  assert.equal(total({ scopeSubjects: ["Python"], subject: "Maths" }), 0); // a subject outside the user's scope gives nothing
});

test("the period keeps only days inside it (both ends included)", () => {
  const rows = [row({ date: "2026-11-01" }), row({ date: "2026-11-08" }), row({ date: "2026-11-15" })];
  const pts = trendOf(rows, { dateFrom: "2026-11-08", dateTo: "2026-11-15" });
  assert.equal(pts.reduce((n, p) => n + p.scheduled, 0), 20);
});
