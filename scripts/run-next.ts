import { spawnSync } from "node:child_process";
import path from "node:path";
import { getConfig } from "@/server/config/env";

const command = process.argv[2];

if (command !== "dev" && command !== "start") {
  throw new Error("Expected Next.js command: dev or start.");
}

const config = getConfig();
const nextCli = path.resolve("node_modules", "next", "dist", "bin", "next");
const childEnvironment: NodeJS.ProcessEnv = {
  ...process.env,
  NEXT_TELEMETRY_DISABLED: "1",
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
  delete childEnvironment[agentVariable];
}

const result = spawnSync(
  process.execPath,
  [nextCli, command, "--hostname", config.host, "--port", String(config.port)],
  {
    env: childEnvironment,
    stdio: "inherit",
  },
);

if (result.error) {
  throw result.error;
}

process.exitCode = result.status ?? 1;
