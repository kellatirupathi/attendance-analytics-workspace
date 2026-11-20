import assert from "node:assert/strict";
import { test } from "node:test";
import { skillAssessmentSql } from "./skillAssessmentType.js";

test("Skill Assessment rule: type 'Skill Assessment' and variant not MOCK, with or without a table alias", () => {
  const plain = skillAssessmentSql();
  assert.match(plain, /LOWER\(TRIM\(IFNULL\(assessment_type, ''\)\)\) = 'skill assessment'/);
  assert.match(plain, /UPPER\(TRIM\(IFNULL\(assessment_variant, ''\)\)\) != 'MOCK'/);
  assert.doesNotMatch(plain, /'MAIN'/);
  const aliased = skillAssessmentSql("sa");
  assert.match(aliased, /IFNULL\(sa\.assessment_type, ''\)/);
  assert.match(aliased, /IFNULL\(sa\.assessment_variant, ''\)/);
  // Wrapped in brackets so it is safe next to OR in a WHERE clause.
  assert.ok(plain.trim().startsWith("(") && plain.trim().endsWith(")"));
});
