import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/domain/auth/capabilities", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/domain/auth/capabilities")>();
  return {
    ...actual,
    roleHasCapability: (role: Parameters<typeof actual.roleHasCapability>[0], capability: Parameters<typeof actual.roleHasCapability>[1]) =>
      capability === "invoice.read" ? false : actual.roleHasCapability(role, capability),
  };
});

import { GET } from "@/app/api/invoices/[id]/route";
import { createSessionToken, insertSession } from "@/server/auth/sessions";
import { apiErrorCodes } from "@/server/http/errors";
import { createTestAdmin } from "../fixtures/auth";
import { createTemporaryDatabase, type TemporaryDatabase } from "../fixtures/database";

let temporary: TemporaryDatabase | undefined;

afterEach(() => {
  globalThis.__oimsDatabaseConnection = undefined;
  temporary?.dispose();
  temporary = undefined;
});

describe("invoice details API capability enforcement", () => {
  it("returns the unified 403 contract when a valid session lacks invoice.read", async () => {
    temporary = createTemporaryDatabase();
    globalThis.__oimsDatabaseConnection = temporary.connection;
    const now = new Date();
    const admin = await createTestAdmin(temporary.connection, { now });
    const token = createSessionToken();
    insertSession({ connection: temporary.connection, user: admin, token, now });

    const response = await GET(new Request("http://127.0.0.1:3000/api/invoices/01K00000000000000000000000", {
      headers: { cookie: `oims_session=${token}`, "x-request-id": "details-403" },
    }));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: {
      code: apiErrorCodes.FORBIDDEN,
      requestId: "details-403",
    } });
  });
});
