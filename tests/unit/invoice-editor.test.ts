import { describe, expect, it } from "vitest";
import {
  calculateEditorPreview,
  createEditorState,
  draftToPlainText,
  duplicateEditorItem,
  editorDraftFingerprint,
  editorItemHasData,
  emptyEditorItem,
  moveEditorItem,
  reconcileSavedInvoice,
  removeEditorItem,
  toDraftInput,
} from "@/domain/invoices/editor";
import type { InvoiceDraftDto } from "@/domain/invoices/draft";

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

  it("tracks only editable draft input and clears dirty state after a saved baseline", () => {
    const state = createEditorState(defaults, "first");
    const baseline = editorDraftFingerprint(state);
    state.serverPreview = { subtotalMinor: "0", grandTotalMinor: "0", lineTotals: {} };
    state.rowVersion = 2;
    expect(editorDraftFingerprint(state)).toBe(baseline);
    state.notes = "تغيير";
    expect(editorDraftFingerprint(state)).not.toBe(baseline);
    const savedBaseline = editorDraftFingerprint(state);
    expect(editorDraftFingerprint(state)).toBe(savedBaseline);
  });

  it("binds a create response to its invoice without overwriting edits made while saving", () => {
    const sent = createEditorState(defaults, "first");
    sent.notes = "sent";
    const fingerprint = editorDraftFingerprint(sent);
    const current = structuredClone(sent);
    current.notes = "typed while saving";
    const saved = {
      id: "01K00000000000000000000000", invoiceNumber: "OI-2026-00001", invoiceStatus: "DRAFT",
      paymentStatus: "UNPAID", isArchived: false, invoiceDate: defaults.invoiceDate, dueDate: null,
      beneficiary: { suggestionId: null, name: null, phone: null, address: null, registrationNumber: null },
      currency: defaults.currency, items: [], notes: "sent", paymentTerms: defaults.paymentTerms,
      totals: { subtotalMinor: "0", lineDiscountsMinor: "0", invoiceDiscountMinor: "0", discountTotalMinor: "0",
        taxableTotalMinor: "0", taxTotalMinor: "0", grandTotalMinor: "0", grossPaidMinor: "0",
        refundedTotalMinor: "0", netCollectedMinor: "0", remainingMinor: "0" },
      createdAt: "2026-09-02T00:00:00.000Z", updatedAt: "2026-09-02T00:00:00.000Z",
      createdBy: { id: "admin", displayName: "Admin" }, updatedBy: { id: "admin", displayName: "Admin" },
      issuedAt: null, issuedBy: null, sourceInvoice: null, printSnapshot: null, rowVersion: 1,
    } satisfies InvoiceDraftDto;
    const reconciled = reconcileSavedInvoice(current, saved, fingerprint);
    expect(reconciled.changedDuringRequest).toBe(true);
    expect(reconciled.state).toMatchObject({ id: saved.id, invoiceNumber: saved.invoiceNumber,
      rowVersion: 1, notes: "typed while saving" });
    expect(reconciled.baseline).not.toBe(editorDraftFingerprint(reconciled.state));
  });
});
