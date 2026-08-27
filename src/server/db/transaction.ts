import "server-only";

import type Database from "better-sqlite3";
import { getMessages } from "@/i18n";
import {
  AppError,
  apiErrorCodes,
  conflictError,
  databaseBusyError,
  validationError,
} from "@/server/http/errors";

type SqliteErrorLike = Error & { code?: string };

function hasSqliteCode(error: unknown): error is SqliteErrorLike {
  return error instanceof Error && "code" in error;
}

export function classifyDatabaseError(error: unknown): Error {
  if (error instanceof AppError) {
    return error;
  }

  if (hasSqliteCode(error)) {
    if (error.code === "SQLITE_BUSY" || error.code === "SQLITE_LOCKED") {
      return databaseBusyError();
    }

    if (
      error.code === "SQLITE_CONSTRAINT_UNIQUE" ||
      error.code === "SQLITE_CONSTRAINT_PRIMARYKEY"
    ) {
      return conflictError();
    }

    if (error.code?.startsWith("SQLITE_CONSTRAINT")) {
      return validationError();
    }
  }

  return new AppError({
    code: apiErrorCodes.INTERNAL_ERROR,
    message: getMessages().errors.internal,
    status: 500,
  });
}

export function withImmediateTransaction<T>(
  client: Database.Database,
  operation: () => T,
): T {
  if (client.inTransaction) {
    throw new Error("Nested immediate transactions are not supported.");
  }

  try {
    client.exec("BEGIN IMMEDIATE");
    const result = operation();

    if (result instanceof Promise) {
      throw new TypeError("SQLite transaction callbacks must be synchronous.");
    }

    client.exec("COMMIT");
    return result;
  } catch (error) {
    if (client.inTransaction) {
      client.exec("ROLLBACK");
    }

    throw classifyDatabaseError(error);
  }
}
