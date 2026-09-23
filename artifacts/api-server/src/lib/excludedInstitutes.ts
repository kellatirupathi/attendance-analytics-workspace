/** Campuses omitted from every page. Rows stay in BigQuery. */
const EXCLUDED_INSTITUTE_NAMES = ["intensive offline dc"];

export function isExcludedInstitute(name: string | null | undefined): boolean {
  const normalized = (name ?? "").trim().toLowerCase();
  return normalized.length > 0 && EXCLUDED_INSTITUTE_NAMES.includes(normalized);
}

export function omitExcludedInstitutes(names: string[]): string[] {
  return names.filter((name) => !isExcludedInstitute(name));
}

export function excludeInstituteSql(column = "institute_name"): string {
  const list = EXCLUDED_INSTITUTE_NAMES.map(
    (name) => `'${name.replaceAll("'", "''")}'`,
  ).join(", ");
  return `LOWER(TRIM(IFNULL(${column}, ''))) NOT IN (${list})`;
}
