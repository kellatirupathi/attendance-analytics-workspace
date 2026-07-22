import bcrypt from "bcryptjs";
import { inArray } from "drizzle-orm";
import { db, usersTable, campusesTable } from "@workspace/db";
import type { Role } from "./rbac.js";
import { logger } from "./logger.js";

export const SEED_PASSWORD = "Niat@2026";

export const CAMPUS_NXTWAVE = "Nxtwave Institute of Advanced Technologies";
export const CAMPUS_CHEVELLA = "NIAT Chevella";
export const CAMPUS_CHAITANYA = "Chaitanya Deemed-to-be University";

export const SEED_CAMPUSES = [
  CAMPUS_NXTWAVE,
  CAMPUS_CHEVELLA,
  CAMPUS_CHAITANYA,
];

export interface SeedUser {
  name: string;
  email: string;
  role: Role;
  campuses: string[];
  subjects: string[];
}

export const SEED_USERS: SeedUser[] = [
  // Super Admin — full control over everything
  { name: "Akhilendar Reddy", email: "superadmin1@nxtwave.co.in", role: "superadmin", campuses: [], subjects: [] },
  { name: "Priya Menon", email: "superadmin2@nxtwave.co.in", role: "superadmin", campuses: [], subjects: [] },
  { name: "Rahul Varma", email: "superadmin3@nxtwave.co.in", role: "superadmin", campuses: [], subjects: [] },

  // Admin — manages HOD/CM/BOA/Instructors + CRUD; all campuses
  { name: "Sandeep Kumar", email: "admin1@nxtwave.co.in", role: "admin", campuses: [], subjects: [] },
  { name: "Divya Rao", email: "admin2@nxtwave.co.in", role: "admin", campuses: [], subjects: [] },
  { name: "Imran Shaikh", email: "admin3@nxtwave.co.in", role: "admin", campuses: [], subjects: [] },

  // HOD — read-only, all campuses
  { name: "Dr. Lakshmi Narayan", email: "hod1@nxtwave.co.in", role: "hod", campuses: [], subjects: [] },
  { name: "Dr. Venkatesh Iyer", email: "hod2@nxtwave.co.in", role: "hod", campuses: [], subjects: [] },
  { name: "Dr. Anjali Gupta", email: "hod3@nxtwave.co.in", role: "hod", campuses: [], subjects: [] },

  // Capability Manager — read-only, assigned campus + subjects
  { name: "Kiran Teja", email: "cm1@nxtwave.co.in", role: "capability_manager", campuses: [CAMPUS_NXTWAVE], subjects: [] },
  { name: "Meghana Reddy", email: "cm2@nxtwave.co.in", role: "capability_manager", campuses: [CAMPUS_CHEVELLA], subjects: [] },
  { name: "Arjun Nair", email: "cm3@nxtwave.co.in", role: "capability_manager", campuses: [CAMPUS_CHAITANYA], subjects: [] },

  // BOA — read-only, one assigned campus
  { name: "Suresh Babu", email: "boa1@nxtwave.co.in", role: "boa", campuses: [CAMPUS_NXTWAVE], subjects: [] },
  { name: "Naveen Chandra", email: "boa2@nxtwave.co.in", role: "boa", campuses: [CAMPUS_CHEVELLA], subjects: [] },
  { name: "Pooja Sharma", email: "boa3@nxtwave.co.in", role: "boa", campuses: [CAMPUS_CHAITANYA], subjects: [] },

  // Instructor — read-only, own campus + subject
  { name: "Ravi Teja", email: "instructor1@nxtwave.co.in", role: "instructor", campuses: [CAMPUS_NXTWAVE], subjects: [] },
  { name: "Sneha Patil", email: "instructor2@nxtwave.co.in", role: "instructor", campuses: [CAMPUS_CHEVELLA], subjects: [] },
  { name: "Vikram Aditya", email: "instructor3@nxtwave.co.in", role: "instructor", campuses: [CAMPUS_CHAITANYA], subjects: [] },
];

/**
 * One-time startup backfill. Inserts missing campuses, and creates the staff
 * accounts ONLY if none of them exist yet (first boot against a fresh
 * database). If any seed account is already present, user seeding is skipped
 * entirely — so accounts deleted or edited by an admin are never resurrected
 * or overwritten on restart.
 */
export async function runStartupSeed(): Promise<void> {
  for (const name of SEED_CAMPUSES) {
    await db
      .insert(campusesTable)
      .values({ name })
      .onConflictDoNothing({ target: campusesTable.name });
  }

  const emails = SEED_USERS.map((u) => u.email.trim().toLowerCase());
  const existing = await db
    .select({ email: usersTable.email })
    .from(usersTable)
    .where(inArray(usersTable.email, emails));

  if (existing.length > 0) {
    logger.info(
      { present: existing.length },
      "Startup seed: staff accounts already seeded, skipping",
    );
    return;
  }

  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 10);
  for (const u of SEED_USERS) {
    await db
      .insert(usersTable)
      .values({
        name: u.name,
        email: u.email.trim().toLowerCase(),
        passwordHash,
        role: u.role,
        campuses: u.campuses,
        subjects: u.subjects,
        isActive: true,
        createdBy: "seed",
      })
      .onConflictDoNothing({ target: usersTable.email });
  }

  logger.info(
    { created: SEED_USERS.length },
    "Startup seed: created staff accounts",
  );
}
