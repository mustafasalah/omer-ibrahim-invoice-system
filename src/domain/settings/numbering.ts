import type { InvoiceNumberPreview, SequenceResetPolicy } from "./contracts";

export const MIN_SEQUENCE_WIDTH = 3;
export const MAX_SEQUENCE_WIDTH = 10;

export class InvoiceNumberPatternError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvoiceNumberPatternError";
  }
}

export function validateInvoicePrefix(prefix: string): void {
  if (
    prefix.length < 1 ||
    prefix.length > 20 ||
    !/^[\p{L}\p{N}_-]+$/u.test(prefix) ||
    /[\p{Cc}\p{Cf}]/u.test(prefix)
  ) {
    throw new InvoiceNumberPatternError("Invalid invoice prefix.");
  }
}

export function parseInvoiceNumberPattern(pattern: string): { sequenceWidth: number } {
  if (pattern.length < 1 || pattern.length > 100) {
    throw new InvoiceNumberPatternError("Invalid invoice number pattern length.");
  }

  const withoutTokens = pattern.replace(/\{(PREFIX|YYYY|YY|SEQ:(\d+))\}/gu, (_, token: string, width?: string) => {
    if (token.startsWith("SEQ:")) {
      const parsedWidth = Number(width);
      if (!Number.isInteger(parsedWidth) || parsedWidth < MIN_SEQUENCE_WIDTH || parsedWidth > MAX_SEQUENCE_WIDTH) {
        throw new InvoiceNumberPatternError("Invalid sequence width.");
      }
    }
    return "";
  });

  if (/[{}]/u.test(withoutTokens)) {
    throw new InvoiceNumberPatternError("Unknown or unmatched invoice number token.");
  }

  const sequences = [...pattern.matchAll(/\{SEQ:(\d+)\}/gu)];
  if (sequences.length !== 1) {
    throw new InvoiceNumberPatternError("The pattern must contain exactly one sequence token.");
  }

  return { sequenceWidth: Number(sequences[0]?.[1]) };
}

export function yearInTimezone(at: Date, timezone: string): number {
  const year = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
  }).formatToParts(at).find((part) => part.type === "year")?.value;
  if (!year) throw new RangeError("Could not determine year in timezone.");
  return Number(year);
}

export function sequenceKeyFor(resetPolicy: SequenceResetPolicy, year: number): string {
  return resetPolicy === "YEARLY" ? `invoice:${year}` : "invoice:global";
}

export function formatInvoiceNumber(options: {
  prefix: string;
  pattern: string;
  resetPolicy: SequenceResetPolicy;
  nextValue: bigint;
  at: Date;
  timezone: string;
}): InvoiceNumberPreview {
  validateInvoicePrefix(options.prefix);
  const { sequenceWidth } = parseInvoiceNumberPattern(options.pattern);
  if (options.resetPolicy === "YEARLY" && !/\{YYYY\}|\{YY\}/u.test(options.pattern)) {
    throw new InvoiceNumberPatternError("A yearly pattern must include a year token.");
  }
  const year = yearInTimezone(options.at, options.timezone);
  const sequence = options.nextValue.toString().padStart(sequenceWidth, "0");
  if (sequence.length > sequenceWidth) {
    throw new InvoiceNumberPatternError("The next sequence does not fit the selected width.");
  }
  return {
    invoiceNumber: options.pattern
      .replaceAll("{PREFIX}", options.prefix)
      .replaceAll("{YYYY}", String(year))
      .replaceAll("{YY}", String(year).slice(-2))
      .replace(/\{SEQ:\d+\}/u, sequence),
    sequenceKey: sequenceKeyFor(options.resetPolicy, year),
    nextValue: options.nextValue.toString(),
    year,
  };
}

