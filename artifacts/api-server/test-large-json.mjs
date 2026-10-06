import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const artifactDir = dirname(fileURLToPath(import.meta.url));
const tempDir = await mkdtemp(join(tmpdir(), "niat-large-json-tests-"));
try {
  const outfile = join(tempDir, "large-json.test.cjs");
  await build({
    entryPoints: [join(artifactDir, "src/lib/largeJsonResponse.test.ts")],
    outfile,
    bundle: true,
    platform: "node",
    format: "cjs",
    logLevel: "warning",
  });
  const result = spawnSync(process.execPath, ["--test", outfile], {
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
