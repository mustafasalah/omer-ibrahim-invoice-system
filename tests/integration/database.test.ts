import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
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
        "invoice_idempotency_records",
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
      expect(migrationCount.count).toBe(2n);
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
        schemaVersion: 2,
      });

      const rawInteger = temporary.connection.client.prepare("select 1 as value").get() as {
        value: bigint;
      };
      expect(rawInteger.value).toBe(1n);
    } finally {
      temporary.dispose();
    }
  });

  it("upgrades schema version 1, removes legacy replay data, and preserves the audit event", () => {
    const temporaryRoot = path.resolve(tmpdir());
    const directory = mkdtempSync(path.join(temporaryRoot, "oims-v1-upgrade-test-"));
    const versionOneMigrations = path.join(directory, "v1-migrations");
    const versionOneMeta = path.join(versionOneMigrations, "meta");
    const currentMigrations = path.resolve(process.cwd(), "drizzle");
    const connection = openDatabase(path.join(directory, "version-one.sqlite"));

    try {
      mkdirSync(versionOneMeta, { recursive: true });
      copyFileSync(
        path.join(currentMigrations, "0000_supreme_blink.sql"),
        path.join(versionOneMigrations, "0000_supreme_blink.sql"),
      );

      const currentJournal = JSON.parse(
        readFileSync(path.join(currentMigrations, "meta", "_journal.json"), "utf8"),
      ) as {
        dialect: string;
        entries: Array<Record<string, unknown>>;
        version: string;
      };
      writeFileSync(
        path.join(versionOneMeta, "_journal.json"),
        `${JSON.stringify(
          {
            ...currentJournal,
            entries: currentJournal.entries.slice(0, 1),
          },
          null,
          2,
        )}\n`,
        "utf8",
      );

      migrateDatabase(connection, versionOneMigrations);

      const versionOneMigrationCount = connection.client
        .prepare("select count(*) as count from __drizzle_migrations")
        .get() as { count: bigint };
      const idempotencyTableBeforeUpgrade = connection.client
        .prepare(
          "select count(*) as count from sqlite_master where type = 'table' and name = 'invoice_idempotency_records'",
        )
        .get() as { count: bigint };

      expect(versionOneMigrationCount.count).toBe(1n);
      expect(idempotencyTableBeforeUpgrade.count).toBe(0n);

      const now = "2026-08-26T00:00:00.000Z";
      connection.client
        .prepare(
          `insert into users (
            id, username, display_name, role, password_hash, created_at, updated_at
          ) values (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run("legacy-user", "legacy-admin", "Legacy Admin", "ADMIN", "legacy-hash", now, now);
      connection.client
        .prepare(
          `insert into invoices (
            id, invoice_number, invoice_date, currency_code, currency_symbol,
            currency_decimals, created_at, created_by, updated_at, updated_by
          ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          "legacy-invoice",
          "OI-2026-00001",
          "2026-08-26",
          "SDG",
          "SDG",
          2,
          now,
          "legacy-user",
          now,
          "legacy-user",
        );

      const legacyChanges = {
        invoiceStatus: { before: null, after: "DRAFT" },
        createIdempotencyKey: "legacy-raw-idempotency-key",
        createReplay: {
          version: 1,
          result: {
            invoice: {
              id: "legacy-invoice",
              beneficiary: { name: "Sensitive beneficiary" },
              items: [{ description: "Sensitive item", unitPrice: "99.99" }],
            },
            totals: { grandTotal: "99.99" },
          },
        },
        retainedMetadata: { source: "milestone-one", keep: true },
        nestedMetadata: { createReplay: "this nested unrelated value must remain" },
      };
      connection.client
        .prepare(
          `insert into audit_logs (
            id, event_type, actor_user_id, actor_display_name, invoice_id,
            invoice_number, entity_type, entity_id, summary, changes_json,
            created_at, request_id
          ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          "legacy-audit",
          "INVOICE_CREATED",
          "legacy-user",
          "Legacy Admin",
          "legacy-invoice",
          "OI-2026-00001",
          "INVOICE",
          "legacy-invoice",
          "Legacy invoice created",
          JSON.stringify(legacyChanges),
          now,
          "legacy-request",
        );

      migrateDatabase(connection, currentMigrations);

      const upgradedMigrationCount = connection.client
        .prepare("select count(*) as count from __drizzle_migrations")
        .get() as { count: bigint };
      const idempotencyRecordCount = connection.client
        .prepare("select count(*) as count from invoice_idempotency_records")
        .get() as { count: bigint };
      const storedAudit = connection.client
        .prepare("select event_type, summary, changes_json from audit_logs where id = ?")
        .get("legacy-audit") as {
        changes_json: string;
        event_type: string;
        summary: string;
      };

      expect(upgradedMigrationCount.count).toBe(2n);
      expect(idempotencyRecordCount.count).toBe(0n);
      expect(storedAudit.event_type).toBe("INVOICE_CREATED");
      expect(storedAudit.summary).toBe("Legacy invoice created");
      expect(JSON.parse(storedAudit.changes_json)).toEqual({
        invoiceStatus: { before: null, after: "DRAFT" },
        retainedMetadata: { source: "milestone-one", keep: true },
        nestedMetadata: { createReplay: "this nested unrelated value must remain" },
      });

      expect(() =>
        connection.client
          .prepare("update audit_logs set summary = ? where id = ?")
          .run("changed", "legacy-audit"),
      ).toThrow(/append-only/);
      expect(() =>
        connection.client.prepare("delete from audit_logs where id = ?").run("legacy-audit"),
      ).toThrow(/append-only/);

      migrateDatabase(connection, currentMigrations);

      const afterSecondMigration = connection.client
        .prepare("select count(*) as count from __drizzle_migrations")
        .get() as { count: bigint };
      const auditAfterSecondMigration = connection.client
        .prepare("select count(*) as count from audit_logs where id = ?")
        .get("legacy-audit") as { count: bigint };

      expect(afterSecondMigration.count).toBe(2n);
      expect(auditAfterSecondMigration.count).toBe(1n);
      expect(checkDatabase(connection).schemaVersion).toBe(2);
    } finally {
      connection.client.close();
      const resolvedDirectory = path.resolve(directory);
      const relative = path.relative(temporaryRoot, resolvedDirectory);

      if (relative.startsWith("..") || path.isAbsolute(relative) || relative === "") {
        throw new Error("Refusing to remove a directory outside the test temp root.");
      }

      rmSync(resolvedDirectory, { force: true, recursive: true });
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
