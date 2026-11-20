/**
 * Which rows of the Skill Assessment data (SKILL_ASSESSMENT_TABLE) count as Skill Assessments: the one rule for the
 * student report, Assessments, the report sync's course map counts and the held rounds.
 *
 * - assessment_type = "Skill Assessment" (the column also has "Final Skill Assessment", which is not a Skill Assessment);
 * - assessment_variant is not MOCK (practice). A blank variant still counts, so a real assessment the data forgot
 *   to mark MAIN is not lost.
 * Rows with no assessment_type (old, untagged rows) never count. Matching ignores case and spaces at the ends.
 */
export function skillAssessmentSql(alias = ""): string {
  const col = (name: string) => (alias ? `${alias}.${name}` : name);
  return `(LOWER(TRIM(IFNULL(${col("assessment_type")}, ''))) = 'skill assessment'
       AND UPPER(TRIM(IFNULL(${col("assessment_variant")}, ''))) != 'MOCK')`;
}
