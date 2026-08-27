import { expect, test } from "@playwright/test";

test("serves the Arabic RTL shell and a healthy local database", async ({ request }) => {
  const homeResponse = await request.get("/");
  expect(homeResponse.ok()).toBe(true);
  const html = await homeResponse.text();
  expect(html).toContain('<html lang="ar" dir="rtl">');

  const healthResponse = await request.get("/api/health", {
    headers: { "x-request-id": "e2e-health" },
  });
  expect(healthResponse.ok()).toBe(true);
  expect(healthResponse.headers()["x-request-id"]).toBe("e2e-health");
  await expect(healthResponse.json()).resolves.toMatchObject({
    status: "ok",
    checks: { database: "ok", schemaVersion: 1 },
    requestId: "e2e-health",
  });
});
