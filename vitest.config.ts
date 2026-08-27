import { tmpdir } from "node:os";
import path from "node:path";
import { defineConfig } from "vitest/config";

const root = path.resolve(import.meta.dirname);
const testRuntimeDirectory = path.join(tmpdir(), `oims-vitest-runtime-${process.pid}`);

export default defineConfig({
  resolve: {
    alias: {
      "@": path.join(root, "src"),
      "server-only": path.join(root, "tests", "fixtures", "server-only.ts"),
    },
  },
  test: {
    environment: "node",
    env: {
      APP_DATA_DIR: testRuntimeDirectory,
      NODE_ENV: "test",
    },
    passWithNoTests: false,
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          sequence: { concurrent: false },
        },
      },
    ],
  },
});
