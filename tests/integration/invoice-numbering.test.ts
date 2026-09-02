import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "@/server/db/connection";
import { createInvoiceDraft } from "@/server/invoices/service";
import { getSettings } from "@/server/settings/service";
import { createTestAdmin } from "../fixtures/auth";
import { createTemporaryDatabase, type TemporaryDatabase } from "../fixtures/database";

let temporary: TemporaryDatabase | undefined;
afterEach(() => { temporary?.dispose(); temporary = undefined; });
const emptyDraft = { intent: "SAVE_DRAFT", invoice: { items: [] } };

describe("invoice number allocation", () => {
  it("uses max(last + 1, sequence start) and skips colliding final numbers", async () => {
    temporary = createTemporaryDatabase(); const admin = await createTestAdmin(temporary.connection);
    getSettings({ connection: temporary.connection, now: new Date("2026-06-01T00:00:00Z") });
    temporary.connection.client.prepare("update app_settings set sequence_start=50 where id='default'").run();
    temporary.connection.client.prepare("insert into invoice_sequences (sequence_key,last_value,updated_at) values ('invoice:2026',2,?)")
      .run("2026-01-01T00:00:00Z");
    const first = createInvoiceDraft({ connection: temporary.connection, actor: admin, input: emptyDraft,
      requestId: "start", now: new Date("2026-06-01T00:00:00Z") });
    expect(first.invoice.invoiceNumber).toBe("OI-2026-00050");
    temporary.connection.client.prepare("update invoice_sequences set last_value=49 where sequence_key='invoice:2026'").run();
    const skipped = createInvoiceDraft({ connection: temporary.connection, actor: admin, input: emptyDraft,
      requestId: "collision", now: new Date("2026-06-01T00:00:00Z") });
    expect(skipped.invoice.invoiceNumber).toBe("OI-2026-00051");
  });

  it("keeps independent YEARLY sequences and one NEVER sequence", async () => {
    temporary = createTemporaryDatabase(); const admin = await createTestAdmin(temporary.connection);
    const y2026 = createInvoiceDraft({ connection: temporary.connection, actor: admin, input: emptyDraft,
      requestId: "y26", now: new Date("2026-06-01T00:00:00Z") });
    const y2027 = createInvoiceDraft({ connection: temporary.connection, actor: admin, input: emptyDraft,
      requestId: "y27", now: new Date("2027-06-01T00:00:00Z") });
    expect(y2026.invoice.invoiceNumber).toBe("OI-2026-00001");
    expect(y2027.invoice.invoiceNumber).toBe("OI-2027-00001");
    expect(temporary.connection.client.prepare("select sequence_key as key,last_value as value from invoice_sequences order by sequence_key").all())
      .toEqual([{ key: "invoice:2026", value: 1n }, { key: "invoice:2027", value: 1n }]);
    temporary.connection.client.prepare(`update app_settings set sequence_reset_policy='NEVER',
      invoice_number_pattern='{PREFIX}-{SEQ:5}' where id='default'`).run();
    const globalOne = createInvoiceDraft({ connection: temporary.connection, actor: admin, input: emptyDraft,
      requestId: "g1", now: new Date("2027-06-01T00:00:00Z") });
    const globalTwo = createInvoiceDraft({ connection: temporary.connection, actor: admin, input: emptyDraft,
      requestId: "g2", now: new Date("2028-06-01T00:00:00Z") });
    expect([globalOne.invoice.invoiceNumber, globalTwo.invoice.invoiceNumber]).toEqual(["OI-00001", "OI-00002"]);
  });

  it("serializes two creation attempts from independent connections into unique sequential numbers", async () => {
    temporary = createTemporaryDatabase(); const admin = await createTestAdmin(temporary.connection);
    const secondConnection = openDatabase(temporary.connection.databasePath);
    try {
      const primaryConnection = temporary.connection;
      const [first, second] = await Promise.all([
        Promise.resolve().then(() => createInvoiceDraft({ connection: primaryConnection, actor: admin,
          input: emptyDraft, requestId: "concurrent-a", now: new Date("2026-06-01T00:00:00Z") })),
        Promise.resolve().then(() => createInvoiceDraft({ connection: secondConnection, actor: admin,
          input: emptyDraft, requestId: "concurrent-b", now: new Date("2026-06-01T00:00:00Z") })),
      ]);
      expect([first.invoice.invoiceNumber, second.invoice.invoiceNumber].sort())
        .toEqual(["OI-2026-00001", "OI-2026-00002"]);
      expect((primaryConnection.client.prepare("select count(distinct invoice_number) as count from invoices").get() as { count: bigint }).count).toBe(2n);
    } finally { secondConnection.client.close(); }
  });
});
