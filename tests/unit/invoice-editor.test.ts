import { describe, expect, it } from "vitest";
import {
  calculateEditorPreview,
  createEditorState,
  draftToPlainText,
  duplicateEditorItem,
  editorItemHasData,
  emptyEditorItem,
  moveEditorItem,
  removeEditorItem,
  toDraftInput,
} from "@/domain/invoices/editor";

const defaults = {
  invoiceDate: "2026-09-02",
  currency: { code: "SDG", symbol: "ج.س", decimals: 2 },
  taxEnabled: false as const,
  paymentTerms: "الدفع خلال 30 يومًا",
};

describe("invoice draft editor state", () => {
  it("starts with one visual empty row without reserving or persisting it", () => {
    const state = createEditorState(defaults, "first");
    expect(state).toMatchObject({ id: null, invoiceNumber: null, rowVersion: null, invoiceDate: "2026-09-02" });
    expect(state.items).toEqual([emptyEditorItem("first")]);
    expect(toDraftInput(state).items).toEqual([]);
  });

  it("adds, duplicates, reorders, removes, and clears only the selected row", () => {
    const first = { ...emptyEditorItem("first"), productName: "شاش", quantity: "1", unitPrice: "20" };
    const second = { ...emptyEditorItem("second"), productName: "قفاز", quantity: "2", unitPrice: "10" };
    const duplicated = duplicateEditorItem([first, second], 0, "copy");
    expect(duplicated.map((item) => item.clientKey)).toEqual(["first", "copy", "second"]);
    expect(duplicated[1]).toMatchObject({ productName: "شاش", quantity: "1", unitPrice: "20" });
    expect(moveEditorItem(duplicated, 2, -1).map((item) => item.clientKey)).toEqual(["first", "second", "copy"]);
    expect(removeEditorItem([first, second], 0, "unused")).toEqual([second]);
    expect(removeEditorItem([first], 0, "replacement")).toEqual([emptyEditorItem("replacement")]);
    expect(editorItemHasData(first)).toBe(true);
    expect(editorItemHasData(emptyEditorItem("blank"))).toBe(false);
  });

  it("uses the shared Decimal calculator and omits incomplete rows from preview", () => {
    const complete = { ...emptyEditorItem("complete"), productName: "منتج", quantity: "1.25", unitPrice: "80.00" };
    const incomplete = { ...emptyEditorItem("incomplete"), productName: "مسودة غير مكتملة", quantity: "2" };
    const preview = calculateEditorPreview([complete, incomplete], defaults.currency);
    expect(preview).toMatchObject({ subtotalMinor: "10000", grandTotalMinor: "10000", fieldErrors: {} });
    expect(preview.lineTotals).toEqual({ complete: "10000", incomplete: "0" });
  });

  it("reports malformed input inline while retaining totals for other complete rows", () => {
    const valid = { ...emptyEditorItem("valid"), productName: "منتج", quantity: "2", unitPrice: "50" };
    const invalid = { ...emptyEditorItem("invalid"), productName: "آخر", quantity: "1.", unitPrice: "8" };
    const preview = calculateEditorPreview([valid, invalid], defaults.currency);
    expect(preview.grandTotalMinor).toBe("10000");
    expect(preview.fieldErrors["invoice.items.1.quantity"]).toBe("INVALID_DECIMAL");
  });

  it("serializes only allowed draft input and preserves incomplete data", () => {
    const state = createEditorState(defaults, "first");
    state.beneficiary.name = "مستشفى محلي";
    state.items = [{ ...emptyEditorItem("incomplete"), productName: "سرنجة", quantity: "5" }];
    const input = toDraftInput(state);
    expect(input.items).toHaveLength(1);
    expect(input.items[0]).toMatchObject({ clientKey: "incomplete", productName: "سرنجة", quantity: "5", unitPrice: null });
    expect(JSON.stringify(input)).not.toMatch(/invoiceNumber|rowVersion|grandTotal|taxEnabled/u);
    expect(draftToPlainText(state)).toContain("quantity=5");
  });

  it("does not truncate notes or payment terms in editor state", () => {
    const state = createEditorState(defaults, "first");
    state.notes = "x".repeat(2_001);
    state.paymentTerms = "y".repeat(2_001);
    const input = toDraftInput(state);
    expect(input.notes).toHaveLength(2_001);
    expect(input.paymentTerms).toHaveLength(2_001);
  });
});
