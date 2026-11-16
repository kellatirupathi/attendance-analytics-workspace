import assert from "node:assert/strict";
import { test } from "node:test";
import { pastKeysFor, pastSemesterOptions, readTerm, type PastPlace } from "./pastSemesterModel.js";
import { pastPlaceKeys, pastSemesterSql } from "./pastSemesterSql.js";

const place = (over: Partial<PastPlace>): PastPlace => ({ studentKey: "a1", college: "CDU", batch: "CDU Batch -1", semester: "Semester 3", section: "S-001", ...over });

const places: PastPlace[] = [
  place({ studentKey: "a1" }),
  place({ studentKey: "a2" }),
  place({ studentKey: "b1", college: "AMET", batch: "AMET Batch -1" }),
  place({ studentKey: "c1", college: "Chevella", batch: "Chevella Batch -1", semester: "Semester 1" }),
  // The same student in two ended semesters counts once in each.
  place({ studentKey: "a1", semester: "Semester 1" }),
];

test("readTerm: empty and the old running / ended values mean the current semester; a title is kept; long values cut", () => {
  assert.equal(readTerm(undefined), undefined);
  assert.equal(readTerm(""), undefined);
  assert.equal(readTerm("   "), undefined);
  assert.equal(readTerm("running"), undefined);
  assert.equal(readTerm("ended"), undefined);
  assert.equal(readTerm(" Semester 3 "), "Semester 3");
  assert.equal(readTerm(["Semester 3"]), undefined); // a repeated param is not a title
  assert.equal(readTerm("x".repeat(200))!.length, 60);
});

test("options: one per semester and college with distinct students, newest semester first, within the user's colleges", () => {
  assert.deepEqual(pastSemesterOptions(places), [
    { semester: "Semester 3", college: "AMET", students: 1 },
    { semester: "Semester 3", college: "CDU", students: 2 },
    { semester: "Semester 1", college: "CDU", students: 1 },
    { semester: "Semester 1", college: "Chevella", students: 1 },
  ]);
  assert.deepEqual(pastSemesterOptions(places, ["AMET"]), [{ semester: "Semester 3", college: "AMET", students: 1 }]);
  assert.deepEqual(pastSemesterOptions(places, ["Nowhere"]), []);
  assert.deepEqual(pastSemesterOptions([]), []);
  // Numeric order: Semester 10 after Semester 9.
  const order = pastSemesterOptions([place({ semester: "Semester 9" }), place({ semester: "Semester 10" })]).map((o) => o.semester);
  assert.deepEqual(order, ["Semester 10", "Semester 9"]);
});

test("keys: student and college of one ended semester, within the user's colleges", () => {
  assert.deepEqual(pastKeysFor(places, "Semester 3"), ["a1\tCDU", "a2\tCDU", "b1\tAMET"]);
  assert.deepEqual(pastKeysFor(places, "Semester 3", ["CDU"]), ["a1\tCDU", "a2\tCDU"]);
  assert.deepEqual(pastKeysFor(places, "Semester 7"), []);
});

test("BigQuery condition: one parameter of student \\t college \\t semester; nothing from the request in the SQL", () => {
  assert.deepEqual(pastPlaceKeys(places, { semester: "Semester 1" }), ["a1\tCDU\tSemester 1", "c1\tChevella\tSemester 1"]);
  assert.equal(pastPlaceKeys(places).length, 5);
  const sql = pastSemesterSql(places, { semester: "Semester 3'; DROP TABLE x; --" });
  assert.equal(sql, null, "an unknown semester reads nothing");
  const q = pastSemesterSql(places, { semester: "Semester 3", alias: "q", studentColumn: "user_id", param: "p" })!;
  assert.match(q.where, /SAFE_CAST\(q\.is_current_semester AS INT64\) = 0/);
  assert.match(q.where, /q\.user_id/);
  assert.match(q.where, /IN UNNEST\(@p\)/);
  assert.ok(!q.where.includes("Semester 3"), "the semester goes in the parameter, not the SQL");
  assert.deepEqual(q.params, { p: ["a1\tCDU\tSemester 3", "a2\tCDU\tSemester 3", "b1\tAMET\tSemester 3"] });
  const all = pastSemesterSql(places)!;
  assert.match(all.where, /a?student_user_id/);
  assert.equal(all.params["pastPlaces"]!.length, 5);
  assert.equal(pastSemesterSql([], {}), null);
});
