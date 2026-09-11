import { z } from "zod";
import { inspectDecimalInput } from "./decimal";
import type { DecimalString } from "./contracts";

export const MAX_DRAFT_ITEMS = 500;

export type DraftActor = {
  id: string;
  displayName: string;
  role: "ADMIN" | "EMPLOYEE";
};

export type DraftBeneficiaryInput = {
  suggestionId?: string;
  name: string | null;
  phone: string | null;
  address: string | null;
  registrationNumber: string | null;
  updateSuggestion: boolean;
  reactivateSuggestion: boolean;
};

export type DraftItemInput = {
  clientKey?: string;
  productSuggestionId?: string;
  productName: string | null;
  description: string | null;
  unit: string | null;
  quantity: string | null;
  unitPrice: string | null;
  updateSuggestion: boolean;
  reactivateSuggestion: boolean;
};

export type DraftInvoiceInput = {
  invoiceDate?: string;
  dueDate: string | null;
  beneficiary: DraftBeneficiaryInput | null;
  items: DraftItemInput[];
  notes: string | null;
  paymentTerms?: string | null;
};

export type CreateDraftRequest = { intent: "SAVE_DRAFT"; invoice: DraftInvoiceInput };
export type UpdateDraftRequest = { rowVersion: number; invoice: DraftInvoiceInput };
export type CreateIssueRequest = { intent: "ISSUE"; invoice: DraftInvoiceInput };
export type UpdateIssueRequest = { rowVersion: number; invoice: DraftInvoiceInput };

export type PrintSnapshotDto = {
  companyNameAr: string;
  companyNameEn: string;
  address: string | null;
  phones: string[];
  email: string | null;
  registrationNumber: string | null;
  footerText: string | null;
  paperFormat: "A4" | "A5";
  capturedAt: string;
};

export type InvoiceEditorDefaults = {
  invoiceDate: string;
  currency: { code: string; symbol: string; decimals: number };
  taxEnabled: false;
  paymentTerms: string | null;
};

export type InvoiceDraftDto = {
  id: string; invoiceNumber: string; invoiceStatus: string; paymentStatus: string; isArchived: boolean;
  invoiceDate: string; dueDate: string | null;
  beneficiary: { suggestionId: string | null; name: string | null; phone: string | null;
    address: string | null; registrationNumber: string | null };
  currency: { code: string; symbol: string; decimals: number };
  items: Array<{ id: string; productSuggestionId: string | null; sortOrder: number; productName: string | null;
    description: string | null; unit: string | null; quantity: string | null; unitPrice: string | null;
    baseMinor: string; discountMinor: string; allocatedInvoiceDiscountMinor: string;
    taxableMinor: string; taxMinor: string; lineTotalMinor: string }>;
  totals: { subtotalMinor: string; lineDiscountsMinor: string; invoiceDiscountMinor: string;
    discountTotalMinor: string; taxableTotalMinor: string; taxTotalMinor: string; grandTotalMinor: string;
    grossPaidMinor: string; refundedTotalMinor: string; netCollectedMinor: string; remainingMinor: string };
  notes: string | null; paymentTerms: string | null;
  createdAt: string; createdBy: { id: string; displayName: string };
  updatedAt: string; updatedBy: { id: string; displayName: string };
  issuedAt: string | null; issuedBy: { id: string; displayName: string } | null;
  sourceInvoice: { id: string; invoiceNumber: string } | null;
  printSnapshot: PrintSnapshotDto | null;
  rowVersion: number;
};

export type DraftResult = {
  invoice: InvoiceDraftDto;
  warnings: Array<{ code: "FUTURE_INVOICE_DATE" }>;
};

export class DraftValidationError extends Error {
  constructor(readonly fieldErrors: Record<string, string>) {
    super("Invalid invoice draft.");
    this.name = "DraftValidationError";
  }
}

const optionalText = (maximum: number) => z.string().max(maximum).nullable().optional();
const suggestionId = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/u);

const beneficiarySchema = z.object({
  suggestionId: suggestionId.optional(),
  name: optionalText(200),
  phone: optionalText(100),
  address: optionalText(500),
  registrationNumber: optionalText(100),
  updateSuggestion: z.boolean().optional(),
  reactivateSuggestion: z.boolean().optional(),
}).strict();

const itemSchema = z.object({
  clientKey: z.string().min(1).max(100).optional(),
  productSuggestionId: suggestionId.optional(),
  productName: optionalText(250),
  description: optionalText(500),
  unit: optionalText(50),
  quantity: z.string().max(100).nullable().optional(),
  unitPrice: z.string().max(100).nullable().optional(),
  updateSuggestion: z.boolean().optional(),
  reactivateSuggestion: z.boolean().optional(),
}).strict();

const invoiceSchema = z.object({
  invoiceDate: z.string().optional(),
  dueDate: z.string().nullable().optional(),
  beneficiary: beneficiarySchema.nullable().optional(),
  items: z.array(itemSchema).max(MAX_DRAFT_ITEMS).optional(),
  notes: optionalText(2_000),
  paymentTerms: optionalText(2_000),
}).strict();

const createSchema = z.object({ intent: z.literal("SAVE_DRAFT"), invoice: invoiceSchema }).strict();
const updateSchema = z.object({ rowVersion: z.number().int().min(1), invoice: invoiceSchema }).strict();
const createIssueSchema = z.object({ intent: z.literal("ISSUE"), invoice: invoiceSchema }).strict();
const updateIssueSchema = z.object({ rowVersion: z.number().int().min(1), invoice: invoiceSchema }).strict();

function cleanText(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const cleaned = value.trim().normalize("NFC");
  return cleaned === "" ? null : cleaned;
}

function issuesToFields(issues: readonly z.core.$ZodIssue[]): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of issues) fields[issue.path.join(".") || "request"] ??= issue.message;
  return fields;
}

function addClientKeyError(
  fields: Record<string, string>,
  item: DraftItemInput,
  index: number,
  field: "quantity" | "unitPrice",
  message: string,
  prefix = "invoice.",
): void {
  fields[`${prefix}items.${index}.${field}`] = message;
  if (item.clientKey) fields[`${prefix}itemsByClientKey.${item.clientKey}.${field}`] = message;
}

function normalizeInvoice(raw: z.infer<typeof invoiceSchema>): DraftInvoiceInput {
  const items: DraftItemInput[] = (raw.items ?? []).map((item) => ({
    ...(item.clientKey ? { clientKey: item.clientKey } : {}),
    ...(item.productSuggestionId ? { productSuggestionId: item.productSuggestionId } : {}),
    productName: cleanText(item.productName),
    description: cleanText(item.description),
    unit: cleanText(item.unit),
    quantity: item.quantity === undefined || item.quantity === null || item.quantity === "" ? null : item.quantity,
    unitPrice: item.unitPrice === undefined || item.unitPrice === null || item.unitPrice === "" ? null : item.unitPrice,
    updateSuggestion: item.updateSuggestion ?? false,
    reactivateSuggestion: item.reactivateSuggestion ?? false,
  }));
  const beneficiary = raw.beneficiary ? {
    ...(raw.beneficiary.suggestionId ? { suggestionId: raw.beneficiary.suggestionId } : {}),
    name: cleanText(raw.beneficiary.name),
    phone: cleanText(raw.beneficiary.phone),
    address: cleanText(raw.beneficiary.address),
    registrationNumber: cleanText(raw.beneficiary.registrationNumber),
    updateSuggestion: raw.beneficiary.updateSuggestion ?? false,
    reactivateSuggestion: raw.beneficiary.reactivateSuggestion ?? false,
  } : null;
  return {
    ...(raw.invoiceDate !== undefined ? { invoiceDate: raw.invoiceDate } : {}),
    dueDate: cleanText(raw.dueDate), beneficiary, items,
    notes: cleanText(raw.notes),
    ...(Object.hasOwn(raw, "paymentTerms") ? { paymentTerms: cleanText(raw.paymentTerms) } : {}),
  };
}

function collectDecimalErrors(invoice: DraftInvoiceInput, prefix = "invoice."): Record<string, string> {
  const fields: Record<string, string> = {};
  invoice.items.forEach((item, index) => {
    for (const field of ["quantity", "unitPrice"] as const) {
      if (item[field] === null) continue;
      const inspection = inspectDecimalInput(item[field], field);
      if (inspection.state !== "valid") {
        const message = inspection.state === "malformed" ? inspection.code : "INVALID_DECIMAL";
        addClientKeyError(fields, item, index, field, message, prefix);
      } else {
        item[field] = inspection.value as DecimalString;
      }
    }
  });
  return fields;
}

function validateDecimals(invoice: DraftInvoiceInput, prefix = "invoice."): void {
  const fields = collectDecimalErrors(invoice, prefix);
  if (Object.keys(fields).length > 0) throw new DraftValidationError(fields);
}

function collectIssueRequiredErrors(invoice: DraftInvoiceInput): Record<string, string> {
  const fields: Record<string, string> = {};
  if (!invoice.beneficiary?.name) fields["beneficiary.name"] = "REQUIRED";
  if (invoice.items.length === 0) fields.items = "AT_LEAST_ONE_COMPLETE_ITEM_REQUIRED";
  let completeCount = 0;
  invoice.items.forEach((item, index) => {
    if (!item.productName) fields[`items.${index}.productName`] = "REQUIRED";
    if (item.quantity === null) fields[`items.${index}.quantity`] = "DECIMAL_REQUIRED";
    if (item.unitPrice === null) fields[`items.${index}.unitPrice`] = "DECIMAL_REQUIRED";
    if (item.productName && item.quantity !== null && item.unitPrice !== null) completeCount += 1;
    if (item.clientKey) {
      for (const field of ["productName", "quantity", "unitPrice"] as const) {
        const value = fields[`items.${index}.${field}`];
        if (value) fields[`itemsByClientKey.${item.clientKey}.${field}`] = value;
      }
    }
  });
  if (completeCount === 0) fields.items ??= "AT_LEAST_ONE_COMPLETE_ITEM_REQUIRED";
  return fields;
}

export function parseCreateDraft(input: unknown): CreateDraftRequest {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) throw new DraftValidationError(issuesToFields(parsed.error.issues));
  const invoice = normalizeInvoice(parsed.data.invoice);
  validateDecimals(invoice);
  return { intent: "SAVE_DRAFT", invoice };
}

export function parseUpdateDraft(input: unknown): UpdateDraftRequest {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) throw new DraftValidationError(issuesToFields(parsed.error.issues));
  const invoice = normalizeInvoice(parsed.data.invoice);
  validateDecimals(invoice);
  return { rowVersion: parsed.data.rowVersion, invoice };
}

function issueFields(issues: readonly z.core.$ZodIssue[]): Record<string, string> {
  const fields = issuesToFields(issues);
  return Object.fromEntries(Object.entries(fields).map(([path, message]) => [
    path.startsWith("invoice.") ? path.slice("invoice.".length) : path,
    message,
  ]));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collectRawIssueErrors(input: unknown): Record<string, string> {
  const fields: Record<string, string> = {};
  if (!isRecord(input) || !isRecord(input.invoice)) return fields;
  const raw = input.invoice;
  const beneficiary = isRecord(raw.beneficiary) ? raw.beneficiary : null;
  if (typeof beneficiary?.name !== "string" || cleanText(beneficiary.name) === null) {
    fields["beneficiary.name"] = "REQUIRED";
  }
  if (!Array.isArray(raw.items) || raw.items.length === 0) {
    fields.items = "AT_LEAST_ONE_COMPLETE_ITEM_REQUIRED";
    return fields;
  }
  let completeCount = 0;
  raw.items.forEach((value, index) => {
    const item = isRecord(value) ? value : {};
    const productComplete = typeof item.productName === "string" && cleanText(item.productName) !== null;
    const quantity = inspectDecimalInput(item.quantity ?? "", "quantity");
    const unitPrice = inspectDecimalInput(item.unitPrice ?? "", "unitPrice");
    if (!productComplete) fields[`items.${index}.productName`] = "REQUIRED";
    if (quantity.state !== "valid") fields[`items.${index}.quantity`] = quantity.state === "empty"
      ? "DECIMAL_REQUIRED" : quantity.state === "incomplete" ? "DECIMAL_INCOMPLETE" : quantity.code;
    if (unitPrice.state !== "valid") fields[`items.${index}.unitPrice`] = unitPrice.state === "empty"
      ? "DECIMAL_REQUIRED" : unitPrice.state === "incomplete" ? "DECIMAL_INCOMPLETE" : unitPrice.code;
    if (productComplete && quantity.state === "valid" && unitPrice.state === "valid") completeCount += 1;
    if (typeof item.clientKey === "string" && item.clientKey) {
      for (const field of ["productName", "quantity", "unitPrice"] as const) {
        const message = fields[`items.${index}.${field}`];
        if (message) fields[`itemsByClientKey.${item.clientKey}.${field}`] = message;
      }
    }
  });
  if (completeCount === 0) fields.items = "AT_LEAST_ONE_COMPLETE_ITEM_REQUIRED";
  return fields;
}

export function parseCreateIssue(input: unknown): CreateIssueRequest {
  const parsed = createIssueSchema.safeParse(input);
  if (!parsed.success) throw new DraftValidationError({
    ...collectRawIssueErrors(input),
    ...issueFields(parsed.error.issues),
  });
  const invoice = normalizeInvoice(parsed.data.invoice);
  const fields = { ...collectIssueRequiredErrors(invoice), ...collectDecimalErrors(invoice, "") };
  if (Object.keys(fields).length > 0) throw new DraftValidationError(fields);
  return { intent: "ISSUE", invoice };
}

export function parseUpdateIssue(input: unknown): UpdateIssueRequest {
  const parsed = updateIssueSchema.safeParse(input);
  if (!parsed.success) throw new DraftValidationError({
    ...collectRawIssueErrors(input),
    ...issueFields(parsed.error.issues),
  });
  const invoice = normalizeInvoice(parsed.data.invoice);
  const fields = { ...collectIssueRequiredErrors(invoice), ...collectDecimalErrors(invoice, "") };
  if (Object.keys(fields).length > 0) throw new DraftValidationError(fields);
  return { rowVersion: parsed.data.rowVersion, invoice };
}

export function readInvoiceIntent(input: unknown): "SAVE_DRAFT" | "ISSUE" | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const intent = (input as Record<string, unknown>).intent;
  return intent === "SAVE_DRAFT" || intent === "ISSUE" ? intent : null;
}

export function normalizeSuggestionName(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US")
    .replace(/[أإآٱ]/gu, "ا").replace(/ى/gu, "ي").replace(/ة/gu, "ه");
}

export function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 0, (month ?? 0) - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day;
}

export function dateInTimezone(at: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
