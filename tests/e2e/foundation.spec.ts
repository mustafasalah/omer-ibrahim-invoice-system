import { expect, test } from "@playwright/test";

test("setup → administrator → login → protected page → logout", async ({ page, request }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/setup$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

  await page.getByLabel("الاسم الظاهر").fill("مدير النظام");
  await page.getByLabel("اسم المستخدم").fill("First.Admin");
  const setupPassword = page.getByLabel("كلمة المرور", { exact: true });
  await setupPassword.fill("عبارة مرور محلية 2026");
  await page.getByLabel("تأكيد كلمة المرور").fill("عبارة مرور محلية 2026");
  await expect(setupPassword).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "إظهار كلمة المرور" }).first().click();
  await expect(setupPassword).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "إخفاء كلمة المرور" }).first().click();
  await page.getByRole("button", { name: "إنشاء المدير", exact: true }).click();

  await expect(page).toHaveURL(/\/login$/);
  const bootstrapStatus = await request.get("/api/bootstrap/status");
  await expect(bootstrapStatus.json()).resolves.toEqual({ bootstrapRequired: false });

  await page.getByLabel("اسم المستخدم").fill("FIRST.ADMIN");
  const loginPassword = page.getByLabel("كلمة المرور", { exact: true });
  await loginPassword.fill("عبارة مرور محلية 2026");
  await page.route("**/api/auth/login", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 150));
    await route.continue();
  });
  await loginPassword.press("Enter");
  await expect(page.getByRole("button", { name: "جارٍ تسجيل الدخول…" })).toBeDisabled();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "لوحة التحكم" })).toBeVisible();
  await expect(page.getByText("مدير النظام", { exact: true })).toBeVisible();
  const authenticatedSession = await page.request.get("/api/auth/session");
  expect(authenticatedSession.status()).toBe(200);
  const sessionBody = JSON.stringify(await authenticatedSession.json());
  expect(sessionBody).not.toContain("عبارة مرور محلية 2026");
  expect(sessionBody).not.toContain("passwordHash");
  expect(sessionBody).not.toContain("sessionToken");
  expect(sessionBody).not.toContain("tokenHash");
  const browserStorage = await page.evaluate(() => ({
    local: Object.keys(localStorage),
    session: Object.keys(sessionStorage),
  }));
  expect(browserStorage).toEqual({ local: [], session: [] });

  await page.getByRole("button", { name: "تسجيل الخروج", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  const signedOutSession = await page.request.get("/api/auth/session");
  expect(signedOutSession.status()).toBe(401);

  await page.goto("/setup");
  await expect(page).toHaveURL(/\/login$/);

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
