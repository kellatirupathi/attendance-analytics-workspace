import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Campuses omitted from every page. Rows stay in BigQuery.
 * Read from config/excluded-colleges.json ({ excludedColleges: [{ name }] }), or
 * EXCLUDED_COLLEGES_PATH. The file is re-read when it changes; "intensive offline dc" is always excluded.
 */
const FILE_NAME = "excluded-colleges.json";
const ALWAYS_EXCLUDED = ["intensive offline dc"];

function candidatePaths(): string[] {
  const fromEnv = process.env["EXCLUDED_COLLEGES_PATH"]?.trim();
  if (fromEnv) return [path.resolve(fromEnv)];
  return [
    path.resolve(process.cwd(), "config", FILE_NAME),
    path.resolve(process.cwd(), "artifacts", "api-server", "config", FILE_NAME),
  ];
}

let cached: { key: string; names: string[] } | null = null;

function excludedNames(): string[] {
  const file = candidatePaths().find((candidate) => existsSync(candidate));
  if (!file) return ALWAYS_EXCLUDED;
  try {
    const key = `${file}:${statSync(file).mtimeMs}`;
    if (cached?.key === key) return cached.names;
    const json = JSON.parse(readFileSync(file, "utf8")) as { excludedColleges?: unknown[] };
    const names = new Set(ALWAYS_EXCLUDED);
    for (const entry of json.excludedColleges ?? []) {
      const name = typeof entry === "string" ? entry : (entry as { name?: unknown } | null)?.name;
      if (typeof name === "string" && name.trim()) names.add(name.trim().toLowerCase());
    }
    cached = { key, names: [...names] };
    return cached.names;
  } catch (err) {
    console.error(`[excludedInstitutes] could not read ${file}; keeping the last good list`, err);
    return cached?.names ?? ALWAYS_EXCLUDED;
  }
}

export function isExcludedInstitute(name: string | null | undefined): boolean {
  const normalized = (name ?? "").trim().toLowerCase();
  return normalized.length > 0 && excludedNames().includes(normalized);
}

export function omitExcludedInstitutes(names: string[]): string[] {
  return names.filter((name) => !isExcludedInstitute(name));
}

export function excludeInstituteSql(column = "institute_name"): string {
  const list = excludedNames()
    .map((name) => `'${name.replaceAll("'", "''")}'`)
    .join(", ");
  return `LOWER(TRIM(IFNULL(${column}, ''))) NOT IN (${list})`;
}
