import { expect, test, type Page } from "@playwright/test";

const externalRequestsByPage = new WeakMap<Page, string[]>();

function isAllowedOfflineUrl(value: string): boolean {
  if (value.startsWith("data:") || value.startsWith("blob:")) return true;

  try {
    const { hostname } = new URL(value);
    return hostname === "localhost"
      || hostname === "::1"
      || hostname === "[::1]"
      || /^127(?:\.\d{1,3}){3}$/u.test(hostname);
  } catch {
    return false;
  }
}

test.beforeEach(({ page }) => {
  const externalRequests: string[] = [];
  externalRequestsByPage.set(page, externalRequests);
  page.on("request", (browserRequest) => {
    if (!isAllowedOfflineUrl(browserRequest.url())) externalRequests.push(browserRequest.url());
  });
});

test.afterEach(({ page }) => {
  expect(
    externalRequestsByPage.get(page) ?? [],
    "The browser must not request non-loopback network resources during local operation.",
  ).toEqual([]);
});

test("setup → login → settings → create and edit draft → logout", async ({ page, request }) => {
  test.setTimeout(90_000);
  await page.goto("/");
  await expect(page).toHaveURL(/\/setup$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

  await page.getByLabel("الاسم الظاهر").fill("مدير النظام");
  await page.getByLabel("اسم المستخدم").fill("First.Admin");
  const setupPassword = page.getByLabel("كلمة المرور", { exact: true });
  await setupPassword.fill("عبارة مرور محلية 2026");
  await page.getByLabel("تأكيد كلمة المرور").fill("عبارة مرور محلية 2026");
  await page.getByRole("button", { name: "إظهار كلمة المرور" }).first().click();
  await expect(setupPassword).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "إخفاء كلمة المرور" }).first().click();
  await page.getByRole("button", { name: "إنشاء المدير", exact: true }).click();

  await expect(page).toHaveURL(/\/login$/);
  await expect((await request.get("/api/bootstrap/status")).json()).resolves.toEqual({ bootstrapRequired: false });
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

  const authenticatedSession = await page.request.get("/api/auth/session");
  expect(authenticatedSession.status()).toBe(200);
  const sessionBody = JSON.stringify(await authenticatedSession.json());
  expect(sessionBody).not.toMatch(/عبارة مرور محلية 2026|passwordHash|sessionToken|tokenHash/u);
  expect(await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) })))
    .toEqual({ local: [], session: [] });

  await page.getByRole("link", { name: "الإعدادات الأساسية" }).click();
  const prefixInput = page.getByLabel("بادئة الرقم");
  await prefixInput.focus();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("نمط الرقم")).toBeFocused();
  await prefixInput.fill("MED");
  await expect(page.getByText(/MED-\d{4}-00001/u)).toBeVisible();
  await page.getByLabel("العنوان").fill("الخرطوم");
  await page.getByRole("button", { name: "حفظ الإعدادات" }).click();
  await expect(page.getByRole("status")).toContainText("تم حفظ الإعدادات");
  await page.reload();
  await expect(page.getByLabel("العنوان")).toHaveValue("الخرطوم");
  await page.getByRole("link", { name: "العودة إلى لوحة التحكم" }).click();

  await page.keyboard.press("Alt+n");
  await expect(page).toHaveURL(/\/invoices\/new$/);
  await expect(page.getByRole("heading", { name: "فاتورة جديدة" })).toBeVisible();
  await expect(page.getByText("لم تُحفظ بعد", { exact: true })).toBeVisible();
  await expect(page.locator("main")).toHaveAttribute("data-row-version", "unsaved");

  const issueButton = page.getByRole("button", { name: "إصدار الفاتورة" });
  await expect(issueButton).toBeEnabled();
  await issueButton.click();
  const issueDialog = page.getByRole("dialog", { name: "تأكيد إصدار الفاتورة" });
  await expect(issueDialog).toContainText("ستصبح الفاتورة رسمية");
  await expect(issueDialog.getByRole("button", { name: "العودة إلى المحرر" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(issueDialog).toBeHidden();
  await expect(issueButton).toBeFocused();
  await issueButton.press("Enter");
  const confirmIssueButton = issueDialog.getByRole("button", { name: "تأكيد الإصدار" });
  await page.keyboard.press("Tab");
  await expect(confirmIssueButton).toBeFocused();
  await page.keyboard.press("Enter");
  const issueErrors = page.locator(".invoice-error-summary");
  await expect(issueErrors).toBeFocused();
  await expect(issueErrors).toContainText("تعذر إصدار الفاتورة");
  await expect(page).toHaveURL(/\/invoices\/new$/);
  await expect(page.getByText("لم تُحفظ بعد", { exact: true })).toBeVisible();
  const firstIssueError = issueErrors.getByRole("button").first();
  await page.keyboard.press("Tab");
  await expect(firstIssueError).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("اسم المستفيد")).toBeFocused();

  const directBeneficiaryName = page.getByLabel("اسم المستفيد");
  await directBeneficiaryName.focus();
  await page.keyboard.press("Alt+n");
  await expect(page).toHaveURL(/\/invoices\/new$/);
  await expect(directBeneficiaryName).toBeFocused();
  await directBeneficiaryName.fill("مستشفى الإصدار المباشر");
  await page.getByLabel("اسم المنتج").fill("عينة مباشرة");
  await page.getByLabel("الكمية").fill("1");
  await page.getByLabel("سعر الوحدة").fill("0");
  await page.route("**/api/invoices", async (route) => {
    if (route.request().method() === "POST" && (route.request().postDataJSON() as { intent?: string }).intent === "ISSUE") {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    await route.continue();
  }, { times: 1 });
  await issueButton.press("Enter");
  await page.keyboard.press("Tab");
  await expect(confirmIssueButton).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "جارٍ إصدار الفاتورة…" })).toBeDisabled();
  await expect(page).toHaveURL(/\/invoices\/[0-9A-HJKMNP-TV-Z]{26}$/u);
  await expect(page.locator("main[data-invoice-status]")).toHaveAttribute("data-invoice-status", "ISSUED");
  await expect(page.getByText("صادرة", { exact: true })).toBeVisible();
  await expect(page.getByText("غير مدفوعة", { exact: true })).toBeVisible();
  await expect(page.getByText("غير مؤرشفة", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "عينة مباشرة" })).toBeVisible();
  await expect(page.getByText("الملخص المالي", { exact: true })).toBeVisible();
  await expect(page.getByText("أنشأها", { exact: true })).toBeVisible();
  await expect(page.locator(".invoice-detail-snapshot")).toContainText("الخرطوم");
  await expect(page.locator(".invoice-detail-snapshot")).toContainText("A4");
  await expect(page.getByRole("link", { name: /تعديل|دفع|استرداد|إلغاء|أرشفة|طباعة|PDF/u })).toHaveCount(0);
  const directId = /\/invoices\/([^/]+)$/u.exec(new URL(page.url()).pathname)?.[1];
  const directResponse = await page.request.get(`/api/invoices/${directId}`);
  await expect(directResponse.json()).resolves.toMatchObject({ invoice: { invoiceStatus: "ISSUED", rowVersion: 1,
    totals: { grandTotalMinor: "0", remainingMinor: "0" }, printSnapshot: { capturedAt: expect.any(String) } } });

  await page.getByRole("link", { name: "العودة إلى لوحة التحكم" }).click();
  await page.getByRole("link", { name: "إنشاء فاتورة جديدة" }).click();
  await expect(page).toHaveURL(/\/invoices\/new$/);

  await page.getByLabel("اسم المستفيد").fill("مستشفى الأمل");
  const productNames = page.getByLabel("اسم المنتج");
  const quantities = page.getByLabel("الكمية");
  const prices = page.getByLabel("سعر الوحدة");
  await productNames.first().fill("شاش طبي");
  await productNames.first().focus();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("الوصف").first()).toBeFocused();
  await quantities.first().fill("1.25");
  await prices.first().fill("80.00");
  await expect(page.getByRole("complementary").getByText(/100\.00/u).first()).toBeVisible();
  await prices.first().press("Enter");
  await expect(productNames).toHaveCount(2);
  await productNames.nth(1).fill("بند غير مكتمل");
  await expect(page.locator(".invoice-item__hint")).toContainText("البند غير المكتمل لا يدخل في المعاينة");

  await page.getByRole("button", { name: "حفظ كمسودة" }).click();
  await expect(page).toHaveURL(/\/invoices\/[0-9A-HJKMNP-TV-Z]{26}\/edit(?:\?saved=1)?$/u);
  const editUrl = page.url();
  const invoiceId = /\/invoices\/([^/]+)\/edit/u.exec(new URL(editUrl).pathname)?.[1];
  expect(invoiceId).toBeTruthy();
  const firstSavedResponse = await page.request.get(`/api/invoices/${invoiceId}`);
  expect(firstSavedResponse.status()).toBe(200);
  const firstSaved = await firstSavedResponse.json() as { invoice: { invoiceNumber: string; rowVersion: number; items: unknown[]; totals: { grandTotalMinor: string } } };
  expect(firstSaved.invoice).toMatchObject({ rowVersion: 1, totals: { grandTotalMinor: "10000" } });
  expect(firstSaved.invoice.items).toHaveLength(2);
  const invoiceNumber = firstSaved.invoice.invoiceNumber;

  await page.goto(`/invoices/${invoiceId}`);
  await expect(page.locator("main[data-invoice-status]")).toHaveAttribute("data-invoice-status", "DRAFT");
  await expect(page.getByText("مسودة", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "تعديل المسودة" }).click();
  await expect(page).toHaveURL(/\/invoices\/[^/]+\/edit$/u);

  await page.reload();
  await expect(page.getByRole("heading", { name: "تعديل مسودة الفاتورة" })).toBeVisible();
  await expect(page.getByText(invoiceNumber, { exact: true })).toBeVisible();
  await expect(page.getByLabel("العملة")).toHaveValue(/SDG/u);
  await expect(page.getByLabel("اسم المستفيد")).toHaveValue("مستشفى الأمل");
  await quantities.first().fill("2.5");
  await page.route(`**/api/invoices/${invoiceId}`, async (route) => {
    if (route.request().method() === "PATCH") await new Promise((resolve) => setTimeout(resolve, 300));
    await route.continue();
  }, { times: 1 });
  const pendingNotes = page.getByRole("textbox", { name: /^ملاحظات/u });
  await page.getByRole("button", { name: "حفظ كمسودة" }).click();
  await expect(page.getByRole("button", { name: "جارٍ الحفظ…" })).toBeDisabled();
  await pendingNotes.fill("تغيير أحدث أثناء الحفظ");
  await expect(page.locator(".invoice-notice--success")).toContainText("حُفظت المسودة");
  await expect(pendingNotes).toHaveValue("تغيير أحدث أثناء الحفظ");
  const secondSavedResponse = await page.request.get(`/api/invoices/${invoiceId}`);
  const secondSaved = await secondSavedResponse.json() as { invoice: { invoiceNumber: string; rowVersion: number; totals: { grandTotalMinor: string } } };
  expect(secondSaved.invoice).toMatchObject({ invoiceNumber, rowVersion: firstSaved.invoice.rowVersion + 1, totals: { grandTotalMinor: "20000" } });

  const notes = page.getByRole("textbox", { name: /^ملاحظات/u });
  await notes.fill("مدخلاتي وقت التعارض");
  await page.route(`**/api/invoices/${invoiceId}/issue`, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({
      error: { code: "CONFLICT", message: "توجد نسخة أحدث.", fieldErrors: { rowVersion: "3" }, requestId: "e2e-conflict" },
    }) });
  }, { times: 1 });
  await page.getByRole("button", { name: "إصدار الفاتورة" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "تأكيد الإصدار" }).click();
  await expect(notes).toBeDisabled();
  await expect(quantities.first()).toBeDisabled();
  const conflictPanel = page.getByRole("alertdialog");
  await expect(conflictPanel).toContainText("توجد نسخة أحدث");
  await expect(conflictPanel).toBeFocused();
  const copyConflictInput = page.getByRole("button", { name: "نسخ مدخلاتي" });
  await copyConflictInput.focus();
  await page.keyboard.press("Enter");
  page.once("dialog", (prompt) => void prompt.accept());
  await page.getByRole("button", { name: "تحميل أحدث نسخة" }).click();
  await expect(page.getByRole("alertdialog")).toBeHidden();
  await expect(page.locator("main")).toHaveAttribute("data-row-version", "2");

  await notes.fill("حفظ بلوحة المفاتيح");
  const keyboardSave = page.waitForResponse((response) => response.url().includes(`/api/invoices/${invoiceId}`) && response.request().method() === "PATCH");
  await page.keyboard.press("Control+s");
  expect((await keyboardSave).ok()).toBe(true);
  await expect(page.locator("main")).toHaveAttribute("data-row-version", "3");

  await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
  await expect(page.getByRole("button", { name: "حفظ كمسودة" })).toBeVisible();
  await expect(page.getByRole("button", { name: "إصدار الفاتورة" })).toBeVisible();
  await page.evaluate(() => { document.documentElement.style.zoom = "1"; });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".invoice-item").first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  await notes.fill("تغيير غير محفوظ");
  const dialog = new Promise<string>((resolve) => page.once("dialog", async (prompt) => {
    resolve(prompt.type());
    await prompt.dismiss();
  }));
  await page.getByRole("link", { name: "لوحة التحكم", exact: true }).click();
  expect(await dialog).toBe("confirm");
  await expect(page).toHaveURL(/\/invoices\/[^/]+\/edit/u);
  await notes.fill("حفظ بلوحة المفاتيح");
  await quantities.nth(1).fill("2");
  await prices.nth(1).fill("5");
  const existingIssue = page.waitForResponse((response) => response.url().endsWith(`/api/invoices/${invoiceId}/issue`) && response.request().method() === "POST");
  await page.getByRole("button", { name: "إصدار الفاتورة" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "تأكيد الإصدار" }).click();
  const existingIssueResponse = await existingIssue;
  expect(existingIssueResponse.status(), await existingIssueResponse.text()).toBe(200);
  await expect(page).toHaveURL(new RegExp(`/invoices/${invoiceId}$`, "u"));
  const issuedDetailsUrl = page.url();
  await expect(page.getByText("صادرة", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: invoiceNumber })).toBeVisible();
  await expect(page.getByRole("heading", { name: "شاش طبي" })).toBeVisible();
  await expect(page.getByText("2.5", { exact: true })).toBeVisible();
  await expect(page.getByText("200.00 ج.س", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("مدير النظام", { exact: true }).first()).toBeVisible();
  await page.reload();
  await expect(page.locator("main[data-invoice-status]")).toHaveAttribute("data-invoice-status", "ISSUED");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
  await expect(page.getByText("الملخص المالي", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "شاش طبي" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.evaluate(() => { document.documentElement.style.zoom = "1"; });
  const backFromDetails = page.getByRole("link", { name: "العودة إلى لوحة التحكم" });
  await backFromDetails.focus();
  await expect(backFromDetails).toBeFocused();
  const issuedResponse = await page.request.get(`/api/invoices/${invoiceId}`);
  await expect(issuedResponse.json()).resolves.toMatchObject({ invoice: { invoiceStatus: "ISSUED", rowVersion: 4,
    items: [{ quantity: "2.5" }, { quantity: "2", unitPrice: "5" }], printSnapshot: { capturedAt: expect.any(String) } } });
  await backFromDetails.click();

  await page.getByRole("button", { name: "تسجيل الخروج", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect((await page.request.get("/api/auth/session")).status()).toBe(401);
  await page.goto(issuedDetailsUrl);
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/setup");
  await expect(page).toHaveURL(/\/login$/);

  const healthResponse = await request.get("/api/health", { headers: { "x-request-id": "e2e-health" } });
  expect(healthResponse.ok()).toBe(true);
  expect(healthResponse.headers()["x-request-id"]).toBe("e2e-health");
  await expect(healthResponse.json()).resolves.toMatchObject({ status: "ok", checks: { database: "ok", schemaVersion: 1 }, requestId: "e2e-health" });
});
