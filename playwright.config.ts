import { defineConfig } from "@playwright/test";

const nodeExecutable = JSON.stringify(process.execPath);
const e2eDataDirectory = process.env.OIMS_E2E_DATA_DIR;

if (!e2eDataDirectory) {
  throw new Error("OIMS_E2E_DATA_DIR must be provided by the E2E runner.");
}

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3100",
  },
  webServer: {
    command: `${nodeExecutable} --conditions=react-server --import tsx scripts/run-next.ts dev`,
    url: "http://127.0.0.1:3100/api/health",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      APP_DATA_DIR: e2eDataDirectory,
      APP_PORT: "3100",
      APP_HOST: "127.0.0.1",
      APP_TIMEZONE: "Africa/Khartoum",
    },
  },
});
