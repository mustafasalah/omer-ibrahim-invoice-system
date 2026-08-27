import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { checkDatabase, migrateDatabase, openDatabase } from "@/server/db/connection";
import { seedDevelopmentSettings } from "@/server/db/seed";
import { auditLogs, invoices, users } from "@/server/db/schema";
import { AppError, apiErrorCodes } from "@/server/http/errors";
import { withImmediateTransaction } from "@/server/db/transaction";
import { createTemporaryDatabase } from "../fixtures/database";

describe("SQLite foundation", () => {
  it("migrates an empty database idempotently with the Milestone 1 tables", () => {
    const temporary = createTemporaryDatabase();

    try {
      migrateDatabase(temporary.connection);
      const tableNames = temporary.connection.client
        .prepare(
          "select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name",
        )
        .all()
        .map((row) => (row as { name: string }).name);

      expect(tableNames).toEqual([
        "__drizzle_migrations",
        "app_settings",
        "audit_logs",
        "beneficiaries",
        "dealer_logos",
        "invoice_dealer_logos",
        "invoice_items",
        "invoice_print_snapshots",
        "invoice_sequences",
        "invoices",
        "media_assets",
        "products",
        "sessions",
        "users",
      ]);
      expect(tableNames).not.toContain("financial_transactions");

      const migrationCount = temporary.connection.client
        .prepare("select count(*) as count from __drizzle_migrations")
        .get() as { count: bigint };
      expect(migrationCount.count).toBe(1n);
    } finally {
      temporary.dispose();
    }
  });

  it("enables WAL, foreign keys, safe integers, and busy timeout on every open", () => {
    const temporary = createTemporaryDatabase();

    try {
      expect(checkDatabase(temporary.connection)).toEqual({
        quickCheck: "ok",
        journalMode: "wal",
        foreignKeys: true,
        busyTimeoutMs: 5_000,
        schemaVersion: 1,
      });

      const rawInteger = temporary.connection.client.prepare("select 1 as value").get() as {
        value: bigint;
      };
      expect(rawInteger.value).toBe(1n);
    } finally {
      temporary.dispose();
    }
  });

  it("rejects a database schema newer than this application build", () => {
    const temporary = createTemporaryDatabase();

    try {
      temporary.connection.client
        .prepare("insert into __drizzle_migrations (hash, created_at) values (?, ?)")
        .run("future-migration", 9_999_999_999_999n);

      expect(() => checkDatabase(temporary.connection)).toThrow(
        "schema version is not supported",
      );
    } finally {
      temporary.dispose();
    }
  });

  it("enforces foreign keys", () => {
    const temporary = createTemporaryDatabase();

    try {
      expect(() =>
        temporary.connection.client
          .prepare(
            `insert into sessions (
              id, user_id, token_hash, created_at, last_seen_at, expires_at, absolute_expires_at
            ) values (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            "session-1",
            "missing-user",
            "hash",
            "2026-08-26T00:00:00.000Z",
            "2026-08-26T00:00:00.000Z",
            "2026-08-26T01:00:00.000Z",
            "2026-08-26T12:00:00.000Z",
          ),
      ).toThrow(/FOREIGN KEY constraint failed/);
    } finally {
      temporary.dispose();
    }
  });

  it("rolls back an interrupted immediate transaction", () => {
    const temporary = createTemporaryDatabase();

    try {
      expect(() =>
        withImmediateTransaction(temporary.connection.client, () => {
          temporary.connection.client
            .prepare(
              "insert into invoice_sequences (sequence_key, last_value, updated_at) values (?, ?, ?)",
            )
            .run("2026", 1, "2026-08-26T00:00:00.000Z");
          throw new Error("simulated process interruption");
        }),
      ).toThrow(AppError);

      const sequenceCount = temporary.connection.client
        .prepare("select count(*) as count from invoice_sequences")
        .get() as { count: bigint };
      expect(sequenceCount.count).toBe(0n);
    } finally {
      temporary.dispose();
    }
  });

  it("classifies unique and busy write conflicts safely", () => {
    const temporary = createTemporaryDatabase();
    const secondConnection = openDatabase(temporary.connection.databasePath);

    try {
      temporary.connection.client
        .prepare(
          "insert into invoice_sequences (sequence_key, last_value, updated_at) values (?, ?, ?)",
        )
        .run("global", 0, "2026-08-26T00:00:00.000Z");

      expect(() =>
        withImmediateTransaction(temporary.connection.client, () => {
          temporary.connection.client
            .prepare(
              "insert into invoice_sequences (sequence_key, last_value, updated_at) values (?, ?, ?)",
            )
            .run("global", 0, "2026-08-26T00:00:00.000Z");
        }),
      ).toThrow(
        expect.objectContaining({
          code: apiErrorCodes.CONFLICT,
          status: 409,
        }),
      );

      temporary.connection.client.exec("BEGIN IMMEDIATE");
      secondConnection.client.pragma("busy_timeout = 10");

      expect(() => withImmediateTransaction(secondConnection.client, () => undefined)).toThrow(
        expect.objectContaining({
          code: apiErrorCodes.DATABASE_BUSY,
          status: 503,
        }),
      );
    } finally {
      if (temporary.connection.client.inTransaction) {
        temporary.connection.client.exec("ROLLBACK");
      }
      secondConnection.client.close();
      temporary.dispose();
    }
  });

  it("keeps audit records append-only", () => {
    const temporary = createTemporaryDatabase();

    try {
      temporary.connection.client
        .prepare(
          `insert into audit_logs (
            id, event_type, summary, created_at, request_id
          ) values (?, ?, ?, ?, ?)`,
        )
        .run(
          "audit-1",
          "SYSTEM_INITIALIZED",
          "initialized",
          "2026-08-26T00:00:00.000Z",
          "request-1",
        );

      expect(() =>
        temporary.connection.client
          .prepare("update audit_logs set summary = ? where id = ?")
          .run("changed", "audit-1"),
      ).toThrow(/append-only/);
      expect(() =>
        temporary.connection.client.prepare("delete from audit_logs where id = ?").run("audit-1"),
      ).toThrow(/append-only/);

      const stored = temporary.connection.db
        .select({ summary: auditLogs.summary })
        .from(auditLogs)
        .where(eq(auditLogs.id, "audit-1"))
        .get();
      expect(stored?.summary).toBe("initialized");
    } finally {
      temporary.dispose();
    }
  });

  it("seeds exactly one explicit development settings singleton", () => {
    const temporary = createTemporaryDatabase();

    try {
      seedDevelopmentSettings(temporary.connection, "2026-08-26T00:00:00.000Z");
      seedDevelopmentSettings(temporary.connection, "2026-08-26T00:00:01.000Z");

      const settings = temporary.connection.client
        .prepare("select id, currency_code, sequence_start from app_settings")
        .all() as Array<{ id: string; currency_code: string; sequence_start: bigint }>;
      const userCount = temporary.connection.client.prepare("select count(*) as count from users").get() as {
        count: bigint;
      };

      expect(settings).toEqual([{ id: "default", currency_code: "SDG", sequence_start: 1n }]);
      expect(userCount.count).toBe(0n);
    } finally {
      temporary.dispose();
    }
  });

  it("round-trips monetary columns as bigint beyond Number safe precision", () => {
    const temporary = createTemporaryDatabase();
    const now = "2026-08-26T00:00:00.000Z";
    const amount = 9_007_199_254_740_993n;

    try {
      temporary.connection.db
        .insert(users)
        .values({
          id: "user-1",
          username: "admin",
          displayName: "Admin",
          role: "ADMIN",
          passwordHash: "not-a-real-password-hash",
          createdAt: now,
          updatedAt: now,
          rowVersion: 1,
        })
        .run();
      temporary.connection.db
        .insert(invoices)
        .values({
          id: "invoice-1",
          invoiceNumber: "OI-2026-00001",
          invoiceDate: "2026-08-26",
          currencyCode: "SDG",
          currencySymbol: "SDG",
          currencyDecimals: 2,
          grandTotalMinor: amount,
          remainingMinor: amount,
          createdAt: now,
          createdBy: "user-1",
          updatedAt: now,
          updatedBy: "user-1",
          rowVersion: 1,
        })
        .run();

      const stored = temporary.connection.db
        .select({ grandTotalMinor: invoices.grandTotalMinor })
        .from(invoices)
        .where(eq(invoices.id, "invoice-1"))
        .get();

      expect(stored?.grandTotalMinor).toBe(amount);
      expect(typeof stored?.grandTotalMinor).toBe("bigint");
    } finally {
      temporary.dispose();
    }
  });
});
