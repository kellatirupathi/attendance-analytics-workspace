import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, pageOf, readPageRequest } from "./pagination.js";

const rows = Array.from({ length: 123 }, (_, index) => index);

test("defaults to page 1 of 50 rows", () => {
  const page = pageOf(rows, readPageRequest({}));
  assert.equal(DEFAULT_PAGE_SIZE, 50);
  assert.deepEqual(page.rows, rows.slice(0, 50));
  assert.equal(page.total, 123);
  assert.equal(page.totalPages, 3);
});

test("returns the requested page and a short last page", () => {
  const page = pageOf(rows, readPageRequest({ page: "3", pageSize: "50" }));
  assert.deepEqual(page.rows, rows.slice(100));
  assert.equal(page.page, 3);
});

test("clamps a page past the end to the last page", () => {
  const page = pageOf(rows, readPageRequest({ page: "99" }));
  assert.equal(page.page, 3);
  assert.equal(page.rows.length, 23);
});

test("ignores bad numbers and caps the page size", () => {
  assert.deepEqual(readPageRequest({ page: "-2", pageSize: "abc" }), { page: 1, pageSize: DEFAULT_PAGE_SIZE, all: false });
  assert.equal(readPageRequest({ pageSize: "100000" }).pageSize, MAX_PAGE_SIZE);
});

test("export=1 returns every row", () => {
  const page = pageOf(rows, readPageRequest({ export: "1", page: "2" }));
  assert.equal(page.rows.length, 123);
  assert.equal(page.totalPages, 1);
});

test("empty input is one empty page", () => {
  const page = pageOf([], readPageRequest({}));
  assert.deepEqual(page, { rows: [], total: 0, page: 1, pageSize: 50, totalPages: 1 });
});
