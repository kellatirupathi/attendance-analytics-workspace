/** Shared by the student chat (components/QueryChat.tsx) and the team's inbox (pages/Queries.tsx). */

export type QueryStatus = "received" | "in_progress" | "waiting_on_student" | "resolved";

export interface ThreadQuery {
  id: number;
  category: string;
  subCategory: string | null;
  subject: string;
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
  author: "student" | "ops";
  authorName?: string | null;
  body: string;
  internal?: boolean;
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
  student: { received: "Received", in_progress: "In progress", waiting_on_student: "Needs your reply", resolved: "Resolved" },
  staff: { received: "Needs reply", in_progress: "In progress", waiting_on_student: "Waiting on student", resolved: "Resolved" },
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

export function timeLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
  return sameDay ? time : `${d.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}, ${time}`;
}

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
