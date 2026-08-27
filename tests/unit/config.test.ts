import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig, toConfigDiagnostic } from "@/server/config/env";

const repositoryRoot = path.resolve("C:/work/oims");

describe("runtime configuration", () => {
  it("loads typed development defaults", () => {
    const config = loadConfig({ NODE_ENV: "development" }, repositoryRoot);

    expect(config.dataDir).toBe(path.join(repositoryRoot, "data"));
    expect(config.host).toBe("127.0.0.1");
    expect(config.port).toBe(3000);
    expect(config.timezone).toBe("Africa/Khartoum");
    expect(config.sessionSecret.length).toBeGreaterThanOrEqual(32);
  });

  it("redacts the session secret from diagnostics", () => {
    const config = loadConfig(
      { NODE_ENV: "test", SESSION_SECRET: "a".repeat(32) },
      repositoryRoot,
    );

    const diagnostic = toConfigDiagnostic(config);

    expect(diagnostic.sessionSecret).toBe("[REDACTED]");
    expect(JSON.stringify(diagnostic)).not.toContain("a".repeat(32));
  });

  it("rejects production data inside the source directory", () => {
    expect(() =>
      loadConfig(
        {
          NODE_ENV: "production",
          APP_DATA_DIR: path.join(repositoryRoot, "runtime"),
          SESSION_SECRET: "s".repeat(32),
        },
        repositoryRoot,
      ),
    ).toThrow("outside the source directory");
  });

  it("accepts an absolute production data directory outside source", () => {
    const outsideDataDirectory = path.resolve(repositoryRoot, "..", "oims-data");
    const config = loadConfig(
      {
        NODE_ENV: "production",
        APP_DATA_DIR: outsideDataDirectory,
        SESSION_SECRET: "s".repeat(32),
      },
      repositoryRoot,
    );

    expect(config.dataDir).toBe(outsideDataDirectory);
  });

  it("rejects invalid ports and timezones", () => {
    expect(() => loadConfig({ APP_PORT: "70000" }, repositoryRoot)).toThrow();
    expect(() => loadConfig({ APP_TIMEZONE: "Mars/Olympus" }, repositoryRoot)).toThrow(
      "supported IANA timezone",
    );
  });
});
