import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const temporaryRoot = path.resolve(tmpdir());
const dataDirectory = mkdtempSync(path.join(temporaryRoot, "oims-e2e-"));
const relativeDataDirectory = path.relative(temporaryRoot, dataDirectory);

if (
  relativeDataDirectory === "" ||
  relativeDataDirectory.startsWith("..") ||
  path.isAbsolute(relativeDataDirectory) ||
  !path.basename(dataDirectory).startsWith("oims-e2e-")
) {
  throw new Error("Refusing to use an unsafe E2E data directory.");
}

const playwrightCli = path.resolve("node_modules", "@playwright", "test", "cli.js");
let exitCode = 1;

try {
  const result = spawnSync(process.execPath, [playwrightCli, "test"], {
    stdio: "inherit",
    env: {
      ...process.env,
      OIMS_E2E_DATA_DIR: dataDirectory,
    },
  });

  if (result.error) {
    throw result.error;
  }

  exitCode = result.status ?? 1;
} finally {
  rmSync(dataDirectory, {
    force: true,
    recursive: true,
    maxRetries: 20,
    retryDelay: 100,
  });
}

process.exitCode = exitCode;
