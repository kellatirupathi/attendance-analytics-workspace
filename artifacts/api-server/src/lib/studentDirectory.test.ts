import assert from "node:assert/strict";
import { test } from "node:test";
import type { SpiDetailRow } from "./spiRecordAggregate.js";
import { buildDirectoryRows, directoryRowsFor, filterDirectory, sortDirectory, sortedDirectoryFor, type DirectoryFilters } from "./studentDirectory.js";

const detail: SpiDetailRow[] = ["Zara 10", "arjun 2", "Arjun 10", "Meena", "Bala 1"].map((name, i) => ({
  studentId: `id-${i}`,
  studentName: name,
  university: i % 2 ? "Campus B" : "Campus A",
  semester: "Semester 1",
  section: `S-${i}`,
  classroomAvg: i === 3 ? null : 50 + i,
  moduleAvg: 60,
  presentN: 10 * i,
  scheduledN: 50,
}));

const noFilters: DirectoryFilters = { search: "", campuses: [], semesters: [], sections: [], tiers: [], spiOp: "", spiA: "", spiB: "", attOp: "", attA: "", attB: "", quiz: "" };

test("cached sort orders match sortDirectory", () => {
  for (const key of ["name", "campus", "classroom", "spi"] as const) {
    for (const dir of [1, -1] as const) {
      const expected = sortDirectory(buildDirectoryRows(detail), key, dir).map((row) => row.key);
      assert.deepEqual(sortedDirectoryFor(detail, key, dir).map((row) => row.key), expected);
    }
  }
});

test("rows and sort orders are built once per detail array", () => {
  assert.equal(directoryRowsFor(detail), directoryRowsFor(detail));
  assert.equal(sortedDirectoryFor(detail, "name", 1), sortedDirectoryFor(detail, "name", 1));
  // A new snapshot (new array) gets its own rows.
  assert.notEqual(directoryRowsFor([...detail]), directoryRowsFor(detail));
});

test("filtering a cached order keeps the order", () => {
  const sorted = sortedDirectoryFor(detail, "name", 1);
  const campusA = filterDirectory(sorted, { ...noFilters, campuses: ["Campus A"] });
  assert.deepEqual(campusA.map((row) => row.key), sorted.filter((row) => row.campus === "Campus A").map((row) => row.key));
});
