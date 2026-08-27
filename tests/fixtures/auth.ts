import type { DatabaseConnection } from "@/server/db/connection";
import { bootstrapFirstAdmin } from "@/server/auth/bootstrap";

export const TEST_ADMIN_PASSWORD = "عبارة مرور إدارية 2026";

export async function createTestAdmin(
  connection: DatabaseConnection,
  overrides: Partial<{
    username: string;
    displayName: string;
    password: string;
    now: Date;
  }> = {},
) {
  const password = overrides.password ?? TEST_ADMIN_PASSWORD;
  return bootstrapFirstAdmin({
    connection,
    input: {
      username: overrides.username ?? "Admin.Local",
      displayName: overrides.displayName ?? "مدير الاختبار",
      password,
      passwordConfirmation: password,
    },
    isLoopback: true,
    requestId: "test-bootstrap-request",
    now: overrides.now ?? new Date("2026-08-27T08:00:00.000Z"),
  });
}
