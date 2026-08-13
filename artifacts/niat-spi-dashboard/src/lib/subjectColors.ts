/**
 * Stable per-subject colours for grouped tables.
 *
 * Assigned by hashing the subject name rather than by row index, so a
 * subject keeps the same colour when the list is filtered, sorted or
 * paginated — and across pages.
 *
 * These are grouping cues only; they never encode attendance. The
 * red/amber/green percentage colours stay the sole status signal, so tints
 * are kept light enough not to compete with them.
 */
export interface SubjectColor {
  /** Left rail / dot — the saturated identity colour. */
  bar: string;
  /** Very light row tint for the subject cell. */
  tint: string;
  /** Readable text colour on the tint. */
  text: string;
}

const PALETTE: SubjectColor[] = [
  { bar: "#6366f1", tint: "#eef2ff", text: "#3730a3" }, // indigo
  { bar: "#0ea5e9", tint: "#e0f2fe", text: "#075985" }, // sky
  { bar: "#14b8a6", tint: "#ccfbf1", text: "#115e59" }, // teal
  { bar: "#8b5cf6", tint: "#f3e8ff", text: "#5b21b6" }, // violet
  { bar: "#ec4899", tint: "#fce7f3", text: "#9d174d" }, // pink
  { bar: "#f59e0b", tint: "#fef3c7", text: "#92400e" }, // amber
  { bar: "#10b981", tint: "#d1fae5", text: "#065f46" }, // emerald
  { bar: "#f97316", tint: "#ffedd5", text: "#9a3412" }, // orange
  { bar: "#06b6d4", tint: "#cffafe", text: "#155e75" }, // cyan
  { bar: "#a855f7", tint: "#f5d0fe", text: "#6b21a8" }, // fuchsia
  { bar: "#3b82f6", tint: "#dbeafe", text: "#1e40af" }, // blue
  { bar: "#84cc16", tint: "#ecfccb", text: "#3f6212" }, // lime
];

/** djb2 — small, stable, and well distributed for short strings. */
function hash(value: string): number {
  let h = 5381;
  for (let i = 0; i < value.length; i++) {
    h = ((h << 5) + h + value.charCodeAt(i)) >>> 0;
  }
  return h;
}

export function subjectColor(subject: string): SubjectColor {
  const key = subject.trim().toLowerCase();
  return PALETTE[hash(key) % PALETTE.length]!;
}
