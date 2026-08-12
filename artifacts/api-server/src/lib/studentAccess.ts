import type { Request } from "express";
import { getSessionFromRequest } from "./auth.js";
import { verifySpiToken } from "./spiToken.js";
import { scopeForSession, type Role } from "./rbac.js";
import { getStudentOverview } from "./queries.js";

/** Returns true when the caller may access this student's SPI data. */
export async function assertStudentAccess(
  req: Request,
  studentId: string,
): Promise<boolean> {
  const session = getSessionFromRequest(req);
  if (session) {
    const scope = scopeForSession({
      role: session.role as Role,
      campuses: session.campuses,
      subjects: session.subjects,
    });
    if (scope.campuses?.[0] === "__none__") return false;
    if (
      session.role === "superadmin" ||
      session.role === "admin" ||
      session.role === "hod"
    ) {
      return true;
    }
    try {
      const overview = await getStudentOverview(studentId);
      if (!overview) return false;
      if (scope.campuses && scope.campuses.length > 0) {
        // A student with no institute cannot match a campus-scoped session,
        // so fail closed rather than treating null as unrestricted.
        const campus = overview.instituteName;
        if (!campus || !scope.campuses.includes(campus)) return false;
      }
      return true;
    } catch {
      return false;
    }
  }
  const token = (req.query as Record<string, string | undefined>)["t"];
  if (token && verifySpiToken(studentId, token)) return true;
  return false;
}
