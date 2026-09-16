import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:net";

async function findAvailableLoopbackPort() {
  const listener = createServer();

  await new Promise((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", resolve);
  });

  const address = listener.address();
  if (!address || typeof address === "string") {
    listener.close();
    throw new Error("Could not allocate an E2E loopback port.");
  }

  await new Promise((resolve, reject) => {
    listener.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });

  return address.port;
}

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
const nextCli = path.resolve("node_modules", "next", "dist", "bin", "next");
const serverPort = await findAvailableLoopbackPort();
const serverOrigin = `http://127.0.0.1:${serverPort}`;
const serverUrl = `${serverOrigin}/api/health`;
const serverEnvironment = {
  ...process.env,
  OIMS_E2E_DATA_DIR: dataDirectory,
  APP_DATA_DIR: dataDirectory,
  APP_PORT: String(serverPort),
  APP_HOST: "127.0.0.1",
  APP_TIMEZONE: "Africa/Khartoum",
  NEXT_TELEMETRY_DISABLED: "1",
  SESSION_SECRET: randomBytes(32).toString("base64url"),
};

for (const agentVariable of [
  "AI_AGENT",
  "ANTIGRAVITY_AGENT",
  "AUGMENT_AGENT",
  "CLAUDECODE",
  "CLAUDE_CODE",
  "CODEX_CI",
  "CODEX_SANDBOX",
  "CODEX_THREAD_ID",
  "COPILOT_ALLOW_ALL",
  "COPILOT_GITHUB_TOKEN",
  "COPILOT_MODEL",
  "CURSOR_AGENT",
  "CURSOR_EXTENSION_HOST_ROLE",
  "CURSOR_TRACE_ID",
  "GEMINI_CLI",
  "OPENCODE_CLIENT",
  "REPL_ID",
]) {
  delete serverEnvironment[agentVariable];
}

let exitCode = 1;
let server;

function hasExited(child) {
  return child.exitCode !== null || child.signalCode !== null;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForServer(child, getSpawnError) {
  const deadline = Date.now() + 120_000;

  while (Date.now() < deadline) {
    const spawnError = getSpawnError();
    if (spawnError) throw spawnError;
    if (hasExited(child)) {
      throw new Error(`E2E server exited before becoming ready (${child.exitCode ?? child.signalCode}).`);
    }

    try {
      const response = await fetch(serverUrl, { cache: "no-store" });
      if (response.ok) return;
    } catch {
      // The local server is still starting.
    }

    await delay(250);
  }

  throw new Error("Timed out waiting for the E2E server.");
}

function waitForProcess(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? 1));
  });
}

async function stopServer(child) {
  if (hasExited(child)) return;

  const closed = new Promise((resolve) => child.once("close", resolve));
  child.kill();
  const stopped = await Promise.race([
    closed.then(() => true),
    delay(5_000).then(() => false),
  ]);

  if (!stopped && !hasExited(child)) {
    child.kill("SIGKILL");
    await Promise.race([closed, delay(5_000)]);
  }

  if (!hasExited(child)) {
    throw new Error("E2E server did not stop cleanly.");
  }
}

try {
  let serverSpawnError;
  server = spawn(process.execPath, [nextCli, "dev", "--hostname", "127.0.0.1", "--port", String(serverPort)], {
    stdio: "inherit",
    env: serverEnvironment,
  });
  server.once("error", (error) => { serverSpawnError = error; });
  await waitForServer(server, () => serverSpawnError);

  const runner = spawn(process.execPath, [playwrightCli, "test"], {
    stdio: "inherit",
    env: {
      ...process.env,
      OIMS_E2E_BASE_URL: serverOrigin,
      OIMS_E2E_DATA_DIR: dataDirectory,
      OIMS_E2E_EXTERNAL_SERVER: "1",
    },
  });

  exitCode = await waitForProcess(runner);
} finally {
  if (server) await stopServer(server);
  rmSync(dataDirectory, {
    force: true,
    recursive: true,
    maxRetries: 20,
    retryDelay: 100,
  });
}

process.exitCode = exitCode;
