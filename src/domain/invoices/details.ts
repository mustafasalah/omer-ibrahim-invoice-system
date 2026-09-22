import { asMinorUnitString, type CurrencySnapshot } from "./contracts";
import { formatMoney } from "./format";

export type InvoiceStatusKey = "draft" | "issued" | "cancelled" | "unknown";
export type PaymentStatusKey = "unpaid" | "partiallyPaid" | "fullyPaid" | "partiallyRefunded" |
  "fullyRefunded" | "unknown";

const invoiceStatusKeys: Readonly<Record<string, InvoiceStatusKey>> = {
  DRAFT: "draft",
  ISSUED: "issued",
  CANCELLED: "cancelled",
};

const paymentStatusKeys: Readonly<Record<string, PaymentStatusKey>> = {
  UNPAID: "unpaid",
  PARTIALLY_PAID: "partiallyPaid",
  FULLY_PAID: "fullyPaid",
  PARTIALLY_REFUNDED: "partiallyRefunded",
  FULLY_REFUNDED: "fullyRefunded",
};

export function invoiceStatusKey(value: string): InvoiceStatusKey {
  return invoiceStatusKeys[value] ?? "unknown";
}

export function paymentStatusKey(value: string): PaymentStatusKey {
  return paymentStatusKeys[value] ?? "unknown";
}

export function formatStoredMoney(value: string, currency: CurrencySnapshot): string {
  return formatMoney(asMinorUnitString(value), currency);
}

export function formatStoredQuantity(value: string | null): string | null {
  return value;
}

export function formatStoredUnitPrice(value: string | null, currency: CurrencySnapshot): string | null {
  return value === null ? null : `${value} ${currency.symbol}`;
}

export type DateDisplayFormat = "DD/MM/YYYY" | "YYYY-MM-DD";

function dateParts(date: Date, locale: string, timeZone: string): Record<string, string> {
  return Object.fromEntries(new Intl.DateTimeFormat(locale, {
    year: "numeric", month: "2-digit", day: "2-digit", timeZone,
  }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
}

function displayDate(date: Date, format: DateDisplayFormat, locale: string, timeZone: string): string {
  const parts = dateParts(date, locale, timeZone);
  return format === "YYYY-MM-DD"
    ? `${parts.year}-${parts.month}-${parts.day}`
    : `${parts.day}/${parts.month}/${parts.year}`;
}

export function formatCalendarDate(
  value: string,
  format: DateDisplayFormat = "DD/MM/YYYY",
  locale = "ar-SD",
): string {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return value;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return value;
  return displayDate(date, format, locale, "UTC");
}

export function formatTimestampInTimezone(
  value: string,
  timeZone: string,
  format: DateDisplayFormat = "DD/MM/YYYY",
  locale = "ar-SD",
): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  try {
    const time = new Intl.DateTimeFormat(locale, {
      hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone,
    }).format(date);
    return `${displayDate(date, format, locale, timeZone)} ${time}`;
  } catch {
    return value;
  }
}
