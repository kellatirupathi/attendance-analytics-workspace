import bcrypt from "bcryptjs";
import { db, usersTable, campusesTable } from "@workspace/db";
import {
  SEED_CAMPUSES,
  SEED_USERS,
  SEED_PASSWORD,
} from "./lib/seed-data.js";

async function main(): Promise<void> {
  console.log("Seeding campuses…");
  for (const name of SEED_CAMPUSES) {
    await db
      .insert(campusesTable)
      .values({ name })
      .onConflictDoNothing({ target: campusesTable.name });
    console.log(`  ✓ ${name}`);
  }

  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 10);
  console.log("Seeding staff accounts…");
  for (const u of SEED_USERS) {
    const email = u.email.trim().toLowerCase();
    await db
      .insert(usersTable)
      .values({
        name: u.name,
        email,
        passwordHash,
        role: u.role,
        campuses: u.campuses,
        subjects: u.subjects,
        isActive: true,
        createdBy: "seed",
      })
      .onConflictDoUpdate({
        target: usersTable.email,
        set: {
          name: u.name,
          role: u.role,
          campuses: u.campuses,
          subjects: u.subjects,
          passwordHash,
          isActive: true,
          updatedAt: new Date(),
        },
      });
    console.log(`  ✓ ${email} (${u.role})`);
  }

  console.log(
    `Done. Seeded ${SEED_CAMPUSES.length} campuses and ${SEED_USERS.length} staff accounts.`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
