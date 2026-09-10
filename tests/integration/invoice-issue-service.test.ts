import { afterEach, describe, expect, it } from "vitest";
import { withImmediateTransaction } from "@/server/db/transaction";
import { capturePrintSnapshot } from "@/server/invoices/print-snapshot";
import {
  createInvoiceDraft, createIssuedInvoice, getInvoiceDraft, issueInvoiceDraft, updateInvoiceDraft,
  type InvoiceFaultPoint,
} from "@/server/invoices/service";
import { apiErrorCodes } from "@/server/http/errors";
import { getSettings } from "@/server/settings/service";
import { createTestAdmin } from "../fixtures/auth";
import { createTemporaryDatabase, type TemporaryDatabase } from "../fixtures/database";

let temporary: TemporaryDatabase | undefined;
afterEach(() => { temporary?.dispose(); temporary = undefined; });

const now = new Date("2026-08-27T10:11:12.345Z");
const invoice = (overrides: Record<string, unknown> = {}) => ({
  invoiceDate: "2026-08-27",
  beneficiary: { name: "مستشفى النيل", phone: "249" },
  items: [{ clientKey: "line-a", productName: "قفازات", quantity: "2", unitPrice: "10.25" }],
  notes: "ملاحظة آمنة",
  ...overrides,
});
const direct = (overrides: Record<string, unknown> = {}) => ({ intent: "ISSUE", invoice: invoice(overrides) });
const draft = (overrides: Record<string, unknown> = {}) => ({ intent: "SAVE_DRAFT", invoice: invoice(overrides) });

async function setup() {
  temporary = createTemporaryDatabase();
  const admin = await createTestAdmin(temporary.connection);
  return { connection: temporary.connection,
    actor: { id: admin.id, displayName: admin.displayName, role: admin.role } };
}

function count(connection: Awaited<ReturnType<typeof setup>>["connection"], table: string): bigint {
  return (connection.client.prepare(`select count(*) as count from ${table}`).get() as { count: bigint }).count;
}

describe("atomic invoice issue and historical print snapshot", () => {
  it("rejects an incomplete direct issue without any persistent effect (AT-LIFE-002)", async () => {
    const { connection, actor } = await setup();
    const beforeSettings = count(connection, "app_settings");
    const beforeAudit = count(connection, "audit_logs");
    expect(() => createIssuedInvoice({ connection, actor, requestId: "invalid-direct", now,
      input: { intent: "ISSUE", invoice: { beneficiary: { name: " " }, items: [
        { clientKey: "a", productName: "", quantity: "", unitPrice: "" },
        { clientKey: "b", productName: "complete", quantity: "1", unitPrice: "2" },
      ] } } })).toThrowError(expect.objectContaining({ status: 422, fieldErrors: expect.objectContaining({
        "beneficiary.name": "REQUIRED", "items.0.productName": "REQUIRED",
        "items.0.quantity": "DECIMAL_REQUIRED", "items.0.unitPrice": "DECIMAL_REQUIRED",
      }) }));
    for (const table of ["invoice_sequences", "beneficiaries", "products", "invoices", "invoice_items",
      "invoice_print_snapshots"]) expect(count(connection, table), table).toBe(0n);
    expect(count(connection, "audit_logs")).toBe(beforeAudit);
    expect(count(connection, "app_settings")).toBe(beforeSettings);
  });

  it("issues a new zero-total invoice directly with one immutable snapshot and two truthful audits (AT-LIFE-003/AT-AUD-001)", async () => {
    const { connection, actor } = await setup();
    getSettings({ connection, now });
    connection.client.prepare(`update app_settings set company_name_ar=?,company_name_en=?,address=?,phones_json=?,
      email=?,registration_number=?,footer_text=?,paper_format='A4' where id='default'`).run(
        "شركة الاختبار", "TEST COMPANY", "الخرطوم", JSON.stringify(["111", "222"]),
        "test@example.local", "REG-1", "شكرًا لتعاملكم",
      );
    const result = createIssuedInvoice({ connection, actor, requestId: "direct-success", now,
      input: direct({ items: [{ productName: "عينة مجانية", quantity: "1", unitPrice: "0" }] }) });
    expect(result.invoice).toMatchObject({ invoiceStatus: "ISSUED", paymentStatus: "UNPAID", isArchived: false,
      rowVersion: 1, issuedAt: now.toISOString(), issuedBy: { id: actor.id },
      totals: { grandTotalMinor: "0", grossPaidMinor: "0", refundedTotalMinor: "0",
        netCollectedMinor: "0", remainingMinor: "0" },
      printSnapshot: { companyNameAr: "شركة الاختبار", companyNameEn: "TEST COMPANY", address: "الخرطوم",
        phones: ["111", "222"], paperFormat: "A4", capturedAt: now.toISOString() } });
    expect(result.invoice.printSnapshot?.capturedAt).toBe(result.invoice.issuedAt);
    const snapshotRow = connection.client.prepare(`select company_logo_asset_id as logo,stamp_asset_id as stamp,
      signature_asset_id as signature from invoice_print_snapshots where invoice_id=?`).get(result.invoice.id);
    expect(snapshotRow).toEqual({ logo: null, stamp: null, signature: null });
    expect(count(connection, "invoice_dealer_logos")).toBe(0n);
    const audits = connection.client.prepare(`select event_type as eventType,changes_json as changesJson,
      actor_user_id as actorId,actor_display_name as actorName,invoice_number as invoiceNumber,created_at as createdAt
      from audit_logs where invoice_id=? order by id`).all(result.invoice.id) as Array<Record<string, unknown>>;
    expect(audits.map((event) => event.eventType).sort()).toEqual(["INVOICE_CREATED", "INVOICE_ISSUED"]);
    expect(audits.every((event) => event.actorId === actor.id && event.invoiceNumber === result.invoice.invoiceNumber &&
      event.createdAt === now.toISOString())).toBe(true);
    expect(JSON.stringify(audits)).not.toMatch(/password|session|cookie|csrf|hash|DRAFT/iu);

    connection.client.prepare(`update app_settings set company_name_ar='شركة أخرى',currency_code='USD',
      currency_symbol_ar='$',currency_decimals=3 where id='default'`).run();
    const historical = getInvoiceDraft(result.invoice.id, { connection });
    expect(historical.printSnapshot?.companyNameAr).toBe("شركة الاختبار");
    expect(historical.currency).toEqual(result.invoice.currency);

    const retry = createIssuedInvoice({ connection, actor, requestId: "direct-success", now,
      input: direct({ items: [{ productName: "عينة مجانية", quantity: "1", unitPrice: "0" }] }) });
    expect(retry.invoice.id).toBe(result.invoice.id);
    expect(count(connection, "invoices")).toBe(1n);
    expect(count(connection, "invoice_print_snapshots")).toBe(1n);
  });

  it("enforces issue dates, role-based future dates, and overflow before reserving a number", async () => {
    const { connection, actor } = await setup();
    for (const [input, expectedPath] of [
      [direct({ invoiceDate: "2026-02-30" }), "invoiceDate"],
      [direct({ dueDate: "2026-08-26" }), "dueDate"],
    ] as const) {
      expect(() => createIssuedInvoice({ connection, actor, requestId: `date-${expectedPath}`, now, input }))
        .toThrowError(expect.objectContaining({ status: 422, fieldErrors: expect.objectContaining({
          [expectedPath]: expect.any(String),
        }) }));
    }
    expect(() => createIssuedInvoice({ connection, actor: { ...actor, role: "EMPLOYEE" },
      requestId: "future-employee", now, input: direct({ invoiceDate: "2026-08-28" }) }))
      .toThrowError(expect.objectContaining({ status: 422, fieldErrors: { invoiceDate: "FUTURE_DATE_FORBIDDEN" } }));
    expect(() => createIssuedInvoice({ connection, actor, requestId: "issue-overflow", now,
      input: direct({ items: [{ productName: "overflow", quantity: "999999999999999999",
        unitPrice: "999999999999999999" }] }) }))
      .toThrowError(expect.objectContaining({ status: 422, fieldErrors: expect.objectContaining({
        "items.0.baseMinor": "MONEY_OVERFLOW",
      }) }));
    expect(count(connection, "invoice_sequences")).toBe(0n);
    expect(count(connection, "invoices")).toBe(0n);
    expect(count(connection, "invoice_print_snapshots")).toBe(0n);
  });

  it("saves the latest editor input and issues an existing draft in one transaction for both roles", async () => {
    const { connection, actor } = await setup();
    const created = createInvoiceDraft({ connection, actor, requestId: "draft-create", now,
      input: draft({ beneficiary: null, items: [{ productName: "ناقص", quantity: "1" }] }) });
    const beforeAudit = count(connection, "audit_logs");
    expect(() => issueInvoiceDraft({ connection, actor, id: created.invoice.id, requestId: "bad-issue", now,
      input: { rowVersion: 1, invoice: { beneficiary: { name: "" }, items: [{
        productName: "", quantity: "", unitPrice: "",
      }] } } })).toThrowError(expect.objectContaining({ status: 422 }));
    expect(getInvoiceDraft(created.invoice.id, { connection })).toMatchObject({ invoiceStatus: "DRAFT", rowVersion: 1,
      beneficiary: { name: null }, items: [{ productName: "ناقص", unitPrice: null }] });
    expect(count(connection, "audit_logs")).toBe(beforeAudit);
    expect(count(connection, "invoice_print_snapshots")).toBe(0n);

    const at = now.toISOString();
    connection.client.prepare(`insert into users (id,username,display_name,role,password_hash,is_active,
      must_change_password,failed_login_count,created_at,updated_at,row_version)
      values ('employee-issue','employee.issue','موظف الإصدار','EMPLOYEE','unused',1,0,0,?,?,1)`).run(at, at);
    const employee = { id: "employee-issue", displayName: "موظف الإصدار", role: "EMPLOYEE" as const };
    const issued = issueInvoiceDraft({ connection, actor: employee, id: created.invoice.id,
      requestId: "employee-issue", now, input: { rowVersion: 1, invoice: invoice({
        beneficiary: { name: "المستفيد النهائي" },
        items: [{ productName: "المنتج النهائي", quantity: "3", unitPrice: "4" }],
      }) } });
    expect(issued.invoice).toMatchObject({ invoiceStatus: "ISSUED", rowVersion: 2,
      beneficiary: { name: "المستفيد النهائي" }, items: [{ productName: "المنتج النهائي" }],
      totals: { grandTotalMinor: "1200", remainingMinor: "1200" }, issuedBy: { id: employee.id } });
    expect(count(connection, "invoice_print_snapshots")).toBe(1n);
  });

  it("rejects stale, repeated, cancelled, and archived issue attempts without side effects", async () => {
    const { connection, actor } = await setup();
    const created = createInvoiceDraft({ connection, actor, requestId: "life-create", now, input: draft() });
    const valid = { rowVersion: 1, invoice: invoice() };
    expect(() => issueInvoiceDraft({ connection, actor, id: created.invoice.id, requestId: "stale", now,
      input: { ...valid, rowVersion: 2 } })).toThrowError(expect.objectContaining({ status: 409 }));
    expect(count(connection, "invoice_print_snapshots")).toBe(0n);
    expect(count(connection, "audit_logs")).toBe(2n);
    const settled = await Promise.allSettled([
      Promise.resolve().then(() => issueInvoiceDraft({ connection, actor, id: created.invoice.id,
        requestId: "race-a", now, input: valid })),
      Promise.resolve().then(() => issueInvoiceDraft({ connection, actor, id: created.invoice.id,
        requestId: "race-b", now, input: valid })),
    ]);
    expect(settled.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(settled.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(count(connection, "invoice_print_snapshots")).toBe(1n);
    expect(count(connection, "audit_logs")).toBe(3n);

    const cancelled = createInvoiceDraft({ connection, actor, requestId: "cancelled-create", now, input: draft() });
    connection.client.prepare("update invoices set invoice_status='CANCELLED' where id=?").run(cancelled.invoice.id);
    expect(() => issueInvoiceDraft({ connection, actor, id: cancelled.invoice.id, requestId: "cancelled", now,
      input: valid })).toThrowError(expect.objectContaining({ status: 409 }));
    const archived = createInvoiceDraft({ connection, actor, requestId: "archived-create", now, input: draft() });
    connection.client.prepare("update invoices set is_archived=1,archived_at=?,archived_by=? where id=?")
      .run(now.toISOString(), actor.id, archived.invoice.id);
    expect(() => issueInvoiceDraft({ connection, actor, id: archived.invoice.id, requestId: "archived", now,
      input: valid })).toThrowError(expect.objectContaining({ status: 409 }));
  });

  it("rolls back sequence, suggestions, invoice, items, snapshot, status, and audit at every issue fault", async () => {
    for (const point of ["afterSequence", "afterSuggestions", "afterInvoice", "afterItems", "afterSnapshot",
      "afterStatus", "afterAudit"] satisfies InvoiceFaultPoint[]) {
      const { connection, actor } = await setup();
      const beforeAudit = count(connection, "audit_logs");
      expect(() => createIssuedInvoice({ connection, actor, requestId: `fault-${point}`, now, input: direct(),
        faultInjector: (current) => { if (current === point) throw new Error(`fault:${point}`); } }))
        .toThrow();
      for (const table of ["invoice_sequences", "beneficiaries", "products", "invoices", "invoice_items",
        "invoice_print_snapshots"]) expect(count(connection, table), `${point}:${table}`).toBe(0n);
      expect(count(connection, "audit_logs"), `${point}:audit_logs`).toBe(beforeAudit);
      expect(connection.client.pragma("quick_check", { simple: true })).toBe("ok");
      temporary?.dispose(); temporary = undefined;
    }
  });

  it("rolls back an existing draft on snapshot/audit failure and rejects duplicate snapshot replacement", async () => {
    const { connection, actor } = await setup();
    const created = createInvoiceDraft({ connection, actor, requestId: "rollback-create", now, input: draft() });
    const baselineAudit = count(connection, "audit_logs");
    for (const failure of ["snapshot", "audit"] as const) {
      expect(() => issueInvoiceDraft({ connection, actor, id: created.invoice.id, requestId: `failure-${failure}`, now,
        input: { rowVersion: 1, invoice: invoice() },
        ...(failure === "snapshot" ? { snapshotCapturer: () => { throw new Error("snapshot failure"); } }
          : { auditAppender: () => { throw new Error("audit failure"); } }),
      })).toThrow();
      expect(getInvoiceDraft(created.invoice.id, { connection })).toMatchObject({ invoiceStatus: "DRAFT", rowVersion: 1 });
      expect(count(connection, "invoice_print_snapshots")).toBe(0n);
      expect(count(connection, "audit_logs")).toBe(baselineAudit);
    }
    const issued = issueInvoiceDraft({ connection, actor, id: created.invoice.id, requestId: "final-issue", now,
      input: { rowVersion: 1, invoice: invoice() } });
    expect(() => withImmediateTransaction(connection.client, () => capturePrintSnapshot(connection, {
      invoiceId: issued.invoice.id, capturedAt: new Date(now.getTime() + 1_000).toISOString(),
    }))).toThrowError(expect.objectContaining({ code: apiErrorCodes.CONFLICT }));
    expect(getInvoiceDraft(issued.invoice.id, { connection }).printSnapshot?.capturedAt).toBe(now.toISOString());
    expect(() => capturePrintSnapshot(connection, { invoiceId: issued.invoice.id, capturedAt: now.toISOString() }))
      .toThrow(/active issue transaction/u);
  });

  it("returns 403 for employee draft PATCH after issue and 409 for admin (AT-AUTH-007)", async () => {
    const { connection, actor } = await setup();
    const created = createInvoiceDraft({ connection, actor, requestId: "auth-create", now, input: draft() });
    const issued = issueInvoiceDraft({ connection, actor, id: created.invoice.id, requestId: "auth-issue", now,
      input: { rowVersion: 1, invoice: invoice() } });
    const employee = { id: actor.id, displayName: actor.displayName, role: "EMPLOYEE" as const };
    expect(() => updateInvoiceDraft({ connection, actor: employee, id: issued.invoice.id, requestId: "employee-patch", now,
      input: { rowVersion: 2, invoice: invoice({ notes: "forbidden" }) } }))
      .toThrowError(expect.objectContaining({ status: 403, code: apiErrorCodes.FORBIDDEN }));
    expect(() => updateInvoiceDraft({ connection, actor, id: issued.invoice.id, requestId: "admin-patch", now,
      input: { rowVersion: 2, invoice: invoice({ notes: "also forbidden here" }) } }))
      .toThrowError(expect.objectContaining({ status: 409 }));
    expect(getInvoiceDraft(issued.invoice.id, { connection })).toMatchObject({ rowVersion: 2, notes: "ملاحظة آمنة" });
  });
});
