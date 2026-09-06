import { afterEach, describe, expect, it } from "vitest";
import { getInvoiceEditorDefaults } from "@/server/invoices/editor-defaults";
import { createTestAdmin } from "../fixtures/auth";
import { createTemporaryDatabase, type TemporaryDatabase } from "../fixtures/database";

let temporary: TemporaryDatabase | undefined;
afterEach(() => { temporary?.dispose(); temporary = undefined; });

describe("safe invoice editor defaults", () => {
  it("returns only editor-safe settings and does not reserve a number or mutate suggestions", async () => {
    temporary = createTemporaryDatabase();
    await createTestAdmin(temporary.connection);
    const defaults = getInvoiceEditorDefaults({ connection: temporary.connection, now: new Date("2026-09-02T10:00:00.000Z") });
    expect(defaults).toEqual({
      invoiceDate: "2026-09-02",
      currency: { code: "SDG", symbol: "ج.س", decimals: 2 },
      taxEnabled: false,
      paymentTerms: null,
    });
    expect(Object.keys(defaults).sort()).toEqual(["currency", "invoiceDate", "paymentTerms", "taxEnabled"]);
    for (const table of ["invoice_sequences", "beneficiaries", "products", "invoices"]) {
      const row = temporary.connection.client.prepare(`select count(*) as count from ${table}`).get() as { count: bigint };
      expect(row.count, table).toBe(0n);
    }
  });
});
