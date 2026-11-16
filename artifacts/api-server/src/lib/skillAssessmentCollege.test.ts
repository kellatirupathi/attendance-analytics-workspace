import assert from "node:assert/strict";
import { test } from "node:test";
import { collegeHasSkillAssessments, skillAssessmentMapFrom } from "./skillAssessmentMap.js";

const row = (college: string, status = "Mapped", semester: string | null = "Semester 3", report: string | null = "Back End Development") => ({
  college,
  batch: "Batch -1",
  semester,
  skillAssessmentCourseName: "BACKEND_DEVELOPMENT",
  reportCourseName: report,
  status,
});

test("a college takes Skill Assessments when it has any mapped course; names match ignoring case and spaces", () => {
  const map = skillAssessmentMapFrom([row("Chaitanya Deemed-to-be University"), row("Takshasila University", "To confirm"), row("NRI", "Mapped", null), row("AMET", "Mapped", "Semester 3", null)]).value;
  assert.equal(collegeHasSkillAssessments(map, "Chaitanya Deemed-to-be University"), true);
  assert.equal(collegeHasSkillAssessments(map, "  chaitanya   deemed-to-be university "), true);
  // Only "To confirm", no semester, or no report course: not used, so the college does not count.
  assert.equal(collegeHasSkillAssessments(map, "Takshasila University"), false);
  assert.equal(collegeHasSkillAssessments(map, "NRI"), false);
  assert.equal(collegeHasSkillAssessments(map, "AMET"), false);
  // A college whose name only starts the same way is a different college.
  assert.equal(collegeHasSkillAssessments(map, "Chaitanya"), false);
  assert.equal(collegeHasSkillAssessments(map, ""), false);
  assert.equal(collegeHasSkillAssessments(new Map(), "Chaitanya Deemed-to-be University"), false);
});
