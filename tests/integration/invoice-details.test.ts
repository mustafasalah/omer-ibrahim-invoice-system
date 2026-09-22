import { afterEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/invoices/[id]/route";
import { createSessionToken, insertSession } from "@/server/auth/sessions";
import { apiErrorCodes } from "@/server/http/errors";
import { createInvoiceDraft as createInvoiceDraftService, createIssuedInvoice,
  getInvoiceDraft } from "@/server/invoices/service";
import { createTestAdmin } from "../fixtures/auth";
import { createTemporaryDatabase, type TemporaryDatabase } from "../fixtures/database";

let temporary: TemporaryDatabase | undefined;

type CreateDraftOptions = Parameters<typeof createInvoiceDraftService>[0];
function createInvoiceDraft(options: Omit<CreateDraftOptions, "idempotencyKey">) {
  return createInvoiceDraftService({ ...options, idempotencyKey: `test-details-${options.requestId}` });
}

afterEach(() => {
  globalThis.__oimsDatabaseConnection = undefined;
  temporary?.dispose();
  temporary = undefined;
});

const invoiceInput = {
  invoiceDate: "2026-09-10",
  dueDate: "2026-09-20",
  beneficiary: {
    name: "مستشفى اللقطة",
    phone: "+249 111 222",
    address: "الخرطوم - السوق العربي",
    registrationNumber: "REG-44",
  },
  items: [{ productName: "شاش تاريخي", description: "عبوة محفوظة", unit: "علبة", quantity: "2.5", unitPrice: "40" }],
  notes: "ملاحظات الفاتورة الأصلية",
  paymentTerms: "الدفع خلال عشرة أيام",
};

function insertEmployee(connection: TemporaryDatabase["connection"], now: Date) {
  connection.client.prepare(`insert into users (id,username,display_name,role,password_hash,is_active,
    must_change_password,failed_login_count,created_at,updated_at,row_version)
    values ('employee-reader','employee.reader','موظف القراءة','EMPLOYEE','unused',1,0,0,?,?,1)`)
    .run(now.toISOString(), now.toISOString());
  return {
    id: "employee-reader",
    username: "employee.reader",
    displayName: "موظف القراءة",
    role: "EMPLOYEE" as const,
    mustChangePassword: false,
  };
}

describe("invoice detail reads", () => {
  it("reads DRAFT and ISSUED snapshots, metadata, source, and money as strings", async () => {
    temporary = createTemporaryDatabase();
    globalThis.__oimsDatabaseConnection = temporary.connection;
    const now = new Date("2026-09-10T10:00:00.000Z");
    const admin = await createTestAdmin(temporary.connection, { now });
    const actor = { id: admin.id, displayName: admin.displayName, role: admin.role };

    const source = createInvoiceDraft({ connection: temporary.connection, actor, requestId: "details-source",
      now, input: { intent: "SAVE_DRAFT", invoice: { ...invoiceInput, items: [] } } }).invoice;
    const issued = createIssuedInvoice({ connection: temporary.connection, actor, requestId: "details-issued",
      now, input: { intent: "ISSUE", invoice: invoiceInput } }).invoice;
    temporary.connection.client.prepare("update invoices set copied_from_invoice_id=? where id=?")
      .run(source.id, issued.id);

    expect(getInvoiceDraft(source.id, { connection: temporary.connection })).toMatchObject({
      invoiceStatus: "DRAFT",
      printSnapshot: null,
      sourceInvoice: null,
    });

    temporary.connection.client.prepare(`update beneficiaries set name='اسم اقتراح جديد',phone='000',address='عنوان جديد'
      where id=?`).run(issued.beneficiary.suggestionId);
    temporary.connection.client.prepare(`update products set name='منتج اقتراح جديد',description='وصف جديد',unit='قطعة'
      where id=?`).run(issued.items[0]?.productSuggestionId);
    temporary.connection.client.prepare(`update app_settings set currency_code='USD',currency_symbol_ar='$',
      company_name_ar='منشأة لاحقة' where id='default'`).run();

    const details = getInvoiceDraft(issued.id, { connection: temporary.connection });
    expect(details).toMatchObject({
      invoiceStatus: "ISSUED",
      paymentStatus: "UNPAID",
      isArchived: false,
      beneficiary: { name: "مستشفى اللقطة", phone: "+249 111 222", address: "الخرطوم - السوق العربي" },
      currency: { code: "SDG", symbol: "ج.س", decimals: 2 },
      items: [{ sortOrder: 0, productName: "شاش تاريخي", description: "عبوة محفوظة", unit: "علبة",
        quantity: "2.5", unitPrice: "40", lineTotalMinor: "10000" }],
      totals: { grandTotalMinor: "10000", grossPaidMinor: "0", refundedTotalMinor: "0",
        netCollectedMinor: "0", remainingMinor: "10000" },
      createdBy: { id: admin.id, displayName: admin.displayName },
      updatedBy: { id: admin.id, displayName: admin.displayName },
      issuedBy: { id: admin.id, displayName: admin.displayName },
      sourceInvoice: { id: source.id, invoiceNumber: source.invoiceNumber },
      printSnapshot: { address: null, paperFormat: "A4", capturedAt: details.issuedAt },
    });
    expect(details.printSnapshot?.companyNameAr).toBe(issued.printSnapshot?.companyNameAr);
    expect(typeof details.totals.grandTotalMinor).toBe("string");
    expect(typeof details.items[0]?.lineTotalMinor).toBe("string");
  });

  it("allows an employee to read another user's invoice and returns safe 401/404 contracts", async () => {
    temporary = createTemporaryDatabase();
    globalThis.__oimsDatabaseConnection = temporary.connection;
    const now = new Date();
    const admin = await createTestAdmin(temporary.connection, { now });
    const issued = createIssuedInvoice({ connection: temporary.connection,
      actor: { id: admin.id, displayName: admin.displayName, role: admin.role }, requestId: "other-user-invoice",
      now, input: { intent: "ISSUE", invoice: invoiceInput } }).invoice;

    const unauthorized = await GET(new Request(`http://127.0.0.1:3000/api/invoices/${issued.id}`, {
      headers: { "x-request-id": "details-401" },
    }));
    expect(unauthorized.status).toBe(401);
    await expect(unauthorized.json()).resolves.toMatchObject({ error: {
      code: apiErrorCodes.UNAUTHORIZED,
      requestId: "details-401",
    } });

    const employee = insertEmployee(temporary.connection, now);
    const token = createSessionToken();
    insertSession({ connection: temporary.connection, user: employee, token, now });
    const headers = { cookie: `oims_session=${token}`, "x-request-id": "details-reader" };
    const response = await GET(new Request(`http://127.0.0.1:3000/api/invoices/${issued.id}`, { headers }));
    expect(response.status).toBe(200);
    const body = await response.json() as { invoice: { createdBy: { id: string }; totals: Record<string, unknown> }; requestId: string };
    expect(body).toMatchObject({ invoice: { createdBy: { id: admin.id } }, requestId: "details-reader" });
    expect(Object.values(body.invoice.totals).every((value) => typeof value === "string")).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/password|token|hash|sql|relativePath|normalizedName|phonesJson/iu);

    const missing = await GET(new Request("http://127.0.0.1:3000/api/invoices/01K00000000000000000000000", { headers }));
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toMatchObject({ error: {
      code: apiErrorCodes.NOT_FOUND,
      requestId: "details-reader",
    } });
  });
});
