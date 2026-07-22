import { MongoClient } from "mongodb";
import { db } from "@workspace/db";
import { usersTable, campusesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./lib/logger.js";

type Role =
  | "superadmin"
  | "admin"
  | "hod"
  | "capability_manager"
  | "boa"
  | "instructor";

const ROLE_MAP: Record<string, Role> = {
  superadmin: "superadmin",
  super_admin: "superadmin",
  admin: "admin",
  hod: "hod",
  capability_manager: "capability_manager",
  capabilitymanager: "capability_manager",
  cm: "capability_manager",
  boa: "boa",
  instructor: "instructor",
};

function normalizeRole(raw: unknown): Role {
  const key = String(raw ?? "")
    .toLowerCase()
    .trim()
    .replace(/[\s-]+/g, "_");
  return ROLE_MAP[key] ?? "instructor";
}

function toStringArray(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v.map((x) => String(x)).filter((x) => x.trim().length > 0);
  }
  if (typeof v === "string" && v.trim().length > 0) return [v.trim()];
  return [];
}

async function migrate() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    logger.error("MONGODB_URI is not set — cannot run migration.");
    process.exit(1);
  }

  logger.info("Connecting to MongoDB (niatspi)...");
  const client = new MongoClient(uri);
  await client.connect();

  try {
    const mdb = client.db("niatspi");
    const mongoUsers = await mdb.collection("users").find({}).toArray();
    const mongoCampuses = await mdb.collection("campus").find({}).toArray();
    logger.info(
      { users: mongoUsers.length, campuses: mongoCampuses.length },
      "Fetched Mongo documents"
    );

    // --- Campuses: wipe any prior (fake) seed and insert the real set ---
    await db.delete(campusesTable);
    let campusCount = 0;
    for (const c of mongoCampuses) {
      const name = String(
        (c as Record<string, unknown>)["name"] ??
          (c as Record<string, unknown>)["campusName"] ??
          ""
      ).trim();
      if (!name) continue;
      const instituteIdRaw =
        (c as Record<string, unknown>)["instituteId"] ??
        (c as Record<string, unknown>)["institute_id"] ??
        null;
      await db
        .insert(campusesTable)
        .values({
          name,
          instituteId: instituteIdRaw ? String(instituteIdRaw) : null,
        })
        .onConflictDoNothing({ target: campusesTable.name });
      campusCount++;
      logger.info({ name }, "Migrated campus");
    }

    // --- Remove the fake seed superadmin, if present ---
    await db.delete(usersTable).where(eq(usersTable.email, "admin@niat.edu"));

    // --- Users: upsert by email, preserving the existing passwordHash as-is ---
    let userCount = 0;
    for (const u of mongoUsers) {
      const doc = u as Record<string, unknown>;
      const email = String(doc["email"] ?? "").toLowerCase().trim();
      if (!email) {
        logger.warn("Skipping user with no email");
        continue;
      }
      const name = String(doc["name"] ?? doc["fullName"] ?? email);
      const role = normalizeRole(doc["role"]);
      const campuses = toStringArray(doc["campuses"] ?? doc["campus"]);
      const subjects = toStringArray(doc["subjects"] ?? doc["subject"]);
      const isActiveRaw = doc["isActive"];
      const isActive =
        isActiveRaw === undefined || isActiveRaw === null
          ? true
          : Boolean(isActiveRaw);
      const createdBy = doc["createdBy"] ? String(doc["createdBy"]) : "migration";
      const passwordHashRaw = doc["passwordHash"] ?? null;
      const passwordHash = passwordHashRaw ? String(passwordHashRaw) : null;

      const values = {
        name,
        email,
        passwordHash,
        role,
        campuses,
        subjects,
        isActive,
        createdBy,
        tokenVersion: 0,
      };

      await db
        .insert(usersTable)
        .values(values)
        .onConflictDoUpdate({
          target: usersTable.email,
          set: {
            name,
            passwordHash,
            role,
            campuses,
            subjects,
            isActive,
            createdBy,
            tokenVersion: 0,
            updatedAt: new Date(),
          },
        });
      userCount++;
      logger.info({ email, role }, "Migrated user");
    }

    logger.info(
      { users: userCount, campuses: campusCount },
      "Migration complete."
    );
  } finally {
    await client.close();
  }
  process.exit(0);
}

migrate().catch((err) => {
  logger.error({ err }, "Migration failed");
  process.exit(1);
});
