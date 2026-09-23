/** Keep in sync with the API exclusion list. */
const EXCLUDED_INSTITUTE_NAMES = ["intensive offline dc"];

export function isExcludedInstitute(name: string | null | undefined): boolean {
  const normalized = (name ?? "").trim().toLowerCase();
  return normalized.length > 0 && EXCLUDED_INSTITUTE_NAMES.includes(normalized);
}

export function omitExcludedInstitutes(names: string[]): string[] {
  return names.filter((name) => !isExcludedInstitute(name));
}
