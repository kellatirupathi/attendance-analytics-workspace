/** Shared by the student chat (components/QueryChat.tsx) and the team's inbox (pages/Queries.tsx). */

export type QueryStatus = "received" | "in_progress" | "waiting_on_student" | "resolved";

export interface ThreadQuery {
  id: number;
  category: string;
  subCategory: string | null;
  /** The subjects as text ("A, B"); `subjects` is the list. */
  subject: string;
  subjects: string[];
  status: QueryStatus;
  createdAt: string;
  assignedTo?: string | null;
  /** Student side: the team's replies not read yet. */
  unread?: number;
}

export interface ThreadMessage {
  /** Negative = the query's own first message. */
  id: number;
  queryId: number;
  /** system = a line the app adds (a subject was added). */
  author: "student" | "ops" | "system";
  authorName?: string | null;
  /** Key of the problem the student picked, on the message that raised it. */
  problem?: string | null;
  body: string;
  internal?: boolean;
  attachments?: { token: string; name: string | null; size: number }[];
  createdAt: string;
}

export interface Thread {
  queries: ThreadQuery[];
  messages: ThreadMessage[];
}

export const CATEGORY_LABEL: Record<string, string> = {
  attendance: "Attendance",
  classroom_quiz: "Classroom Quiz",
  module_quiz: "Module Quiz",
  skill_assessment: "Skill Assessment",
  final_skill_assessment: "Final Skill Assessment",
};

/** Dot colour per category, so a query is recognisable at a glance in a long conversation. */
export const CATEGORY_DOT: Record<string, string> = {
  attendance: "#2563EB",
  classroom_quiz: "#7C3AED",
  module_quiz: "#E11D48",
  skill_assessment: "#D97706",
  final_skill_assessment: "#0D9488",
};

export const categoryLabel = (c: string) => CATEGORY_LABEL[c] ?? c;

/** Status as the student reads it, and as the team reads it. */
export const STATUS_LABEL: Record<"student" | "staff", Record<QueryStatus, string>> = {
  // Plain words for a student: who is on the move now, not the team's internal state names.
  student: { received: "Waiting for SPI team", in_progress: "SPI team checking", waiting_on_student: "Your reply needed", resolved: "✓ Resolved" },
  staff: { received: "Needs reply", in_progress: "In progress", waiting_on_student: "Waiting on student", resolved: "Resolved" },
};

/** Student side: the one status that needs the student (their turn) is solid blue; the rest are quiet. */
export const STUDENT_STATUS_STYLE: Record<QueryStatus, string> = {
  received: "bg-[#EEF2F8] text-[#475569]",
  in_progress: "bg-[#FFF4DD] text-[#B45309]",
  waiting_on_student: "bg-[#2563EB] text-white",
  resolved: "bg-[#E8F7EE] text-[#15803D]",
};

export const STATUS_STYLE: Record<QueryStatus, string> = {
  received: "bg-[#FDE8EE] text-[#E11D48]",
  in_progress: "bg-[#FFF4DD] text-[#D97706]",
  waiting_on_student: "bg-[#EAF1FF] text-[#2563EB]",
  resolved: "bg-[#E8F7EE] text-[#16A34A]",
};

/** The student as the team reads it: their name, else the start of their ID (reports without a name exist). */
export function studentLabel(name: string | null | undefined, studentId: string): string {
  return name?.trim() || `Student ${studentId.slice(0, 8)}`;
}

/** "Semester 3" stays "Semester 3"; a bare "3" becomes "Semester 3". */
export function semesterLabel(semester: string | null | undefined): string | null {
  const s = semester?.trim();
  if (!s) return null;
  return /^semester\b/i.test(s) ? s : `Semester ${s}`;
}

export function initials(label: string): string {
  return (
    label
      .split(/\s+/)
      .filter((w) => /^\p{L}/u.test(w))
      .map((w) => w[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "S"
  );
}

/** "4 Nov", with the year once it is not this year ("4 Nov 2025"). */
export function shortDate(iso: string): string {
  const d = new Date(iso);
  const thisYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", ...(thisYear ? {} : { year: "numeric" }) });
}

export function timeLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
  return sameDay ? time : `${d.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}, ${time}`;
}

/** "Added A, B" (a system line) as each side reads it. */
export function systemLine(body: string, who: "student" | "staff"): string {
  const rest = body.replace(/^Added /, "");
  return who === "student" ? `You added ${rest}` : `Student added ${rest}`;
}

export const MAX_SHOTS = 6;
/** What a student is told about screenshots, in one place so the form and the chat say the same. */
export const SHOT_RULES = `PNG, JPG or WebP · up to ${MAX_SHOTS} · 2 MB each`;

export function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
const MAX_SHOT_EDGE = 1600;
const MAX_SHOT_BYTES = 2 * 1024 * 1024;

/** Shrinks a screenshot before upload (about 1600 px on the long side, JPEG); this also drops location and device data. */
export async function shrinkImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SHOT_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not read the image.");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  for (const quality of [0.82, 0.65, 0.5]) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (blob && blob.size <= MAX_SHOT_BYTES) return blob;
  }
  throw new Error("That image is too large. Please choose a smaller one.");
}

/** Uploads one shrunk screenshot; the token goes with the message that attaches it. */
export async function uploadShot(studentId: string, blob: Blob, fileName: string): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  try {
    const res = await fetch(`/api/spi-queries/attachments?student=${encodeURIComponent(studentId)}`, {
      method: "POST",
      // The original file name is kept with the image (the browser re-saves the picture, which drops the name).
      headers: { "Content-Type": "image/jpeg", "X-File-Name": encodeURIComponent(fileName) },
      credentials: "include",
      body: blob,
    });
    const data = (await res.json().catch(() => null)) as { token?: string; error?: string } | null;
    if (!res.ok || !data?.token) return { ok: false, error: res.status === 429 ? "Too many tries. Please wait a minute." : (data?.error ?? "Could not add the screenshot.") };
    return { ok: true, token: data.token };
  } catch {
    return { ok: false, error: "Could not reach the server. Please try again." };
  }
}

export const studentImageUrl = (studentId: string, token: string) => `/api/spi-queries/attachments/${token}?student=${encodeURIComponent(studentId)}`;
export const staffImageUrl = (token: string) => `/api/query-inbox/attachments/${token}`;

export async function sendJson(url: string, body: unknown): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(body) });
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    if (!res.ok) return { ok: false, error: res.status === 429 ? "Too many tries. Please wait a minute and try again." : (data?.error ?? "Something went wrong. Please try again.") };
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not reach the server. Please try again." };
  }
}
