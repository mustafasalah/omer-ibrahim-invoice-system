import "server-only";

import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { ensureDataDirectories } from "@/server/config/data-directories";
import { getConfig } from "@/server/config/env";
import { schema } from "./schema";

export const SQLITE_BUSY_TIMEOUT_MS = 5_000;
export const DEFAULT_DATABASE_FILENAME = "oims.sqlite";
export const CURRENT_SCHEMA_VERSION = 1;

export type AppDatabase = BetterSQLite3Database<typeof schema>;

export type DatabaseConnection = {
  client: Database.Database;
  db: AppDatabase;
  databasePath: string;
};

export type DatabaseHealth = {
  quickCheck: "ok";
  journalMode: "wal";
  foreignKeys: true;
  busyTimeoutMs: number;
  schemaVersion: number;
};

export function openDatabase(databasePath: string): DatabaseConnection {
  const client = new Database(databasePath);
  client.defaultSafeIntegers(true);

  try {
    client.pragma("journal_mode = WAL");
    client.pragma("foreign_keys = ON");
    client.pragma(`busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
  } catch (error) {
    client.close();
    throw error;
  }

  return {
    client,
    db: drizzle(client, { schema }),
    databasePath,
  };
}

export function migrateDatabase(
  connection: DatabaseConnection,
  migrationsFolder = path.resolve(process.cwd(), "drizzle"),
): void {
  migrate(connection.db, { migrationsFolder });
}

function pragmaInteger(value: unknown): number {
  if (typeof value === "bigint") {
    return Number(value);
  }

  if (typeof value === "number") {
    return value;
  }

  throw new TypeError("Unexpected SQLite pragma result.");
}

export function checkDatabase(connection: DatabaseConnection): DatabaseHealth {
  const quickCheck = connection.client.pragma("quick_check", { simple: true });
  const journalMode = connection.client.pragma("journal_mode", { simple: true });
  const foreignKeys = connection.client.pragma("foreign_keys", { simple: true });
  const busyTimeout = connection.client.pragma("busy_timeout", { simple: true });
  const migrationState = connection.client
    .prepare("select count(*) as count from __drizzle_migrations")
    .get() as { count: bigint };

  if (quickCheck !== "ok") {
    throw new Error("SQLite quick_check failed.");
  }

  if (typeof journalMode !== "string" || journalMode.toLowerCase() !== "wal") {
    throw new Error("SQLite WAL mode is not enabled.");
  }

  if (pragmaInteger(foreignKeys) !== 1) {
    throw new Error("SQLite foreign keys are not enabled.");
  }

  if (pragmaInteger(busyTimeout) !== SQLITE_BUSY_TIMEOUT_MS) {
    throw new Error("SQLite busy timeout is not configured.");
  }

  if (migrationState.count !== BigInt(CURRENT_SCHEMA_VERSION)) {
    throw new Error("SQLite schema version is not supported by this application build.");
  }

  return {
    quickCheck: "ok",
    journalMode: "wal",
    foreignKeys: true,
    busyTimeoutMs: SQLITE_BUSY_TIMEOUT_MS,
    schemaVersion: CURRENT_SCHEMA_VERSION,
  };
}

declare global {
  var __oimsDatabaseConnection: DatabaseConnection | undefined;
}

export function getDatabase(): DatabaseConnection {
  if (globalThis.__oimsDatabaseConnection) {
    return globalThis.__oimsDatabaseConnection;
  }

  const config = getConfig();
  const directories = ensureDataDirectories(config);
  const databasePath = path.join(directories.database, DEFAULT_DATABASE_FILENAME);
  const connection = openDatabase(databasePath);

  try {
    migrateDatabase(connection);
    checkDatabase(connection);
    globalThis.__oimsDatabaseConnection = connection;
    return connection;
  } catch (error) {
    connection.client.close();
    throw error;
  }
}
