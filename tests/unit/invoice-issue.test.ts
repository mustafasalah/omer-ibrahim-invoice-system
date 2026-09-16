import { describe, expect, it } from "vitest";
import { parseCreateIssue, parseUpdateIssue } from "@/domain/invoices/draft";

describe("invoice issue request validation", () => {
  it("collects all required issue fields with stable paths", () => {
    expect(() => parseCreateIssue({ intent: "ISSUE", invoice: {
      beneficiary: { name: "   " },
      items: [{ clientKey: "blank", productName: "", quantity: "", unitPrice: "" }],
    } })).toThrowError(expect.objectContaining({
      fieldErrors: expect.objectContaining({
        "beneficiary.name": "REQUIRED",
        items: "AT_LEAST_ONE_COMPLETE_ITEM_REQUIRED",
        "items.0.productName": "REQUIRED",
        "items.0.quantity": "DECIMAL_REQUIRED",
        "items.0.unitPrice": "DECIMAL_REQUIRED",
        "itemsByClientKey.blank.productName": "REQUIRED",
      }),
    }));
  });

  it("rejects malformed, zero, negative, and over-scale values", () => {
    for (const [field, value, code] of [
      ["quantity", "0", "QUANTITY_MUST_BE_POSITIVE"],
      ["quantity", "-1", "QUANTITY_MUST_BE_POSITIVE"],
      ["quantity", "1.1234567", "DECIMAL_SCALE_EXCEEDED"],
      ["unitPrice", "-1", "UNIT_PRICE_MUST_BE_NON_NEGATIVE"],
      ["unitPrice", "1e3", "INVALID_DECIMAL"],
    ] as const) {
      const item = { productName: "x", quantity: "1", unitPrice: "1", [field]: value };
      expect(() => parseCreateIssue({ intent: "ISSUE", invoice: {
        beneficiary: { name: "customer" }, items: [item],
      } })).toThrowError(expect.objectContaining({ fieldErrors: expect.objectContaining({ [`items.0.${field}`]: code }) }));
    }
  });

  it("ignores calculated values but rejects lifecycle and unknown fields", () => {
    const parsed = parseCreateIssue({ intent: "ISSUE", invoice: {
      beneficiary: { name: "customer" }, items: [{ productName: "x", quantity: "1", unitPrice: "1" }],
      grandTotalMinor: "1",
      totals: { grandTotalMinor: "1" },
    } });
    expect(parsed.invoice).not.toHaveProperty("grandTotalMinor");
    expect(parsed.invoice).not.toHaveProperty("totals");
    for (const field of ["invoiceNumber", "invoiceStatus", "rowVersion", "unknownField"] as const) {
      expect(() => parseCreateIssue({ intent: "ISSUE", invoice: {
        beneficiary: { name: "customer" },
        items: [{ productName: "x", quantity: "1", unitPrice: "1" }],
        [field]: field === "rowVersion" ? 1 : "forged",
      } })).toThrowError(expect.objectContaining({ fieldErrors: expect.any(Object) }));
    }
  });

  it("requires a positive row version for an existing draft issue", () => {
    expect(() => parseUpdateIssue({ rowVersion: 0, invoice: {} }))
      .toThrowError(expect.objectContaining({ fieldErrors: expect.objectContaining({ rowVersion: expect.any(String) }) }));
  });
});
