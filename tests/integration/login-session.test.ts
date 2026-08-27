import { afterEach, describe, expect, it } from "vitest";
import { apiErrorCodes, AppError } from "@/server/http/errors";
import { login, resetMissingLoginAttemptsForTests } from "@/server/auth/login";
import {
  hashSessionToken,
  logoutSession,
  resolveSessionToken,
  SESSION_ABSOLUTE_HOURS,
} from "@/server/auth/sessions";
import { createTestAdmin, TEST_ADMIN_PASSWORD } from "../fixtures/auth";
import { createTemporaryDatabase, type TemporaryDatabase } from "../fixtures/database";

let temporary: TemporaryDatabase | undefined;

afterEach(() => {
  resetMissingLoginAttemptsForTests();
  temporary?.dispose();
  temporary = undefined;
});

describe("login and database-backed sessions", () => {
  it("covers AT-AUTH-001 and stores only the session token hash", async () => {
    temporary = createTemporaryDatabase();
    await createTestAdmin(temporary.connection);
    const now = new Date("2026-08-27T09:00:00.000Z");
    const session = await login({
      connection: temporary.connection,
      input: { username: "ADMIN.LOCAL", password: TEST_ADMIN_PASSWORD },
      now,
      clientLabel: "Integration Test Browser\nignored",
    });
    const user = temporary.connection.client
      .prepare(
        "select last_login_at as lastLoginAt, failed_login_count as failedLoginCount from users",
      )
      .get() as { lastLoginAt: string; failedLoginCount: bigint };
    const stored = temporary.connection.client
      .prepare("select token_hash as tokenHash, client_label as clientLabel from sessions")
      .get() as { tokenHash: string; clientLabel: string };

    expect(user.lastLoginAt).toBe(now.toISOString());
    expect(user.failedLoginCount).toBe(0n);
    expect(session.token).toHaveLength(43);
    expect(stored.tokenHash).toBe(hashSessionToken(session.token));
    expect(stored.tokenHash).not.toBe(session.token);
    expect(stored.clientLabel).not.toContain("\n");
    const serializedUser = JSON.stringify(session.user);
    expect(serializedUser).not.toContain(TEST_ADMIN_PASSWORD);
    expect(serializedUser).not.toContain("passwordHash");
    expect(serializedUser).not.toContain("tokenHash");
  });

  it("covers AT-AUTH-002 with one message for a missing username and a wrong password", async () => {
    temporary = createTemporaryDatabase();
    await createTestAdmin(temporary.connection);

    const errors: AppError[] = [];
    for (const input of [
      { username: "admin.local", password: "wrong password value" },
      { username: "missing.user", password: "wrong password value" },
    ]) {
      try {
        await login({ connection: temporary.connection, input });
        throw new Error("Expected login failure.");
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        errors.push(error as AppError);
      }
    }

    expect(errors[0]).toMatchObject({ code: apiErrorCodes.INVALID_CREDENTIALS, status: 401 });
    expect(errors[1]).toMatchObject({ code: apiErrorCodes.INVALID_CREDENTIALS, status: 401 });
    expect(errors[0]?.message).toBe(errors[1]?.message);
  });

  it("covers AT-AUTH-003 and never creates a session for a disabled user", async () => {
    temporary = createTemporaryDatabase();
    await createTestAdmin(temporary.connection);
    temporary.connection.client.prepare("update users set is_active = 0").run();

    await expect(
      login({
        connection: temporary.connection,
        input: { username: "admin.local", password: TEST_ADMIN_PASSWORD },
      }),
    ).rejects.toMatchObject({ code: apiErrorCodes.INVALID_CREDENTIALS, status: 401 });

    const count = temporary.connection.client
      .prepare("select count(*) as count from sessions")
      .get() as { count: bigint };
    expect(count.count).toBe(0n);
  });

  it("rate limits progressively and allows a correct login after the lock expires", async () => {
    temporary = createTemporaryDatabase();
    await createTestAdmin(temporary.connection);
    const now = new Date("2026-08-27T10:00:00.000Z");

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      await expect(
        login({
          connection: temporary.connection,
          input: { username: "admin.local", password: "incorrect password" },
          now,
        }),
      ).rejects.toMatchObject({ code: apiErrorCodes.INVALID_CREDENTIALS });
    }

    await expect(
      login({
        connection: temporary.connection,
        input: { username: "admin.local", password: "incorrect password" },
        now,
      }),
    ).rejects.toMatchObject({ code: apiErrorCodes.LOGIN_RATE_LIMITED, status: 429 });

    await expect(
      login({
        connection: temporary.connection,
        input: { username: "admin.local", password: "another wrong password" },
        now: new Date(now.getTime() + 31_000),
      }),
    ).rejects.toMatchObject({ code: apiErrorCodes.LOGIN_RATE_LIMITED, status: 429 });

    await expect(
      login({
        connection: temporary.connection,
        input: { username: "admin.local", password: TEST_ADMIN_PASSWORD },
        now: new Date(now.getTime() + 90_000),
      }),
    ).rejects.toMatchObject({ code: apiErrorCodes.LOGIN_RATE_LIMITED });

    const session = await login({
      connection: temporary.connection,
      input: { username: "admin.local", password: TEST_ADMIN_PASSWORD },
      now: new Date(now.getTime() + 92_000),
    });
    const user = temporary.connection.client
      .prepare("select failed_login_count as count, locked_until as lockedUntil from users")
      .get() as { count: bigint; lockedUntil: string | null };

    expect(session.user.username).toBe("admin.local");
    expect(user).toEqual({ count: 0n, lockedUntil: null });
  });

  it("enforces idle expiry, absolute expiry, revocation, and inactive users", async () => {
    temporary = createTemporaryDatabase();
    const start = new Date("2026-08-27T11:00:00.000Z");
    await createTestAdmin(temporary.connection, { now: start });

    const idleSession = await login({
      connection: temporary.connection,
      input: { username: "admin.local", password: TEST_ADMIN_PASSWORD },
      now: start,
    });
    expect(
      resolveSessionToken({
        connection: temporary.connection,
        token: idleSession.token,
        now: new Date(start.getTime() + 60_000),
      }),
    ).toBeDefined();
    const untouched = temporary.connection.client
      .prepare("select last_seen_at as lastSeenAt from sessions where id = ?")
      .get(idleSession.id) as { lastSeenAt: string };
    expect(untouched.lastSeenAt).toBe(start.toISOString());

    expect(
      resolveSessionToken({
        connection: temporary.connection,
        token: idleSession.token,
        now: new Date(start.getTime() + 29 * 60_000),
      }),
    ).toBeDefined();
    const touched = temporary.connection.client
      .prepare("select last_seen_at as lastSeenAt from sessions where id = ?")
      .get(idleSession.id) as { lastSeenAt: string };
    expect(touched.lastSeenAt).toBe(new Date(start.getTime() + 29 * 60_000).toISOString());

    const idleExpired = await login({
      connection: temporary.connection,
      input: { username: "admin.local", password: TEST_ADMIN_PASSWORD },
      now: start,
    });
    expect(
      resolveSessionToken({
        connection: temporary.connection,
        token: idleExpired.token,
        now: new Date(start.getTime() + 31 * 60_000),
      }),
    ).toBeUndefined();

    const absoluteSession = await login({
      connection: temporary.connection,
      input: { username: "admin.local", password: TEST_ADMIN_PASSWORD },
      now: start,
    });
    temporary.connection.client
      .prepare("update sessions set expires_at = ? where id = ?")
      .run(new Date(start.getTime() + 24 * 60 * 60_000).toISOString(), absoluteSession.id);
    expect(
      resolveSessionToken({
        connection: temporary.connection,
        token: absoluteSession.token,
        now: new Date(start.getTime() + SESSION_ABSOLUTE_HOURS * 60 * 60_000),
      }),
    ).toBeUndefined();

    const revokedSession = await login({
      connection: temporary.connection,
      input: { username: "admin.local", password: TEST_ADMIN_PASSWORD },
      now: start,
    });
    logoutSession({ connection: temporary.connection, token: revokedSession.token, now: start });
    expect(
      resolveSessionToken({ connection: temporary.connection, token: revokedSession.token, now: start }),
    ).toBeUndefined();

    const inactiveSession = await login({
      connection: temporary.connection,
      input: { username: "admin.local", password: TEST_ADMIN_PASSWORD },
      now: start,
    });
    temporary.connection.client.prepare("update users set is_active = 0").run();
    expect(
      resolveSessionToken({ connection: temporary.connection, token: inactiveSession.token, now: start }),
    ).toBeUndefined();
  });
});
