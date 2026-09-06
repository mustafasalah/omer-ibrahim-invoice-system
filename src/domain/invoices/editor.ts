import { z } from "zod";
import { calculateInvoice } from "./calculator";
import { inspectDecimalInput } from "./decimal";
import { InvoiceCalculationError, type CurrencySnapshot } from "./contracts";
import type { DraftInvoiceInput, InvoiceDraftDto, InvoiceEditorDefaults } from "./draft";

export type EditorItem = {
  clientKey: string;
  productSuggestionId?: string;
  productName: string;
  description: string;
  unit: string;
  quantity: string;
  unitPrice: string;
};

export type InvoiceEditorState = {
  id: string | null;
  invoiceNumber: string | null;
  invoiceStatus: string;
  isArchived: boolean;
  invoiceDate: string;
  dueDate: string;
  beneficiary: { suggestionId?: string; name: string; phone: string; address: string; registrationNumber: string };
  currency: CurrencySnapshot;
  taxEnabled: false;
  items: EditorItem[];
  notes: string;
  paymentTerms: string;
  rowVersion: number | null;
  createdBy: { id: string; displayName: string } | null;
  updatedBy: { id: string; displayName: string } | null;
  serverPreview: { subtotalMinor: string; grandTotalMinor: string; lineTotals: Record<string, string> } | null;
};

export type EditorPreview = {
  subtotalMinor: string;
  grandTotalMinor: string;
  lineTotals: Record<string, string>;
  fieldErrors: Record<string, string>;
};

const invoiceDtoSchema = z.object({
  id: z.string(), invoiceNumber: z.string(), invoiceStatus: z.string(), paymentStatus: z.string(), isArchived: z.boolean(),
  invoiceDate: z.string(), dueDate: z.string().nullable(),
  beneficiary: z.object({ suggestionId: z.string().nullable(), name: z.string().nullable(), phone: z.string().nullable(),
    address: z.string().nullable(), registrationNumber: z.string().nullable() }),
  currency: z.object({ code: z.string(), symbol: z.string(), decimals: z.number().int().min(0).max(3) }),
  items: z.array(z.object({ id: z.string(), productSuggestionId: z.string().nullable(), sortOrder: z.number(),
    productName: z.string().nullable(), description: z.string().nullable(), unit: z.string().nullable(),
    quantity: z.string().nullable(), unitPrice: z.string().nullable(), baseMinor: z.string(), discountMinor: z.string(),
    allocatedInvoiceDiscountMinor: z.string(), taxableMinor: z.string(), taxMinor: z.string(), lineTotalMinor: z.string() })),
  totals: z.object({ subtotalMinor: z.string(), lineDiscountsMinor: z.string(), invoiceDiscountMinor: z.string(),
    discountTotalMinor: z.string(), taxableTotalMinor: z.string(), taxTotalMinor: z.string(), grandTotalMinor: z.string(),
    grossPaidMinor: z.string(), refundedTotalMinor: z.string(), netCollectedMinor: z.string(), remainingMinor: z.string() }),
  notes: z.string().nullable(), paymentTerms: z.string().nullable(), createdAt: z.string(),
  createdBy: z.object({ id: z.string(), displayName: z.string() }), updatedAt: z.string(),
  updatedBy: z.object({ id: z.string(), displayName: z.string() }), rowVersion: z.number().int().min(1),
});

export function emptyEditorItem(clientKey: string): EditorItem {
  return { clientKey, productName: "", description: "", unit: "", quantity: "", unitPrice: "" };
}

export function createEditorState(defaults: InvoiceEditorDefaults, clientKey: string): InvoiceEditorState {
  return { id: null, invoiceNumber: null, invoiceStatus: "DRAFT", isArchived: false,
    invoiceDate: defaults.invoiceDate, dueDate: "", beneficiary: { name: "", phone: "", address: "", registrationNumber: "" },
    currency: defaults.currency, taxEnabled: false, items: [emptyEditorItem(clientKey)], notes: "",
    paymentTerms: defaults.paymentTerms ?? "", rowVersion: null, createdBy: null, updatedBy: null, serverPreview: null };
}

export function stateFromInvoice(invoice: InvoiceDraftDto): InvoiceEditorState {
  const items = invoice.items.length > 0 ? invoice.items.map((item) => ({ clientKey: `saved-${item.id}`,
    ...(item.productSuggestionId ? { productSuggestionId: item.productSuggestionId } : {}),
    productName: item.productName ?? "", description: item.description ?? "", unit: item.unit ?? "",
    quantity: item.quantity ?? "", unitPrice: item.unitPrice ?? "" })) : [emptyEditorItem(`empty-${invoice.id}`)];
  return { id: invoice.id, invoiceNumber: invoice.invoiceNumber, invoiceStatus: invoice.invoiceStatus,
    isArchived: invoice.isArchived, invoiceDate: invoice.invoiceDate, dueDate: invoice.dueDate ?? "",
    beneficiary: { ...(invoice.beneficiary.suggestionId ? { suggestionId: invoice.beneficiary.suggestionId } : {}),
      name: invoice.beneficiary.name ?? "", phone: invoice.beneficiary.phone ?? "",
      address: invoice.beneficiary.address ?? "", registrationNumber: invoice.beneficiary.registrationNumber ?? "" },
    currency: invoice.currency, taxEnabled: false, items,
    notes: invoice.notes ?? "", paymentTerms: invoice.paymentTerms ?? "", rowVersion: invoice.rowVersion,
    createdBy: invoice.createdBy, updatedBy: invoice.updatedBy,
    serverPreview: { subtotalMinor: invoice.totals.subtotalMinor, grandTotalMinor: invoice.totals.grandTotalMinor,
      lineTotals: Object.fromEntries(invoice.items.map((item) => [`saved-${item.id}`, item.lineTotalMinor])) } };
}

export function duplicateEditorItem(items: readonly EditorItem[], index: number, clientKey: string): EditorItem[] {
  const source = items[index];
  if (!source) return [...items];
  const copy = { ...source, clientKey };
  return [...items.slice(0, index + 1), copy, ...items.slice(index + 1)];
}

export function moveEditorItem(items: readonly EditorItem[], index: number, direction: -1 | 1): EditorItem[] {
  const target = index + direction;
  if (target < 0 || target >= items.length) return [...items];
  const next = [...items];
  const current = next[index]; const other = next[target];
  if (!current || !other) return next;
  next[index] = other; next[target] = current;
  return next;
}

export function editorItemHasData(item: EditorItem): boolean {
  return Boolean(item.productName || item.description || item.unit || item.quantity || item.unitPrice);
}

export function removeEditorItem(items: readonly EditorItem[], index: number, replacementKey: string): EditorItem[] {
  if (items.length === 1) return [emptyEditorItem(replacementKey)];
  return items.filter((_, itemIndex) => itemIndex !== index);
}

export function calculateEditorPreview(items: readonly EditorItem[], currency: CurrencySnapshot): EditorPreview {
  const fieldErrors: Record<string, string> = {}; const complete: EditorItem[] = [];
  for (const [index, item] of items.entries()) {
    const quantity = inspectDecimalInput(item.quantity, "quantity");
    const unitPrice = inspectDecimalInput(item.unitPrice, "unitPrice");
    if (quantity.state === "malformed" || quantity.state === "incomplete") {
      fieldErrors[`invoice.items.${index}.quantity`] = quantity.state === "malformed" ? quantity.code : "INVALID_DECIMAL";
    }
    if (unitPrice.state === "malformed" || unitPrice.state === "incomplete") {
      fieldErrors[`invoice.items.${index}.unitPrice`] = unitPrice.state === "malformed" ? unitPrice.code : "INVALID_DECIMAL";
    }
    if (item.productName.trim() && quantity.state === "valid" && unitPrice.state === "valid") complete.push(item);
  }
  let calculated;
  try {
    calculated = calculateInvoice({
      lines: complete.map((item) => ({ quantity: item.quantity, unitPrice: item.unitPrice })),
    }, currency);
  } catch (error) {
    if (error instanceof InvoiceCalculationError) {
      return { subtotalMinor: "0", grandTotalMinor: "0", lineTotals: {}, fieldErrors: { invoice: error.code } };
    }
    throw error;
  }
  const lineTotals: Record<string, string> = {}; let completeIndex = 0;
  for (const item of items) {
    const quantity = inspectDecimalInput(item.quantity, "quantity"); const price = inspectDecimalInput(item.unitPrice, "unitPrice");
    if (item.productName.trim() && quantity.state === "valid" && price.state === "valid") {
      lineTotals[item.clientKey] = calculated.lines[completeIndex]?.lineTotalMinor ?? "0"; completeIndex += 1;
    } else lineTotals[item.clientKey] = "0";
  }
  return { subtotalMinor: calculated.subtotalMinor, grandTotalMinor: calculated.grandTotalMinor, lineTotals, fieldErrors };
}

export function toDraftInput(state: InvoiceEditorState): DraftInvoiceInput {
  const text = (value: string) => value === "" ? null : value;
  const persistedItems = state.items.filter(editorItemHasData);
  return { invoiceDate: state.invoiceDate, dueDate: text(state.dueDate), beneficiary: {
    ...(state.beneficiary.suggestionId ? { suggestionId: state.beneficiary.suggestionId } : {}),
    name: text(state.beneficiary.name), phone: text(state.beneficiary.phone), address: text(state.beneficiary.address),
    registrationNumber: text(state.beneficiary.registrationNumber), updateSuggestion: false, reactivateSuggestion: false },
    items: persistedItems.map((item) => ({ clientKey: item.clientKey,
      ...(item.productSuggestionId ? { productSuggestionId: item.productSuggestionId } : {}),
      productName: text(item.productName), description: text(item.description), unit: text(item.unit),
      quantity: text(item.quantity), unitPrice: text(item.unitPrice), updateSuggestion: false, reactivateSuggestion: false })),
    notes: text(state.notes), paymentTerms: text(state.paymentTerms) };
}

export function draftToPlainText(state: InvoiceEditorState): string {
  return [
    `Invoice: ${state.invoiceNumber ?? "new draft"}`,
    `Invoice date: ${state.invoiceDate}`,
    `Due date: ${state.dueDate || "-"}`,
    `Currency: ${state.currency.code}`,
    `Beneficiary: ${state.beneficiary.name || "-"}`,
    "Items:",
    ...state.items.filter(editorItemHasData).map((item, index) => [
      `${index + 1}. ${item.productName || "-"}`,
      `quantity=${item.quantity || "-"}`,
      `unitPrice=${item.unitPrice || "-"}`,
      `unit=${item.unit || "-"}`,
      `description=${item.description || "-"}`,
    ].join(" | ")),
    `Notes: ${state.notes || "-"}`,
    `Payment terms: ${state.paymentTerms || "-"}`,
  ].join("\n");
}

export function parseInvoiceResponse(value: unknown): InvoiceDraftDto | null {
  const parsed = invoiceDtoSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
