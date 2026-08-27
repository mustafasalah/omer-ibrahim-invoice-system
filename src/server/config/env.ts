import "server-only";

import { randomBytes } from "node:crypto";
import path from "node:path";
import { z } from "zod";

const logLevels = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;

export type RuntimeEnvironment = "development" | "test" | "production";

export type AppConfig = Readonly<{
  environment: RuntimeEnvironment;
  dataDir: string;
  host: string;
  port: number;
  timezone: string;
  sessionSecret: string;
  logLevel: (typeof logLevels)[number];
}>;

export type ConfigDiagnostic = Omit<AppConfig, "sessionSecret"> & {
  sessionSecret: "[REDACTED]";
};

type EnvironmentSource = Record<string, string | undefined>;

const baseSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_DATA_DIR: z.string().trim().optional(),
  APP_HOST: z.string().trim().min(1).default("127.0.0.1"),
  APP_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  APP_TIMEZONE: z.string().trim().min(1).default("Africa/Khartoum"),
  SESSION_SECRET: z.string().min(32).optional(),
  LOG_LEVEL: z.enum(logLevels).default("info"),
});

function isInside(parentPath: string, childPath: string): boolean {
  const relative = path.relative(parentPath, childPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isSupportedTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
}

export function loadConfig(
  source: EnvironmentSource = process.env,
  repositoryRoot = process.cwd(),
): AppConfig {
  const parsed = baseSchema.parse(source);
  const configuredDataDir = parsed.APP_DATA_DIR;

  if (parsed.NODE_ENV === "production" && !configuredDataDir) {
    throw new Error("APP_DATA_DIR is required in production.");
  }

  const dataDir = path.resolve(repositoryRoot, configuredDataDir || "data");

  if (parsed.NODE_ENV === "production") {
    if (!path.isAbsolute(configuredDataDir ?? "")) {
      throw new Error("APP_DATA_DIR must be absolute in production.");
    }

    if (isInside(path.resolve(repositoryRoot), dataDir)) {
      throw new Error("APP_DATA_DIR must be outside the source directory in production.");
    }

    if (!parsed.SESSION_SECRET) {
      throw new Error("SESSION_SECRET is required in production.");
    }
  }

  if (!isSupportedTimezone(parsed.APP_TIMEZONE)) {
    throw new Error("APP_TIMEZONE must be a supported IANA timezone.");
  }

  return Object.freeze({
    environment: parsed.NODE_ENV,
    dataDir,
    host: parsed.APP_HOST,
    port: parsed.APP_PORT,
    timezone: parsed.APP_TIMEZONE,
    sessionSecret: parsed.SESSION_SECRET ?? randomBytes(32).toString("base64url"),
    logLevel: parsed.LOG_LEVEL,
  });
}

export function toConfigDiagnostic(config: AppConfig): ConfigDiagnostic {
  return {
    environment: config.environment,
    dataDir: config.dataDir,
    host: config.host,
    port: config.port,
    timezone: config.timezone,
    sessionSecret: "[REDACTED]",
    logLevel: config.logLevel,
  };
}

let cachedConfig: AppConfig | undefined;

export function getConfig(): AppConfig {
  cachedConfig ??= loadConfig();
  return cachedConfig;
}
