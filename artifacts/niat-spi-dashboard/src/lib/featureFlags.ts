/**
 * Build-time feature flags. Set the matching VITE_ variable to "true" in the
 * environment (Replit Secrets or .env) and rebuild to turn a feature on.
 */
function flag(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

export const FEATURES = {
  /**
   * Campus Analytics (/dashboard/campuses). Off by default: its drill-down
   * duplicates Student Attendance Stats and the Student Directory, so the
   * route redirects to Attendance Stats. The page code stays in place.
   */
  campusAnalytics: flag(import.meta.env.VITE_FEATURE_CAMPUS_ANALYTICS),
} as const;
