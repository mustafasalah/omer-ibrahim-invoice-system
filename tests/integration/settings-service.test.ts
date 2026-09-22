import { afterEach, describe, expect, it } from "vitest";
import { getSettings, updateSettings } from "@/server/settings/service";
import { createInvoiceDraft as createInvoiceDraftService } from "@/server/invoices/service";
import { apiErrorCodes } from "@/server/http/errors";
import { createTestAdmin } from "../fixtures/auth";
import { createTemporaryDatabase, type TemporaryDatabase } from "../fixtures/database";

let temporary: TemporaryDatabase | undefined;

type CreateDraftOptions = Parameters<typeof createInvoiceDraftService>[0];
function createInvoiceDraft(options: Omit<CreateDraftOptions, "idempotencyKey">) {
  return createInvoiceDraftService({ ...options, idempotencyKey: `test-settings-${options.requestId}` });
}
afterEach(() => { temporary?.dispose(); temporary = undefined; });

function changedSettings(overrides: Record<string, unknown> = {}) {
  if (!temporary) throw new Error("Missing database.");
  const current = getSettings({ connection: temporary.connection, now: new Date("2026-08-27T08:00:00Z") });
  return { current, input: { rowVersion: current.settings.rowVersion, settings: {
    company: current.settings.company, currency: current.settings.currency,
    numbering: current.settings.numbering, regional: current.settings.regional,
    session: { idleMinutes: current.settings.session.idleMinutes },
    defaultPaymentTerms: current.settings.defaultPaymentTerms, footerText: current.settings.footerText,
    ...overrides,
  } } };
}

describe("settings persistence", () => {
  it("creates safe defaults and previews without reserving a sequence", async () => {
    temporary = createTemporaryDatabase(); await createTestAdmin(temporary.connection);
    const result = getSettings({ connection: temporary.connection, now: new Date("2026-08-27T08:00:00Z") });
    expect(result.settings).toMatchObject({ currency: { code: "SDG", decimals: 2 },
      numbering: { prefix: "OI", sequenceStart: 1 }, regional: { paperFormat: "A4" },
      session: { idleMinutes: 30, absoluteHours: 12 } });
    expect(result.preview.invoiceNumber).toBe("OI-2026-00001");
    const count = temporary.connection.client.prepare("select count(*) as count from invoice_sequences").get() as { count: bigint };
    expect(count.count).toBe(0n);
  });

  it("uses max(last + 1, sequence start), writes changed fields to audit, and rejects stale writes", async () => {
    temporary = createTemporaryDatabase(); const admin = await createTestAdmin(temporary.connection);
    const connection = temporary.connection;
    temporary.connection.client.prepare("insert into invoice_sequences (sequence_key,last_value,updated_at) values (?,?,?)")
      .run("invoice:2026", 40, "2026-01-01T00:00:00Z");
    const { current, input } = changedSettings({ company: { ...getSettings({ connection: temporary.connection }).settings.company,
      phones: ["+249 111", "+249 222"] } });
    const updated = updateSettings({ connection: temporary.connection, input, actor: { id: admin.id, displayName: admin.displayName },
      requestId: "settings-update", now: new Date("2026-08-27T09:00:00Z") });
    expect(updated.preview.nextValue).toBe("41");
    expect(updated.settings.company.phones).toEqual(["+249 111", "+249 222"]);
    expect(updated.settings.rowVersion).toBe(current.settings.rowVersion + 1);
    const audit = temporary.connection.client.prepare(`select changes_json as changesJson,
      actor_user_id as actorUserId from audit_logs where event_type='SETTINGS_UPDATED'`).get() as { changesJson: string; actorUserId: string };
    expect(JSON.parse(audit.changesJson)).toEqual({ "company.phones": { before: [], after: ["+249 111", "+249 222"] } });
    expect(audit.actorUserId).toBe(admin.id);
    expect(audit.changesJson).not.toMatch(/secret|cookie|csrf|password/iu);
    expect(() => updateSettings({ connection, input, actor: { id: admin.id, displayName: admin.displayName }, requestId: "stale" }))
      .toThrowError(expect.objectContaining({ code: apiErrorCodes.CONFLICT, status: 409 }));
  });

  it("rolls back settings when audit insertion fails", async () => {
    temporary = createTemporaryDatabase(); const admin = await createTestAdmin(temporary.connection);
    const connection = temporary.connection;
    const { current, input } = changedSettings({ currency: { code: "USD", symbolAr: "$", decimals: 2 } });
    expect(() => updateSettings({ connection, input,
      actor: { id: admin.id, displayName: admin.displayName }, requestId: "audit-fail",
      auditAppender: () => { throw new Error("simulated audit failure"); } })).toThrow();
    expect(getSettings({ connection: temporary.connection }).settings.currency.code).toBe(current.settings.currency.code);
  });

  it("keeps old invoice numbers and applies a changed prefix and pattern only to new invoices (AT-NUM-005)", async () => {
    temporary = createTemporaryDatabase(); const admin = await createTestAdmin(temporary.connection);
    const connection = temporary.connection; const at = new Date("2026-08-27T08:00:00Z");
    const actor = { id: admin.id, displayName: admin.displayName, role: admin.role };
    const oldInvoice = createInvoiceDraft({ connection, actor, input: { intent: "SAVE_DRAFT", invoice: {} },
      requestId: "old-format", now: at });
    const current = getSettings({ connection, now: at }).settings;
    const { input } = changedSettings({ numbering: {
      ...current.numbering, prefix: "NEW", pattern: "{PREFIX}/{YY}/{SEQ:3}",
    } });
    const changed = updateSettings({ connection, input,
      actor: { id: admin.id, displayName: admin.displayName }, requestId: "change-number-format", now: at });
    expect(changed.preview.invoiceNumber).toBe("NEW/26/002");
    const newInvoice = createInvoiceDraft({ connection, actor, input: { intent: "SAVE_DRAFT", invoice: {} },
      requestId: "new-format", now: at });
    expect(oldInvoice.invoice.invoiceNumber).toBe("OI-2026-00001");
    expect(newInvoice.invoice.invoiceNumber).toBe("NEW/26/002");
    expect(connection.client.prepare("select invoice_number as invoiceNumber from invoices order by invoice_number").all())
      .toEqual([{ invoiceNumber: "NEW/26/002" }, { invoiceNumber: "OI-2026-00001" }]);
  });

  it("covers AT-NUM-006 and preserves currency snapshots in existing invoices", async () => {
    temporary = createTemporaryDatabase(); const admin = await createTestAdmin(temporary.connection);
    const connection = temporary.connection;
    getSettings({ connection: temporary.connection, now: new Date("2026-08-27T08:00:00Z") });
    temporary.connection.client.prepare(`insert into invoices
      (id,invoice_number,invoice_date,currency_code,currency_symbol,currency_decimals,created_at,created_by,updated_at,updated_by)
      values (?,?,?,?,?,?,?,?,?,?)`).run("invoice-1", "OI-2026-00001", "2026-08-27", "SDG", "ج.س", 2,
      "2026-08-27T08:00:00Z", admin.id, "2026-08-27T08:00:00Z", admin.id);
    const collision = changedSettings();
    expect(() => updateSettings({ connection, input: collision.input,
      actor: { id: admin.id, displayName: admin.displayName }, requestId: "collision", now: new Date("2026-08-27T09:00:00Z") }))
      .toThrowError(expect.objectContaining({ code: apiErrorCodes.VALIDATION_ERROR, status: 422 }));
    temporary.connection.client.prepare("insert into invoice_sequences (sequence_key,last_value,updated_at) values (?,?,?)")
      .run("invoice:2026", 1, "2026-08-27T08:00:00Z");
    const currentSettings = getSettings({ connection: temporary.connection }).settings;
    const currencyChange = changedSettings({ currency: { code: "USD", symbolAr: "$", decimals: 2 },
      numbering: { ...currentSettings.numbering, prefix: "NEW" } });
    updateSettings({ connection: temporary.connection, input: currencyChange.input,
      actor: { id: admin.id, displayName: admin.displayName }, requestId: "currency", now: new Date("2026-08-27T09:00:00Z") });
    const invoice = temporary.connection.client.prepare(`select invoice_number as invoiceNumber,
      currency_code as code, currency_symbol as symbol from invoices`).get();
    expect(invoice).toEqual({ invoiceNumber: "OI-2026-00001", code: "SDG", symbol: "ج.س" });
  });
});
