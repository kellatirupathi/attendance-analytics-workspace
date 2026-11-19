import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildMappingRows,
  needsAction,
  parseMappingInput,
  pickReportCourse,
  planMappingChange,
  reportCourseIndex,
  toConfirmCount,
  type MapTableRow,
  type ReportCourseRow,
} from "./saCourseMapAdminModel.js";

const map = (over: Partial<MapTableRow>): MapTableRow => ({
  college: "Noida International University", batch: "Noida Batch -1", semester: "Semester 3", saCourse: "PROBABILITY_AND_STATISTICS",
  reportCourse: null, status: "To confirm", mainSaCount: 1, students: 320, lastSaDate: "2026-11-13", ...over,
});
const rep = (over: Partial<ReportCourseRow>): ReportCourseRow => ({
  college: "Noida International University", batch: "Noida Batch -1", semester: "Semester 3", course: "Probability and Statistics", current: true, ...over,
});
const none = () => false;

test("options come from that college, batch and semester's reports, matched ignoring case and spaces", () => {
  const rows = buildMappingRows(
    [map({ college: "  noida international  university ", batch: "NOIDA BATCH -1" })],
    [rep({}), rep({ course: "Back End Development" }), rep({ course: "probability  and statistics" }), rep({ semester: "Semester 1", course: "English" })],
    none,
  );
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0]!.options, ["Back End Development", "Probability and Statistics"]);
  assert.equal(rows[0]!.current, true);
});

test("an ended semester (history only) is not current and does not count as pending", () => {
  const rows = buildMappingRows([map({ semester: "Semester 2" })], [rep({ semester: "Semester 2", current: false })], none);
  assert.equal(rows[0]!.current, false);
  assert.equal(rows[0]!.options.length, 1);
  assert.equal(toConfirmCount(rows), 0);
});

test("rows with no semester and excluded colleges are left out; blank status reads as To confirm", () => {
  const rows = buildMappingRows(
    [map({ semester: null }), map({ semester: "  " }), map({ college: "Training Institute" }), map({ saCourse: "X", status: null })],
    [rep({})],
    (c) => c === "Training Institute",
  );
  assert.deepEqual(rows.map((r) => r.saCourse), ["X"]);
  assert.equal(rows[0]!.status, "To confirm");
});

test("pending = To confirm on a live report; Mapped and 'No course name' rows are not pending", () => {
  const rows = buildMappingRows(
    [
      map({}),
      map({ saCourse: "GENERATIVE_AI", status: "Mapped", reportCourse: "GEN AI" }),
      map({ saCourse: "(no course name) Semester 3", status: "No course name in SA table" }),
      map({ batch: "Other Batch", saCourse: "Y" }),
    ],
    [rep({})],
    none,
  );
  assert.equal(toConfirmCount(rows), 1);
  // Pending first.
  assert.equal(rows[0]!.saCourse, "PROBABILITY_AND_STATISTICS");
  assert.equal(rows.find((r) => r.saCourse.startsWith("(no course"))!.editable, false);
  // A batch with no report at all: listed, no options, not pending.
  const other = rows.find((r) => r.batch === "Other Batch")!;
  assert.deepEqual(other.options, []);
  assert.equal(needsAction(other), false);
});

test("pickReportCourse returns the reports' spelling or null", () => {
  const options = ["Web Application Development - 1", "GEN AI"];
  assert.equal(pickReportCourse(options, " gen   ai "), "GEN AI");
  assert.equal(pickReportCourse(options, "Generative AI"), null);
  assert.equal(pickReportCourse(options, ""), null);
  assert.equal(pickReportCourse(options, null), null);
});

test("planMappingChange: map, clear, refuse unknown course, refuse non-editable, missing row", () => {
  const [row] = buildMappingRows([map({})], [rep({})], none);
  assert.deepEqual(planMappingChange(row, "probability and statistics"), { ok: true, reportCourse: "Probability and Statistics", status: "Mapped" });
  assert.deepEqual(planMappingChange(row, null), { ok: true, reportCourse: null, status: "To confirm" });
  assert.deepEqual(planMappingChange(row, "   "), { ok: true, reportCourse: null, status: "To confirm" });
  const bad = planMappingChange(row, "Maths for CSE");
  assert.equal(bad.ok, false);
  assert.equal(!bad.ok && bad.code, 400);
  const [locked] = buildMappingRows([map({ status: "No course name in SA table" })], [rep({})], none);
  const refused = planMappingChange(locked, "Probability and Statistics");
  assert.equal(!refused.ok && refused.code, 409);
  const missing = planMappingChange(undefined, "Probability and Statistics");
  assert.equal(!missing.ok && missing.code, 404);
});

test("a row whose semester has no reports cannot be mapped (no choices)", () => {
  const [row] = buildMappingRows([map({ semester: "Semester 9" })], [rep({})], none);
  const r = planMappingChange(row, "Probability and Statistics");
  assert.equal(!r.ok && r.code, 400);
});

test("parseMappingInput: required fields, trimming, null / absent report course = clear, wrong types refused", () => {
  assert.deepEqual(parseMappingInput({ college: " A ", batch: "B", saCourse: "C", reportCourse: "X" }), { ok: true, value: { college: "A", batch: "B", saCourse: "C", reportCourse: "X" } });
  assert.deepEqual(parseMappingInput({ college: "A", batch: "B", saCourse: "C" }), { ok: true, value: { college: "A", batch: "B", saCourse: "C", reportCourse: null } });
  assert.equal(parseMappingInput({ college: "A", batch: "B", saCourse: "C", reportCourse: null }).ok, true);
  for (const bad of [null, undefined, "x", [], {}, { college: "A", batch: "B" }, { college: "  ", batch: "B", saCourse: "C" }, { college: 1, batch: "B", saCourse: "C" }]) {
    assert.equal(parseMappingInput(bad).ok, false, JSON.stringify(bad));
  }
  assert.equal(parseMappingInput({ college: "A", batch: "B", saCourse: "C", reportCourse: 5 }).ok, false);
  assert.equal(parseMappingInput({ college: "A", batch: "B", saCourse: "C", reportCourse: { x: 1 } }).ok, false);
});

test("the badge count (placeholder course per live semester) equals the page count", () => {
  const maps = [
    map({}),
    map({ saCourse: "A", status: "Mapped", reportCourse: "Probability and Statistics" }),
    map({ batch: "Noida Batch -2", semester: "Semester 1", saCourse: "B" }),
    map({ semester: "Semester 2", saCourse: "C" }),
    map({ college: "Excluded", saCourse: "D" }),
  ];
  const full = [rep({}), rep({ batch: "Noida Batch -2", semester: "Semester 1", course: "English" }), rep({ semester: "Semester 2", current: false })];
  const placeholder = [rep({ course: "-" }), rep({ batch: "Noida Batch -2", semester: "Semester 1", course: "-" })];
  const excluded = (c: string) => c === "Excluded";
  assert.equal(toConfirmCount(buildMappingRows(maps, full, excluded)), 2);
  assert.equal(toConfirmCount(buildMappingRows(maps, placeholder, excluded)), 2);
});

test("two SA spellings can point at the same report course; a Mapped row can be cleared and re-mapped", () => {
  const rows = buildMappingRows(
    [map({ saCourse: "PROPABILITY_AND_STATISTICS", status: "Mapped", reportCourse: "Probability and Statistics" }), map({})],
    [rep({})],
    none,
  );
  for (const r of rows) assert.deepEqual(planMappingChange(r, "Probability and Statistics"), { ok: true, reportCourse: "Probability and Statistics", status: "Mapped" });
  const mapped = rows.find((r) => r.status === "Mapped")!;
  assert.deepEqual(planMappingChange(mapped, null), { ok: true, reportCourse: null, status: "To confirm" });
});

test("a Mapped row whose saved course is no longer on the report: listed, still editable, only report courses accepted", () => {
  const [row] = buildMappingRows([map({ status: "Mapped", reportCourse: "Old Name" })], [rep({})], none);
  assert.equal(row!.reportCourse, "Old Name");
  assert.equal(row!.editable, true);
  assert.equal(planMappingChange(row, "Old Name").ok, false);
  assert.equal(planMappingChange(row, "Probability and Statistics").ok, true);
});

test("status text is matched ignoring case and spaces", () => {
  const rows = buildMappingRows([map({ status: "  to CONFIRM " }), map({ saCourse: "M", status: "MAPPED", reportCourse: "Probability and Statistics" })], [rep({})], none);
  assert.equal(toConfirmCount(rows), 1);
  assert.ok(rows.every((r) => r.editable));
});

test("empty inputs: no map rows or no reports", () => {
  assert.deepEqual(buildMappingRows([], [rep({})], none), []);
  const rows = buildMappingRows([map({})], [], none);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.current, false);
  assert.equal(toConfirmCount(rows), 0);
});

test("reportCourseIndex: a semester is current when any live report has it; first spelling wins", () => {
  const idx = reportCourseIndex([rep({ current: false, course: "English" }), rep({ current: true, course: "ENGLISH" }), rep({ course: "  " })]);
  const e = idx.get("noida international university|noida batch -1|semester 3")!;
  assert.equal(e.current, true);
  assert.deepEqual(e.options, ["English"]);
});
