export type Role =
  | "superadmin"
  | "admin"
  | "hod"
  | "capability_manager"
  | "boa"
  | "instructor";

export interface SessionScope {
  campuses?: string[];
  subjects?: string[];
}

export const REQUIRED_PCT = 80;

export const ROLE_META: Record<
  Role,
  { label: string; description: string }
> = {
  superadmin: {
    label: "Super Admin",
    description: "Full system access including BigQuery explorer and all admin operations",
  },
  admin: {
    label: "Admin",
    description: "Manage users and campuses; view all data across all campuses",
  },
  hod: {
    label: "HOD",
    description: "Head of Department; view all data across all campuses",
  },
  capability_manager: {
    label: "Capability Manager",
    description: "View data scoped to assigned campuses and subjects",
  },
  boa: {
    label: "BOA",
    description: "Branch of Academic; view data scoped to assigned campuses",
  },
  instructor: {
    label: "Instructor",
    description: "View data scoped to assigned campuses and subjects",
  },
};

export function canManage(role: Role): boolean {
  return role === "superadmin" || role === "admin";
}

export function manageableRoles(role: Role): Role[] {
  if (role === "superadmin")
    return ["admin", "hod", "capability_manager", "boa", "instructor"];
  if (role === "admin") return ["hod", "capability_manager", "boa", "instructor"];
  return [];
}

export function scopeForSession(session: {
  role: Role;
  campuses: string[];
  subjects: string[];
}): SessionScope {
  if (
    session.role === "superadmin" ||
    session.role === "admin" ||
    session.role === "hod"
  ) {
    return {};
  }
  if (session.role === "boa") {
    return { campuses: session.campuses };
  }
  if (session.role === "capability_manager" || session.role === "instructor") {
    return { campuses: session.campuses, subjects: session.subjects };
  }
  return { campuses: ["__none__"] };
}

export const SUBJECTS = [
  "Back End Development",
  "Web Application Development -2",
  "Data Structures",
  "DataBase Management System",
  "Design and Analysis of Algorithms",
  "Probability and Statistics",
  "CALCULUS",
  "Logical Reasoning and Analytical Skills",
  "Advanced Communication Skills",
  "Communicative English Foundation",
  "Communicative English Advanced",
  "AI For Finance",
];
