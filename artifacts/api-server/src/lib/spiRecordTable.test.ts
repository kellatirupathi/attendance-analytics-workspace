import assert from "node:assert/strict";
import { test } from "node:test";
import type { SpiDetailRow } from "./spiRecordAggregate.js";
import { buildSpiRecordTable, sortRecordRows } from "./spiRecordTable.js";

const row = (id: string, name: string, university: string, semester: string, section: string, classroomAvg: number | null, moduleAvg: number | null): SpiDetailRow => ({
  studentId: id, studentName: name, university, semester, section, classroomAvg, moduleAvg, presentN: 1, scheduledN: 1,
});

const detail = [
  row("a-1", "Asha", "Campus A", "Semester 1", "S-1", 80, 60),
  row("a-2", "Bala", "Campus A", "Semester 1", "S-2", 60, null),
  row("b-1", "Chitra", "Campus B", "Semester 3", "S-1", null, null),
  row("a-1", "Asha", "Campus A", "Semester 1", "S-1", 80, 60),
];
const none = { grade: "", search: "" };

test("SPI and grade stay pending until the Final exists", () => {
  const { summary, rows } = buildSpiRecordTable(detail, "student", none);
  assert.equal(summary.students, 3);
  assert.equal(summary.evaluated, 0);
  assert.equal(summary.avgSpi, null);
  assert.ok(rows.every((r) => r.spi === null && r.grade === null && r.sa === null && r.fsa === null));
});

test("campus rows average CQ and MQ over students that have a score", () => {
  const { rows } = buildSpiRecordTable(detail, "campus", none);
  const a = rows.find((r) => r.university === "Campus A")!;
  assert.equal(a.students, 2);
  assert.equal(a.cq, 70);
  assert.equal(a.mq, 60);
  assert.equal(rows.find((r) => r.university === "Campus B")!.cq, null);
});

test("section rows split by semester and section; duplicate detail rows count once", () => {
  assert.equal(buildSpiRecordTable(detail, "section", none).rows.length, 3);
  assert.equal(buildSpiRecordTable(detail, "semester", none).rows.length, 2);
});

test("grade filter: Pending keeps everyone, a real grade keeps nobody yet", () => {
  assert.equal(buildSpiRecordTable(detail, "student", { grade: "Pending", search: "" }).rows.length, 3);
  assert.equal(buildSpiRecordTable(detail, "student", { grade: "A", search: "" }).rows.length, 0);
});

test("search matches name or id without hyphens", () => {
  assert.deepEqual(buildSpiRecordTable(detail, "student", { grade: "", search: "bal" }).rows.map((r) => r.studentName), ["Bala"]);
  assert.deepEqual(buildSpiRecordTable(detail, "student", { grade: "", search: "b1" }).rows.map((r) => r.studentName), ["Chitra"]);
});

test("sorting puts empty values last in both directions", () => {
  const { rows } = buildSpiRecordTable(detail, "student", none);
  assert.equal(sortRecordRows(rows, "cq", -1)[0]!.studentName, "Asha");
  assert.equal(sortRecordRows(rows, "cq", 1)[0]!.studentName, "Bala");
  assert.equal(sortRecordRows(rows, "cq", 1).at(-1)!.studentName, "Chitra");
});
