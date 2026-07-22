export const roleLabels: Record<string, string> = {
  superadmin: "Super Admin",
  admin: "Admin",
  hod: "HOD",
  capability_manager: "Capability Manager",
  boa: "BOA",
  instructor: "Instructor",
};

export function roleLabel(role: string | undefined | null): string {
  if (!role) return "";
  return roleLabels[role] ?? role;
}
