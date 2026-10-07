import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const appTypecheck = "pnpm run typecheck:apps";
const apiProductionBuild = "pnpm --filter @workspace/api-server run build";
const dashboardProductionBuild =
  "pnpm --filter @workspace/niat-spi-dashboard run build";
const dashboardRoutePath = resolve(
  workspaceRoot,
  "artifacts/api-server/src/routes/dashboard.ts",
);
const queryModulePath = resolve(
  workspaceRoot,
  "artifacts/api-server/src/lib/queries.ts",
);

const attendanceContractPath = resolve(
  workspaceRoot,
  "artifacts/api-server/src/lib/attendance-contract.ts",
);
function assertReleaseBuildOrder(releaseCommand: string) {
  const steps = releaseCommand.split("&&").map((step) => step.trim());
  const appTypecheckIndex = steps.indexOf(appTypecheck);
  const apiBuildIndex = steps.indexOf(apiProductionBuild);
  const dashboardBuildIndex = steps.indexOf(dashboardProductionBuild);

  assert.notEqual(
    appTypecheckIndex,
    -1,
    "validate:release must typecheck applications",
  );
  assert.ok(
    apiBuildIndex > appTypecheckIndex,
    "validate:release must run the API production build after application typechecking",
  );
  assert.ok(
    dashboardBuildIndex > appTypecheckIndex,
    "validate:release must run the dashboard production build after application typechecking",
  );
}

async function readPackageJson(path: string) {
  return JSON.parse(await readFile(path, "utf8")) as {
    scripts: Record<string, string>;
  };
}

function namedQueryImports(source: string): string[] {
  const importMatch = source.match(
    /(?:^|\n)import\s*\{([^}]*)\}\s*from\s*["']\.\.\/lib\/queries\.js["']/,
  );
  assert.ok(
    importMatch,
    "dashboard.ts must import its query helpers from ../lib/queries.js",
  );

  return importMatch[1]
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .split(",")
    .map((specifier) =>
      specifier.trim().split(/\s+as\s+/)[0]?.trim().replace(/^type\s+/, ""),
    )
    .filter((name): name is string => Boolean(name));
}

function exportedQueryNames(source: string): Set<string> {
  const names = new Set<string>();
  const declarationPattern =
    /\bexport\s+(?:async\s+)?(?:function|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g;

  for (const match of source.matchAll(declarationPattern)) {
    names.add(match[1]);
  }

  for (const match of source.matchAll(/\bexport\s*\{([^}]+)\}/g)) {
    for (const specifier of match[1].split(",")) {
      const name = specifier.trim().split(/\s+as\s+/).at(-1)?.trim();
      if (name) names.add(name);
    }
  }

  return names;
}

test("dashboard query imports match the query module exports", async () => {
  const [dashboardSource, querySource] = await Promise.all([
    readFile(dashboardRoutePath, "utf8"),
    readFile(queryModulePath, "utf8"),
  ]);
  const imports = namedQueryImports(dashboardSource);
  const exports = exportedQueryNames(querySource);
  const missing = imports.filter((name) => !exports.has(name));

  assert.deepEqual(
    missing,
    [],
    `dashboard.ts imports query helpers missing from queries.ts: ${missing.join(", ")}`,
  );

  for (const [method, route] of [
    ["post", "/recovery-sessions"],
    ["delete", "/recovery-sessions/:id"],
  ]) {
    assert.match(
      dashboardSource,
      new RegExp(`router\\.${method}\\(\\s*["']${route.replace(/[/:]/g, "\\$&")}["']`),
      `dashboard.ts must define the recovery ${method.toUpperCase()} ${route} route`,
    );
  }

  for (const helper of [
    "scheduleRecoverySession",
    "cancelRecoverySession",
    "getRecoverySessionScope",
  ]) {
    assert.ok(
      imports.includes(helper),
      `dashboard.ts recovery routes must import ${helper} from queries.ts`,
    );
  }
});

test("release readiness typechecks applications before both production builds", async () => {
  const [rootPackage, dashboardPackage] = await Promise.all([
    readPackageJson(resolve(workspaceRoot, "package.json")),
    readPackageJson(
      resolve(workspaceRoot, "artifacts/niat-spi-dashboard/package.json"),
    ),
  ]);

  assertReleaseBuildOrder(rootPackage.scripts["validate:release"]);
  assert.match(
    dashboardPackage.scripts.build,
    /^vite build(?:\s|$)/,
    "the dashboard build command must remain a Vite production build",
  );
});

test("release readiness rejects a missing API production build", () => {
  assert.throws(() =>
    assertReleaseBuildOrder(
      `${appTypecheck} && ${dashboardProductionBuild}`,
    ),
  );
});

test("release readiness rejects a missing dashboard production build", () => {
  assert.throws(() =>
    assertReleaseBuildOrder(
      `${appTypecheck} && ${apiProductionBuild}`,
    ),
  );
});

test("release readiness rejects a dashboard build before application typechecking", () => {
  assert.throws(() =>
    assertReleaseBuildOrder(
      `${dashboardProductionBuild} && ${appTypecheck} && ${apiProductionBuild}`,
    ),
  );
});

test("live warehouse supports every shared attendance rollup field and session identity", async () => {
  const { validateAttendanceContract } = await import(attendanceContractPath);
  // Never skip missing credentials: release readiness requires live verification.
  await validateAttendanceContract();
});

test("attendance contract probes shared SQL without scanning or returning student rows", async () => {
  const contract = await import(attendanceContractPath);
  const calls: string[] = [];
  await contract.validateAttendanceContract(async (sql: string) => {
    calls.push(sql);
    return [];
  });
  assert.deepEqual(calls, [contract.ATTENDANCE_CONTRACT_SQL]);
  for (const field of contract.ATTENDANCE_ROLLUP_FIELDS) {
    assert.ok(calls[0].includes(field), `contract must query ${field}`);
  }
  assert.ok(calls[0].includes(contract.SESSION_IDENTITY_SQL));
  assert.match(calls[0], /WHERE FALSE\s+LIMIT 0/);
  assert.doesNotMatch(calls[0], /\bsession_type\b/);
  const source = await readFile(queryModulePath, "utf8");
  assert.match(source, /import\s*\{[^}]*SESSION_IDENTITY_SQL[^}]*\}\s*from "\.\/attendance-contract\.js"/);
});

test("attendance contract names every missing or unqueryable field and table", async () => {
  const contract = await import(attendanceContractPath);
  for (const field of contract.ATTENDANCE_ROLLUP_FIELDS) {
    await assert.rejects(
      contract.validateAttendanceContract(async (sql: string) => {
        if (new RegExp(`\\b${field}\\b`).test(sql)) {
          throw new Error(`Unrecognized name: ${field}`);
        }
        return [];
      }),
      (error: Error) => {
        assert.ok(error.message.includes(contract.ATTENDANCE_TABLE));
        assert.ok(error.message.includes(`field ${field}:`));
        return true;
      },
    );
  }
});

test("attendance contract fails for an unqueryable session identity expression", async () => {
  const contract = await import(attendanceContractPath);
  await assert.rejects(
    contract.validateAttendanceContract(async (sql: string) => {
      if (sql.includes(contract.SESSION_IDENTITY_SQL)) {
        throw new Error("No matching signature for COALESCE");
      }
      return [];
    }),
    (error: Error) => {
      assert.ok(error.message.includes(contract.ATTENDANCE_TABLE));
      assert.match(error.message, /expression session_identity/);
      assert.match(error.message, /entity_id/);
      return true;
    },
  );
});

test("attendance contract never treats authorization or transport failure as success", async () => {
  const { validateAttendanceContract } = await import(attendanceContractPath);
  await assert.rejects(
    validateAttendanceContract(async () => { throw new Error("Access denied"); }),
    /Attendance warehouse contract failed.*niat_students_overall_attendance_details[\s\S]*Access denied/,
  );
});
