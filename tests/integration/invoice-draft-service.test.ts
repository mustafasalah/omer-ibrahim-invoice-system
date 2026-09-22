import { afterEach, describe, expect, it } from "vitest";
import { createInvoiceDraft, getInvoiceDraft, updateInvoiceDraft, type InvoiceFaultPoint } from "@/server/invoices/service";
import { apiErrorCodes } from "@/server/http/errors";
import { getSettings } from "@/server/settings/service";
import { createTestAdmin } from "../fixtures/auth";
import { createTemporaryDatabase, type TemporaryDatabase } from "../fixtures/database";

let temporary: TemporaryDatabase | undefined;
afterEach(() => { temporary?.dispose(); temporary = undefined; });

const now = new Date("2026-08-27T08:00:00.000Z");
const draft = (overrides: Record<string, unknown> = {}) => ({ intent: "SAVE_DRAFT", invoice: {
  invoiceDate: "2026-08-27", beneficiary: { name: "مستشفى النيل", phone: "123" },
  items: [{ clientKey: "a", productName: "قفازات", quantity: "2", unitPrice: "10.25" },
    { clientKey: "b", productName: "غير مكتمل", quantity: "3" }], notes: "مسودة", ...overrides,
} });

async function setup() {
  temporary = createTemporaryDatabase(); const admin = await createTestAdmin(temporary.connection);
  return { connection: temporary.connection, actor: { id: admin.id, displayName: admin.displayName, role: admin.role } };
}

describe("atomic invoice draft persistence", () => {
  it("deduplicates a lost create response by actor and operation without reserving another number", async () => {
    const { connection, actor } = await setup();
    const first = createInvoiceDraft({ connection, actor, input: draft(), requestId: "lost-create-response", now });
    const retried = createInvoiceDraft({ connection, actor,
      input: draft({ notes: "must not replace the completed operation" }), requestId: "lost-create-response", now });
    expect(retried.invoice.id).toBe(first.invoice.id);
    expect(retried.invoice.invoiceNumber).toBe(first.invoice.invoiceNumber);
    expect(retried.invoice.notes).toBe(first.invoice.notes);
    expect((connection.client.prepare("select count(*) as count from invoices").get() as { count: bigint }).count).toBe(1n);
    expect((connection.client.prepare("select last_value as value from invoice_sequences where sequence_key='invoice:2026'").get() as { value: bigint }).value).toBe(1n);
    expect((connection.client.prepare("select count(*) as count from audit_logs where request_id=? and event_type='INVOICE_CREATED'")
      .get("lost-create-response") as { count: bigint }).count).toBe(1n);
  });

  it("covers AT-LIFE-001 and AT-NUM-002 by saving incomplete drafts with server totals and sequential numbers", async () => {
    const { connection, actor } = await setup();
    connection.client.prepare("insert into invoice_sequences (sequence_key,last_value,updated_at) values (?,?,?)")
      .run("invoice:2026", 127, now.toISOString());
    const result = createInvoiceDraft({ connection, actor, input: draft(), requestId: "create-1", now });
    expect(result.invoice).toMatchObject({ invoiceNumber: "OI-2026-00128", invoiceStatus: "DRAFT",
      paymentStatus: "UNPAID", isArchived: false, rowVersion: 1,
      totals: { subtotalMinor: "2050", grandTotalMinor: "2050", remainingMinor: "2050" } });
    expect(result.invoice.items).toHaveLength(2);
    expect(result.invoice.items[0]).toMatchObject({ sortOrder: 0, quantity: "2", unitPrice: "10.25", lineTotalMinor: "2050" });
    expect(result.invoice.items[1]).toMatchObject({ sortOrder: 1, quantity: "3", unitPrice: null, lineTotalMinor: "0" });
    const second = createInvoiceDraft({ connection, actor, input: draft({ beneficiary: null, items: [] }), requestId: "create-2", now });
    expect(second.invoice.invoiceNumber).toBe("OI-2026-00129");
    expect(second.invoice.beneficiary.name).toBeNull(); expect(second.invoice.items).toEqual([]);
  });

  it("does not reserve numbers for reads or invalid/overflow drafts and permits zero price", async () => {
    const { connection, actor } = await setup();
    expect(() => getInvoiceDraft("01K00000000000000000000000", { connection })).toThrowError(expect.objectContaining({ status: 404 }));
    for (const item of [
      { productName: "x", quantity: "0", unitPrice: "1" },
      { productName: "x", quantity: "1", unitPrice: "-1" },
      { productName: "x", quantity: "999999999999999999", unitPrice: "999999999999999999" },
    ]) expect(() => createInvoiceDraft({ connection, actor, input: draft({ items: [item] }), requestId: "bad", now }))
      .toThrowError(expect.objectContaining({ code: apiErrorCodes.VALIDATION_ERROR }));
    const count = connection.client.prepare("select count(*) as count from invoice_sequences").get() as { count: bigint };
    expect(count.count).toBe(0n);
    const free = createInvoiceDraft({ connection, actor, input: draft({ items: [{ productName: "مجاني", quantity: "1", unitPrice: "0" }] }), requestId: "free", now });
    expect(free.invoice.totals.grandTotalMinor).toBe("0");
  });

  it("preserves two-decimal invoices after settings change and gives new invoices zero decimals (AT-CALC-011)", async () => {
    const { connection, actor } = await setup();
    getSettings({ connection, now });
    connection.client.prepare("update app_settings set default_payment_terms='نقداً' where id='default'").run();
    const created = createInvoiceDraft({ connection, actor, input: draft(), requestId: "snapshot", now });
    expect(created.invoice.paymentTerms).toBe("نقداً");
    connection.client.prepare("update app_settings set currency_code='USD',currency_symbol_ar='$',currency_decimals=0 where id='default'").run();
    const updated = updateInvoiceDraft({ connection, actor, id: created.invoice.id, requestId: "patch", now,
      input: { rowVersion: 1, invoice: { invoiceDate: "2026-08-27", beneficiary: null,
        items: [{ productName: "قفازات", quantity: "1", unitPrice: "1.234" }] } } });
    expect(updated.invoice.currency).toEqual({ code: "SDG", symbol: expect.any(String), decimals: 2 });
    expect(updated.invoice.invoiceNumber).toBe(created.invoice.invoiceNumber);
    expect(updated.invoice.createdBy.id).toBe(created.invoice.createdBy.id);
    expect(updated.invoice.totals.grandTotalMinor).toBe("123");
    const newer = createInvoiceDraft({ connection, actor, input: draft({
      items: [{ productName: "new precision", quantity: "1", unitPrice: "1.5" }],
    }), requestId: "new-currency-precision", now });
    expect(getInvoiceDraft(created.invoice.id, { connection })).toMatchObject({
      currency: { code: "SDG", decimals: 2 }, totals: { grandTotalMinor: "123" },
    });
    expect(newer.invoice).toMatchObject({
      currency: { code: "USD", symbol: "$", decimals: 0 }, totals: { grandTotalMinor: "2" },
    });
  });

  it("enforces date rules by role and returns an admin warning", async () => {
    const { connection, actor } = await setup();
    const future = createInvoiceDraft({ connection, actor, input: draft({ invoiceDate: "2026-08-28" }), requestId: "future", now });
    expect(future.warnings).toEqual([{ code: "FUTURE_INVOICE_DATE" }]);
    expect(() => createInvoiceDraft({ connection, actor: { ...actor, role: "EMPLOYEE" },
      input: draft({ invoiceDate: "2026-08-28" }), requestId: "employee-future", now }))
      .toThrowError(expect.objectContaining({ status: 422 }));
    expect(() => createInvoiceDraft({ connection, actor, input: draft({ dueDate: "2026-08-26" }), requestId: "due", now }))
      .toThrowError(expect.objectContaining({ status: 422 }));
  });

  it("creates, reuses, explicitly updates/reactivates suggestions and uses the last repeated product price", async () => {
    const { connection, actor } = await setup();
    const created = createInvoiceDraft({ connection, actor, requestId: "suggestions", now, input: draft({ items: [
      { productName: "قفازات", description: "قديم", quantity: "1", unitPrice: "2" },
      { productName: " قفازات ", quantity: "1", unitPrice: "3" },
    ] }) });
    const product = connection.client.prepare(`select id,use_count as useCount,last_unit_price_decimal as price,
      last_currency_code as currency from products where normalized_name=?`).get("قفازات") as { id: string; useCount: bigint; price: string; currency: string };
    expect(product).toMatchObject({ useCount: 2n, price: "3", currency: "SDG" });
    connection.client.prepare("update products set is_active=0 where id=?").run(product.id);
    expect(() => createInvoiceDraft({ connection, actor, requestId: "inactive", now,
      input: draft({ items: [{ productSuggestionId: product.id, productName: "قفازات", quantity: "1", unitPrice: "4" }] }) }))
      .toThrowError(expect.objectContaining({ status: 422 }));
    const reactivated = updateInvoiceDraft({ connection, actor, id: created.invoice.id, requestId: "reactivate", now,
      input: { rowVersion: 1, invoice: { items: [{ productSuggestionId: product.id, productName: "قفازات حديثة",
        quantity: "1", unitPrice: "4", reactivateSuggestion: true, updateSuggestion: true }] } } });
    expect(reactivated.invoice.items[0]?.productName).toBe("قفازات حديثة");
    expect(connection.client.prepare("select name,is_active as active from products where id=?").get(product.id))
      .toEqual({ name: "قفازات حديثة", active: 1n });
  });

  it("writes linked, redacted create/update audit events with before and after changes", async () => {
    const { connection, actor } = await setup();
    const created = createInvoiceDraft({ connection, actor, input: draft(), requestId: "audit-create", now });
    updateInvoiceDraft({ connection, actor, id: created.invoice.id, requestId: "audit-update", now,
      input: { rowVersion: 1, invoice: { notes: "بعد", items: [] } } });
    const events = connection.client.prepare(`select event_type as eventType,invoice_id as invoiceId,
      invoice_number as invoiceNumber,request_id as requestId,changes_json as changesJson
      from audit_logs where invoice_id=? order by created_at,id`).all(created.invoice.id) as Array<{
        eventType: string; invoiceId: string; invoiceNumber: string; requestId: string; changesJson: string;
      }>;
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ eventType: "INVOICE_CREATED", invoiceId: created.invoice.id,
      invoiceNumber: created.invoice.invoiceNumber, requestId: "audit-create" });
    expect(events[1]).toMatchObject({ eventType: "INVOICE_DRAFT_UPDATED", requestId: "audit-update" });
    expect(JSON.parse(events[1]?.changesJson ?? "{}")).toMatchObject({ notes: { before: "مسودة", after: "بعد" } });
    expect(JSON.stringify(events)).not.toMatch(/password|session|cookie|csrf|hash/iu);
  });

  it("keeps the saved beneficiary snapshot when its suggestion changes later", async () => {
    const { connection, actor } = await setup();
    const created = createInvoiceDraft({ connection, actor, requestId: "beneficiary-snapshot", now,
      input: draft({ beneficiary: { name: "مستشفى النيل", address: "العنوان القديم" } }) });
    const suggestionId = created.invoice.beneficiary.suggestionId;
    connection.client.prepare("update beneficiaries set name=?,address=? where id=?")
      .run("اسم جديد", "العنوان الجديد", suggestionId);
    expect(getInvoiceDraft(created.invoice.id, { connection }).beneficiary)
      .toMatchObject({ name: "مستشفى النيل", address: "العنوان القديم" });
  });

  it("increments row version, rejects stale and non-draft writes, and lets an employee edit another user's draft", async () => {
    const { connection, actor } = await setup();
    const created = createInvoiceDraft({ connection, actor, input: draft(), requestId: "base", now });
    const at = now.toISOString();
    connection.client.prepare(`insert into users (id,username,display_name,role,password_hash,is_active,must_change_password,
      failed_login_count,created_at,updated_at,row_version) values (?,?,?,?,?,1,0,0,?,?,1)`)
      .run("employee-1", "employee", "موظف", "EMPLOYEE", "unused", at, at);
    const employee = { id: "employee-1", displayName: "موظف", role: "EMPLOYEE" as const };
    const updated = updateInvoiceDraft({ connection, actor: employee, id: created.invoice.id, requestId: "employee", now,
      input: { rowVersion: 1, invoice: { items: [] } } });
    expect(updated.invoice).toMatchObject({ rowVersion: 2, updatedBy: { id: "employee-1" } });
    const auditBefore = (connection.client.prepare("select count(*) as count from audit_logs").get() as { count: bigint }).count;
    expect(() => updateInvoiceDraft({ connection, actor, id: created.invoice.id, requestId: "stale", now,
      input: { rowVersion: 1, invoice: { items: [] } } })).toThrowError(expect.objectContaining({ status: 409 }));
    expect((connection.client.prepare("select count(*) as count from audit_logs").get() as { count: bigint }).count).toBe(auditBefore);
    connection.client.prepare("update invoices set invoice_status='ISSUED' where id=?").run(created.invoice.id);
    expect(() => updateInvoiceDraft({ connection, actor, id: created.invoice.id, requestId: "issued", now,
      input: { rowVersion: 2, invoice: { items: [] } } })).toThrowError(expect.objectContaining({ status: 409 }));
  });

  it.each<InvoiceFaultPoint>(["afterSequence", "afterSuggestions", "afterInvoice", "afterItems", "afterAudit"])(
    "rolls back every artifact for injected failure at %s", async (point) => {
      const { connection, actor } = await setup();
      connection.client.prepare("insert into invoice_sequences (sequence_key,last_value,updated_at) values (?,?,?)")
        .run("invoice:2026", 40, now.toISOString());
      const baselines = new Map<string, bigint>();
      for (const table of ["invoice_sequences", "beneficiaries", "products", "invoices", "invoice_items", "audit_logs"]) {
        baselines.set(table, (connection.client.prepare(`select count(*) as count from ${table}`).get() as { count: bigint }).count);
      }
      expect(() => createInvoiceDraft({ connection, actor, input: draft(), requestId: `fault-${point}`, now,
        faultInjector: (current) => { if (current === point) throw new Error(`fault:${point}`); } })).toThrow();
      for (const table of ["invoice_sequences", "beneficiaries", "products", "invoices", "invoice_items", "audit_logs"]) {
        const result = connection.client.prepare(`select count(*) as count from ${table}`).get() as { count: bigint };
        expect(result.count, table).toBe(baselines.get(table));
      }
      expect(connection.client.prepare("select last_value as lastValue from invoice_sequences where sequence_key=?")
        .get("invoice:2026")).toEqual({ lastValue: 40n });
      const recovered = createInvoiceDraft({ connection, actor, input: draft(),
        requestId: `recovered-${point}`, now });
      expect(recovered.invoice.invoiceNumber).toBe("OI-2026-00041");
      expect(connection.client.pragma("quick_check", { simple: true })).toBe("ok");
    });

  it("rolls back a patch when audit persistence fails", async () => {
    const { connection, actor } = await setup();
    const created = createInvoiceDraft({ connection, actor, input: draft(), requestId: "before-audit-fail", now });
    expect(() => updateInvoiceDraft({ connection, actor, id: created.invoice.id, requestId: "audit-fail", now,
      input: { rowVersion: 1, invoice: { notes: "must rollback", items: [] } },
      auditAppender: () => { throw new Error("simulated audit failure"); } })).toThrow();
    expect(getInvoiceDraft(created.invoice.id, { connection })).toMatchObject({ rowVersion: 1, notes: "مسودة" });
    expect((connection.client.prepare("select count(*) as count from audit_logs where invoice_id=?")
      .get(created.invoice.id) as { count: bigint }).count).toBe(1n);
  });
});
