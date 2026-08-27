import { afterEach, describe, expect, it } from "vitest";
import { hashPassword } from "@/server/auth/password";
import { requireCapability, requireSession, insertSession } from "@/server/auth/sessions";
import { AppError, apiErrorCodes } from "@/server/http/errors";
import { createTestAdmin } from "../fixtures/auth";
import { createTemporaryDatabase, type TemporaryDatabase } from "../fixtures/database";

let temporary: TemporaryDatabase | undefined;

afterEach(() => {
  temporary?.dispose();
  temporary = undefined;
});

describe("server-side authorization helpers", () => {
  it("returns 401 semantics when no valid session exists", () => {
    temporary = createTemporaryDatabase();

    expect(() =>
      requireSession(new Request("http://127.0.0.1/private"), {
        connection: temporary?.connection,
      }),
    ).toThrowError(AppError);

    try {
      requireSession(new Request("http://127.0.0.1/private"), {
        connection: temporary.connection,
      });
    } catch (error) {
      expect(error).toMatchObject({ code: apiErrorCodes.UNAUTHORIZED, status: 401 });
    }
  });

  it("returns 403 semantics for a valid employee session without an admin capability", async () => {
    temporary = createTemporaryDatabase();
    await createTestAdmin(temporary.connection);
    const now = new Date("2026-08-27T12:00:00.000Z");
    const employeeId = "01KEMPLOYEE000000000000000";
    const passwordHash = await hashPassword("موظف بكلمة قوية 2026");
    temporary.connection.client
      .prepare(
        `insert into users
         (id, username, display_name, role, password_hash, is_active, must_change_password,
          failed_login_count, created_at, updated_at, row_version)
         values (?, ?, ?, 'EMPLOYEE', ?, 1, 0, 0, ?, ?, 1)`,
      )
      .run(employeeId, "employee", "موظف اختبار", passwordHash, now.toISOString(), now.toISOString());
    const session = insertSession({
      connection: temporary.connection,
      token: "employee-test-token-with-sufficient-entropy-123456",
      now,
      user: {
        id: employeeId,
        username: "employee",
        displayName: "موظف اختبار",
        role: "EMPLOYEE",
        mustChangePassword: false,
      },
    });
    const request = new Request("http://127.0.0.1/private", {
      headers: { cookie: `oims_session=${session.token}` },
    });

    expect(() =>
      requireCapability(request, "settings.manage", {
        connection: temporary?.connection,
        now,
      }),
    ).toThrowError(AppError);

    try {
      requireCapability(request, "settings.manage", { connection: temporary.connection, now });
    } catch (error) {
      expect(error).toMatchObject({ code: apiErrorCodes.FORBIDDEN, status: 403 });
    }
  });
});
