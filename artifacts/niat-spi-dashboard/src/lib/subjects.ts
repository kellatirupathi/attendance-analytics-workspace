/**
 * Courses that are not academic subjects (orientation, events and similar).
 * They stay in the data but are left out of the Subject filter options.
 * Compare in lower case; add names here only.
 */
export const NON_ACADEMIC_SUBJECTS: string[] = [];

const NON_ACADEMIC = new Set(NON_ACADEMIC_SUBJECTS.map((name) => name.trim().toLowerCase()));

/** A named, academic subject: not blank, not the text "null", not on the list above. */
export function isAcademicSubject(name: string | null | undefined): boolean {
  const trimmed = (name ?? "").trim();
  if (!trimmed || trimmed.toLowerCase() === "null") return false;
  return !NON_ACADEMIC.has(trimmed.toLowerCase());
}

/** Sorted, de-duplicated academic subject names. */
export function subjectOptionList(names: Iterable<string | null | undefined>): string[] {
  const seen = new Set<string>();
  for (const name of names) {
    if (isAcademicSubject(name)) seen.add(name!.trim());
  }
  return [...seen].sort((left, right) => left.localeCompare(right));
}

/** Reads the `subjects` URL list (values joined with ||). */
export function readSubjects(params: URLSearchParams): string[] {
  const raw = params.get("subjects");
  return raw ? [...new Set(raw.split("||").map((item) => item.trim()).filter(Boolean))] : [];
}
