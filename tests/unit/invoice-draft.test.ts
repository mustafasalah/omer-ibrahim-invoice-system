import { describe, expect, it } from "vitest";
import {
  dateInTimezone, DraftValidationError, isValidIsoDate, normalizeSuggestionName,
  parseCreateDraft, parseUpdateDraft,
} from "@/domain/invoices/draft";

describe("invoice draft contracts", () => {
  it("accepts an incomplete empty draft and preserves omitted payment terms", () => {
    expect(parseCreateDraft({ intent: "SAVE_DRAFT", invoice: { items: [{ clientKey: "row-1" }] } }))
      .toEqual({ intent: "SAVE_DRAFT", invoice: { dueDate: null, beneficiary: null,
        items: [{ clientKey: "row-1", productName: null, description: null, unit: null,
          quantity: null, unitPrice: null, updateSuggestion: false, reactivateSuggestion: false }], notes: null } });
  });

  it("rejects issue intents, server-owned fields, unknown nested fields, and supplied sort order", () => {
    for (const input of [
      { intent: "ISSUE", invoice: {} },
      { intent: "SAVE_DRAFT", invoice: { totals: { grandTotalMinor: "1" } } },
      { intent: "SAVE_DRAFT", invoice: { invoiceNumber: "fake" } },
      { intent: "SAVE_DRAFT", invoice: { items: [{ sortOrder: 99 }] } },
    ]) expect(() => parseCreateDraft(input)).toThrow(DraftValidationError);
  });

  it("canonicalizes valid decimals and links field errors to item indexes and client keys", () => {
    const parsed = parseUpdateDraft({ rowVersion: 1, invoice: { items: [
      { clientKey: "good", productName: "  قفاز  ", quantity: "01.500", unitPrice: "0.00" },
    ] } });
    expect(parsed.invoice.items[0]).toMatchObject({ productName: "قفاز", quantity: "1.5", unitPrice: "0" });
    try {
      parseCreateDraft({ intent: "SAVE_DRAFT", invoice: { items: [{ clientKey: "bad", quantity: "0", unitPrice: "-1" }] } });
      throw new Error("Expected validation failure.");
    } catch (error) {
      expect(error).toBeInstanceOf(DraftValidationError);
      expect((error as DraftValidationError).fieldErrors).toMatchObject({
        "invoice.items.0.quantity": "QUANTITY_MUST_BE_POSITIVE",
        "invoice.itemsByClientKey.bad.unitPrice": "UNIT_PRICE_MUST_BE_NON_NEGATIVE",
      });
    }
  });

  it("validates calendar dates using company timezone and normalizes Arabic suggestion names", () => {
    expect(isValidIsoDate("2026-02-29")).toBe(false);
    expect(isValidIsoDate("2028-02-29")).toBe(true);
    expect(dateInTimezone(new Date("2026-01-01T21:30:00Z"), "Africa/Khartoum")).toBe("2026-01-01");
    expect(normalizeSuggestionName("  إبرة   طبيّة  ")).toBe("ابره طبيّه");
  });
});
