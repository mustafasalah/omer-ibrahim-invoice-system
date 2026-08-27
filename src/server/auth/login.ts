import "server-only";

import { createHash } from "node:crypto";
import type { Role } from "@/domain/auth/capabilities";
import type { LoginInput } from "@/domain/auth/contracts";
import { isPasswordLengthAllowed, parseLoginInput } from "@/domain/auth/credentials";
import { getDatabase, type DatabaseConnection } from "@/server/db/connection";
import { withImmediateTransaction } from "@/server/db/transaction";
import { invalidCredentialsError, loginRateLimitedError } from "@/server/http/errors";
import { verifyPassword } from "./password";
import { createSessionToken, insertSession, type CreatedSession } from "./sessions";

export const LOGIN_FAILURES_BEFORE_LOCK = 5;
export const LOGIN_MAX_LOCK_SECONDS = 15 * 60;

type LoginUserRow = {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  passwordHash: string;
  isActive: bigint;
  mustChangePassword: bigint;
  failedLoginCount: bigint;
  lockedUntil: string | null;
};

type MissingAttempt = {
  failedCount: number;
  lockedUntilMs: number;
  touchedAtMs: number;
};

const missingLoginAttempts = new Map<string, MissingAttempt>();

function lookupUser(connection: DatabaseConnection, username: string): LoginUserRow | undefined {
  return connection.client
    .prepare(
      `select id, username, display_name as displayName, role, password_hash as passwordHash,
              is_active as isActive, must_change_password as mustChangePassword,
              failed_login_count as failedLoginCount, locked_until as lockedUntil
       from users where username = ? collate nocase`,
    )
    .get(username) as LoginUserRow | undefined;
}

function lockSecondsForFailureCount(failedCount: number): number {
  if (failedCount < LOGIN_FAILURES_BEFORE_LOCK) {
    return 0;
  }

  return Math.min(
    LOGIN_MAX_LOCK_SECONDS,
    30 * 2 ** (failedCount - LOGIN_FAILURES_BEFORE_LOCK),
  );
}

function retryAfterSeconds(lockedUntil: string | number | null, nowMs: number): number {
  const lockedUntilMs =
    typeof lockedUntil === "number" ? lockedUntil : lockedUntil ? Date.parse(lockedUntil) : 0;
  return Math.max(0, Math.ceil((lockedUntilMs - nowMs) / 1_000));
}

function missingAttemptKey(username: string): string {
  return createHash("sha256").update(username || "[invalid-username]").digest("base64url");
}

function pruneMissingAttempts(nowMs: number): void {
  if (missingLoginAttempts.size < 1_000) {
    return;
  }

  for (const [key, value] of missingLoginAttempts) {
    if (nowMs - value.touchedAtMs > 24 * 60 * 60 * 1_000) {
      missingLoginAttempts.delete(key);
    }
  }

  if (missingLoginAttempts.size >= 1_000) {
    const oldestKey = missingLoginAttempts.keys().next().value as string | undefined;
    if (oldestKey) {
      missingLoginAttempts.delete(oldestKey);
    }
  }
}

function recordMissingFailure(username: string, nowMs: number): number {
  pruneMissingAttempts(nowMs);
  const key = missingAttemptKey(username);
  const previous = missingLoginAttempts.get(key);
  const failedCount = (previous?.failedCount ?? 0) + 1;
  const lockSeconds = lockSecondsForFailureCount(failedCount);

  missingLoginAttempts.set(key, {
    failedCount,
    lockedUntilMs: nowMs + lockSeconds * 1_000,
    touchedAtMs: nowMs,
  });

  return lockSeconds;
}

function getMissingRetryAfter(username: string, nowMs: number): number {
  const attempt = missingLoginAttempts.get(missingAttemptKey(username));
  return attempt ? retryAfterSeconds(attempt.lockedUntilMs, nowMs) : 0;
}

export function resetMissingLoginAttemptsForTests(): void {
  missingLoginAttempts.clear();
}

function safeClientLabel(value: string | null): string | null {
  if (!value) {
    return null;
  }

  return value.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 120) || null;
}

function recordExistingFailure(
  connection: DatabaseConnection,
  userId: string,
  now: Date,
): number {
  return withImmediateTransaction(connection.client, () => {
    const current = connection.client
      .prepare("select failed_login_count as failedLoginCount from users where id = ?")
      .get(userId) as { failedLoginCount: bigint } | undefined;

    if (!current) {
      return 0;
    }

    const failedCount = Number(current.failedLoginCount) + 1;
    const lockSeconds = lockSecondsForFailureCount(failedCount);
    const lockedUntil =
      lockSeconds > 0 ? new Date(now.getTime() + lockSeconds * 1_000).toISOString() : null;

    connection.client
      .prepare(
        `update users
         set failed_login_count = ?, locked_until = ?, updated_at = ?, row_version = row_version + 1
         where id = ?`,
      )
      .run(failedCount, lockedUntil, now.toISOString(), userId);

    return lockSeconds;
  });
}

export async function login(options: {
  connection?: DatabaseConnection;
  input: unknown;
  now?: Date;
  clientLabel?: string | null;
}): Promise<CreatedSession> {
  const connection = options.connection ?? getDatabase();
  const now = options.now ?? new Date();
  const nowMs = now.getTime();
  const parsed: LoginInput | undefined = parseLoginInput(options.input);
  const username = parsed?.username ?? "";
  const suppliedPassword = parsed?.password ?? "";
  const passwordCandidate = isPasswordLengthAllowed(suppliedPassword)
    ? suppliedPassword
    : "oims-invalid-password-candidate";
  const user = username ? lookupUser(connection, username) : undefined;
  const passwordValid = await verifyPassword(user?.passwordHash, passwordCandidate);
  const existingRetryAfter = user ? retryAfterSeconds(user.lockedUntil, nowMs) : 0;
  const missingRetryAfter = user ? 0 : getMissingRetryAfter(username, nowMs);
  const retryAfter = Math.max(existingRetryAfter, missingRetryAfter);

  if (retryAfter > 0) {
    throw loginRateLimitedError(retryAfter);
  }

  if (!user || user.isActive !== 1n || !passwordValid || !isPasswordLengthAllowed(suppliedPassword)) {
    const lockSeconds = user
      ? recordExistingFailure(connection, user.id, now)
      : recordMissingFailure(username, nowMs);

    if (lockSeconds > 0) {
      throw loginRateLimitedError(lockSeconds);
    }

    throw invalidCredentialsError();
  }

  const token = createSessionToken();
  const result = withImmediateTransaction(connection.client, () => {
    const current = lookupUser(connection, user.username);

    if (!current || current.isActive !== 1n || retryAfterSeconds(current.lockedUntil, nowMs) > 0) {
      return undefined;
    }

    connection.client
      .prepare(
        `update users
         set failed_login_count = 0, locked_until = null, last_login_at = ?,
             updated_at = ?, updated_by = id, row_version = row_version + 1
         where id = ?`,
      )
      .run(now.toISOString(), now.toISOString(), current.id);

    return insertSession({
      connection,
      token,
      now,
      clientLabel: safeClientLabel(options.clientLabel ?? null),
      user: {
        id: current.id,
        username: current.username,
        displayName: current.displayName,
        role: current.role,
        mustChangePassword: current.mustChangePassword === 1n,
      },
    });
  });

  if (!result) {
    throw invalidCredentialsError();
  }

  return result;
}
