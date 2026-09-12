export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const input = text.replace(/^\uFEFF/, "");

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") {
      field += ch;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ""));
}

function splitList(value?: string): string[] {
  return (value ?? "")
    .split(/[|;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export interface BulkUserCsvRow {
  row: number;
  name: string;
  email: string;
  role: string;
  campuses: string[];
  subjects: string[];
  password?: string;
}

export function parseBulkUsersCsv(text: string): {
  rows: BulkUserCsvRow[];
  error?: string;
} {
  const table = parseCsv(text);
  if (table.length === 0) return { rows: [], error: "CSV is empty" };

  const header = table[0]!.map((cell) => cell.trim().toLowerCase());
  const indexOf = (name: string) => header.indexOf(name);
  const nameIdx = indexOf("name");
  const emailIdx = indexOf("email");
  const roleIdx = indexOf("role");
  if (nameIdx < 0 || emailIdx < 0 || roleIdx < 0) {
    return { rows: [], error: "CSV must include name, email, and role columns" };
  }

  const campusIdx = header.includes("campuses")
    ? indexOf("campuses")
    : indexOf("campus");
  const subjectIdx = header.includes("subjects")
    ? indexOf("subjects")
    : indexOf("subject");
  const passwordIdx = indexOf("password");

  const rows: BulkUserCsvRow[] = [];
  for (let i = 1; i < table.length; i++) {
    const cells = table[i]!;
    rows.push({
      row: i + 1,
      name: (cells[nameIdx] ?? "").trim(),
      email: (cells[emailIdx] ?? "").trim(),
      role: (cells[roleIdx] ?? "").trim(),
      campuses: campusIdx >= 0 ? splitList(cells[campusIdx]) : [],
      subjects: subjectIdx >= 0 ? splitList(cells[subjectIdx]) : [],
      password:
        passwordIdx >= 0
          ? (cells[passwordIdx] ?? "").trim() || undefined
          : undefined,
    });
  }

  return { rows };
}

export function campusInstructorEmail(
  campus: string,
  domain = "nxtwave.co.in",
): string {
  const slug =
    campus
      .toLowerCase()
      .replace(/nxtwave institute of advanced technologies/g, "niat")
      .replace(/deemed(?:[\s-])*to(?:[\s-])*be(?:[\s-])*university/g, "")
      .replace(/\buniversity\b/g, "")
      .replace(/\binstitute\b/g, "")
      .replace(/^niat\s+/g, "")
      .replace(/[^a-z0-9]+/g, "")
      .slice(0, 32) || "campus";
  return `${slug}.instructor@${domain}`;
}

export function exportCsv(
  filename: string,
  headers: string[],
  rows: (string | number)[][]
): void {
  const escape = (value: string | number) => {
    const s = String(value ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers, ...rows]
    .map((row) => row.map(escape).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
