#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "docs/card-pool-audit.json"), "utf8"));
const datasetPath = process.argv[2] ?? "/tmp/fab-cards.json";
if (!existsSync(datasetPath)) throw new Error(`dataset not found: ${datasetPath}`);

for (const code of manifest.synchronizedProductCodes) {
  const result = spawnSync(
    process.execPath,
    [join(root, "scripts/import-set.mjs"), code, datasetPath, "--known-only", "--force"],
    { cwd: root, stdio: "inherit" },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const audit = spawnSync(
  process.execPath,
  [
    join(root, "scripts/audit-card-pool.mjs"),
    datasetPath,
    "--revision",
    manifest.upstreamRevision,
  ],
  { cwd: root, stdio: "inherit" },
);
process.exit(audit.status ?? 1);
