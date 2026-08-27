import { z } from "zod";
import { InvoiceNumberPatternError, parseInvoiceNumberPattern, validateInvoicePrefix } from "./numbering";

export class SettingsValidationError extends Error {
  constructor(readonly fieldErrors: Record<string, string>) {
    super("Invalid settings.");
    this.name = "SettingsValidationError";
  }
}

const nullableText = (maximum: number) => z.string().trim().max(maximum).nullable();

const editableSettingsSchema = z.object({
  company: z.object({
    nameAr: z.string().trim().min(1).max(200),
    nameEn: z.string().trim().min(1).max(200),
    address: nullableText(500),
    phones: z.array(z.string().trim().min(3).max(30).regex(/^[+\d()\s-]+$/u)).max(5),
    email: z.string().trim().toLowerCase().email().max(254).nullable(),
    registrationNumber: nullableText(100),
  }).strict(),
  currency: z.object({
    code: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/u),
    symbolAr: z.string().trim().min(1).max(10),
    decimals: z.number().int().min(0).max(3),
  }).strict(),
  numbering: z.object({
    prefix: z.string().trim().min(1).max(20),
    pattern: z.string().trim().min(1).max(100),
    sequenceStart: z.number().int().min(1).max(9_999_999_999),
    resetPolicy: z.enum(["NEVER", "YEARLY"]),
  }).strict(),
  regional: z.object({
    dateDisplayFormat: z.enum(["DD/MM/YYYY", "YYYY-MM-DD"]),
    timezone: z.string().trim().min(1).max(100),
    paperFormat: z.literal("A4"),
  }).strict(),
  session: z.object({ idleMinutes: z.number().int().min(5).max(1440) }).strict(),
  defaultPaymentTerms: nullableText(2_000),
  footerText: nullableText(1_000),
}).strict().superRefine((settings, context) => {
  try {
    validateInvoicePrefix(settings.numbering.prefix);
  } catch {
    context.addIssue({ code: "custom", path: ["numbering", "prefix"], message: "Invalid invoice prefix." });
  }
  try {
    const { sequenceWidth } = parseInvoiceNumberPattern(settings.numbering.pattern);
    if (settings.numbering.resetPolicy === "YEARLY" && !/\{YYYY\}|\{YY\}/u.test(settings.numbering.pattern)) {
      throw new InvoiceNumberPatternError("Missing year token.");
    }
    if (String(settings.numbering.sequenceStart).length > sequenceWidth) {
      throw new InvoiceNumberPatternError("Sequence start exceeds token width.");
    }
  } catch {
    context.addIssue({ code: "custom", path: ["numbering", "pattern"], message: "Invalid invoice number pattern." });
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: settings.regional.timezone }).format();
  } catch {
    context.addIssue({ code: "custom", path: ["regional", "timezone"], message: "Invalid IANA timezone." });
  }
});

const patchSettingsSchema = z.object({
  rowVersion: z.number().int().min(1),
  settings: editableSettingsSchema,
}).strict();

export type SettingsPatchInput = z.infer<typeof patchSettingsSchema>;

function normalizeNullable(value: string | null): string | null {
  return value === null || value === "" ? null : value;
}

export function parseSettingsPatch(input: unknown): SettingsPatchInput {
  const parsed = patchSettingsSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      fieldErrors[issue.path.join(".") || "request"] ??= issue.message;
    }
    throw new SettingsValidationError(fieldErrors);
  }
  const settings = parsed.data.settings;
  settings.company.nameAr = settings.company.nameAr.normalize("NFC");
  settings.company.nameEn = settings.company.nameEn.normalize("NFC");
  settings.company.address = normalizeNullable(settings.company.address);
  settings.company.email = normalizeNullable(settings.company.email);
  settings.company.registrationNumber = normalizeNullable(settings.company.registrationNumber);
  settings.defaultPaymentTerms = normalizeNullable(settings.defaultPaymentTerms);
  settings.footerText = normalizeNullable(settings.footerText);
  settings.company.phones = [...new Set(settings.company.phones.map((phone) => phone.normalize("NFKC")))];
  settings.numbering.prefix = settings.numbering.prefix.normalize("NFKC");
  settings.numbering.pattern = settings.numbering.pattern.normalize("NFKC");
  return parsed.data;
}
