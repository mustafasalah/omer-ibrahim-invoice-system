import { afterEach, describe, expect, it } from "vitest";
import { bootstrapFirstAdmin, getBootstrapStatus } from "@/server/auth/bootstrap";
import { login } from "@/server/auth/login";
import { apiErrorCodes } from "@/server/http/errors";
import { createTestAdmin, TEST_ADMIN_PASSWORD } from "../fixtures/auth";
import { createTemporaryDatabase, type TemporaryDatabase } from "../fixtures/database";

let temporary: TemporaryDatabase | undefined;

afterEach(() => {
  temporary?.dispose();
  temporary = undefined;
});

describe("first administrator bootstrap", () => {
  it("creates one normalized Argon2id administrator without an implicit session", async () => {
    temporary = createTemporaryDatabase();
    expect(getBootstrapStatus(temporary.connection)).toEqual({ bootstrapRequired: true });

    const admin = await createTestAdmin(temporary.connection);
    const user = temporary.connection.client
      .prepare(
        `select username, display_name as displayName, role, password_hash as passwordHash,
                must_change_password as mustChangePassword
         from users`,
      )
      .get() as {
      username: string;
      displayName: string;
      role: string;
      passwordHash: string;
      mustChangePassword: bigint;
    };
    const sessionCount = temporary.connection.client
      .prepare("select count(*) as count from sessions")
      .get() as { count: bigint };
    const audit = temporary.connection.client
      .prepare("select event_type as eventType, changes_json as changesJson from audit_logs")
      .get() as { eventType: string; changesJson: string };

    expect(admin).toMatchObject({ username: "admin.local", role: "ADMIN", mustChangePassword: false });
    expect(user.username).toBe("admin.local");
    expect(user.role).toBe("ADMIN");
    expect(user.mustChangePassword).toBe(0n);
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    expect(user.passwordHash).not.toContain(TEST_ADMIN_PASSWORD);
    expect(sessionCount.count).toBe(0n);
    expect(audit.eventType).toBe("ADMIN_BOOTSTRAPPED");
    expect(JSON.parse(audit.changesJson)).toEqual({ role: "ADMIN" });
    expect(audit.changesJson).not.toContain(TEST_ADMIN_PASSWORD);
    expect(audit.changesJson).not.toContain("$argon2id$");
    expect(getBootstrapStatus(temporary.connection)).toEqual({ bootstrapRequired: false });
  });

  it("normalizes Unicode Latin casing consistently for bootstrap uniqueness and login", async () => {
    temporary = createTemporaryDatabase();
    await createTestAdmin(temporary.connection, { username: "Équipe.Admin" });

    const stored = temporary.connection.client
      .prepare("select username from users")
      .get() as { username: string };
    const session = await login({
      connection: temporary.connection,
      input: { username: "ÉQUIPE.ADMIN", password: TEST_ADMIN_PASSWORD },
    });

    expect(stored.username).toBe("équipe.admin");
    expect(session.user.username).toBe("équipe.admin");
    expect(
      temporary.connection.client.prepare("select count(*) as count from users").get(),
    ).toEqual({ count: 1n });
  });

  it("rejects non-loopback bootstrap before hashing or writing", async () => {
    temporary = createTemporaryDatabase();

    await expect(
      bootstrapFirstAdmin({
        connection: temporary.connection,
        input: {},
        isLoopback: false,
        requestId: "remote-bootstrap",
      }),
    ).rejects.toMatchObject({ code: apiErrorCodes.BOOTSTRAP_LOCAL_ONLY, status: 403 });

    expect(getBootstrapStatus(temporary.connection).bootstrapRequired).toBe(true);
  });

  it("serializes concurrent bootstrap attempts and commits exactly one administrator", async () => {
    temporary = createTemporaryDatabase();
    const input = {
      username: "ConcurrentAdmin",
      displayName: "مدير متزامن",
      password: TEST_ADMIN_PASSWORD,
      passwordConfirmation: TEST_ADMIN_PASSWORD,
    };

    const results = await Promise.allSettled([
      bootstrapFirstAdmin({
        connection: temporary.connection,
        input,
        isLoopback: true,
        requestId: "bootstrap-a",
      }),
      bootstrapFirstAdmin({
        connection: temporary.connection,
        input,
        isLoopback: true,
        requestId: "bootstrap-b",
      }),
    ]);
    const count = temporary.connection.client
      .prepare("select count(*) as count from users")
      .get() as { count: bigint };

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(count.count).toBe(1n);
    expect((results.find((result) => result.status === "rejected") as PromiseRejectedResult).reason)
      .toMatchObject({ code: apiErrorCodes.BOOTSTRAP_COMPLETE, status: 409 });
  });
});
