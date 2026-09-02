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
): void {
  fields[`invoice.items.${index}.${field}`] = message;
  if (item.clientKey) fields[`invoice.itemsByClientKey.${item.clientKey}.${field}`] = message;
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

function validateDecimals(invoice: DraftInvoiceInput): void {
  const fields: Record<string, string> = {};
  invoice.items.forEach((item, index) => {
    for (const field of ["quantity", "unitPrice"] as const) {
      if (item[field] === null) continue;
      const inspection = inspectDecimalInput(item[field], field);
      if (inspection.state !== "valid") {
        const message = inspection.state === "malformed" ? inspection.code : "INVALID_DECIMAL";
        addClientKeyError(fields, item, index, field, message);
      } else {
        item[field] = inspection.value as DecimalString;
      }
    }
  });
  if (Object.keys(fields).length > 0) throw new DraftValidationError(fields);
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
