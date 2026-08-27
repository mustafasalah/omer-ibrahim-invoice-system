import { afterEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/health/route";
import { createTemporaryDatabase, type TemporaryDatabase } from "../fixtures/database";

let temporary: TemporaryDatabase | undefined;

afterEach(() => {
  globalThis.__oimsDatabaseConnection = undefined;
  temporary?.dispose();
  temporary = undefined;
});

describe("GET /api/health", () => {
  it("reports local database readiness with a safe request ID", async () => {
    temporary = createTemporaryDatabase();
    globalThis.__oimsDatabaseConnection = temporary.connection;

    const response = await GET(
      new Request("http://127.0.0.1/api/health", {
        headers: { "x-request-id": "health-test-1" },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-request-id")).toBe("health-test-1");
    await expect(response.json()).resolves.toMatchObject({
      status: "ok",
      checks: { database: "ok", schemaVersion: 1 },
      requestId: "health-test-1",
    });
  });
});
