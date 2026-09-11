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

export function formatCalendarDate(value: string, locale = "ar-SD"): string {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return value;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(date);
}

export function formatUtcTimestamp(value: string, locale = "ar-SD"): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date);
}
