import Decimal from "decimal.js";
import {
  asMinorUnitString,
  type CalculatedInvoice,
  type CalculatedInvoiceLine,
  type CurrencySnapshot,
  type InvoiceCalculationInput,
  InvoiceCalculationError,
  invoiceCalculationErrorCodes,
  type MinorUnitString,
} from "./contracts";
import { requireDecimalInput } from "./decimal";

export const SQLITE_MONEY_MAX = 9_223_372_036_854_775_807n;
const ZERO_MINOR = asMinorUnitString("0");
const CalculationDecimal = Decimal.clone({
  precision: 256,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -1_000,
  toExpPos: 1_000,
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertExactKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      throw new InvoiceCalculationError(
        invoiceCalculationErrorCodes.UNKNOWN_CALCULATION_FIELD,
        path ? `${path}.${key}` : key,
      );
    }
  }
}

function validateCurrency(value: unknown): CurrencySnapshot {
  if (!isRecord(value)) {
    throw new InvoiceCalculationError(invoiceCalculationErrorCodes.CURRENCY_SNAPSHOT_INVALID, "currency");
  }
  assertExactKeys(value, ["code", "symbol", "decimals"], "currency");
  if (!Number.isInteger(value.decimals) || typeof value.decimals !== "number" || value.decimals < 0 || value.decimals > 3) {
    throw new InvoiceCalculationError(invoiceCalculationErrorCodes.CURRENCY_DECIMALS_INVALID, "currency.decimals");
  }
  if (typeof value.code !== "string" || !/^[A-Z]{3}$/u.test(value.code) ||
      typeof value.symbol !== "string" || value.symbol.length < 1 || value.symbol.length > 10) {
    throw new InvoiceCalculationError(invoiceCalculationErrorCodes.CURRENCY_SNAPSHOT_INVALID, "currency");
  }
  return { code: value.code, symbol: value.symbol, decimals: value.decimals };
}

function toCheckedMinor(value: Decimal, currencyDecimals: number, path: string): bigint {
  const roundedMajor = value.toDecimalPlaces(currencyDecimals, Decimal.ROUND_HALF_UP);
  const minorText = roundedMajor.times(new CalculationDecimal(10).pow(currencyDecimals)).toFixed(0);
  const minor = BigInt(minorText);
  if (minor < 0n || minor > SQLITE_MONEY_MAX) {
    throw new InvoiceCalculationError(invoiceCalculationErrorCodes.MONEY_OVERFLOW, path);
  }
  return minor;
}

function checkedAdd(total: bigint, value: bigint, path: string): bigint {
  const result = total + value;
  if (result < 0n || result > SQLITE_MONEY_MAX) {
    throw new InvoiceCalculationError(invoiceCalculationErrorCodes.MONEY_OVERFLOW, path);
  }
  return result;
}

function minorString(value: bigint): MinorUnitString {
  return asMinorUnitString(value.toString());
}

export function calculateInvoice(input: InvoiceCalculationInput, currencyInput: CurrencySnapshot): CalculatedInvoice {
  const currency = validateCurrency(currencyInput);
  if (!isRecord(input)) {
    throw new InvoiceCalculationError(invoiceCalculationErrorCodes.CALCULATION_INPUT_INVALID, "invoice");
  }
  assertExactKeys(input, ["lines"], "invoice");
  if (!Array.isArray(input.lines)) {
    throw new InvoiceCalculationError(invoiceCalculationErrorCodes.CALCULATION_INPUT_INVALID, "invoice.lines");
  }

  const lines: CalculatedInvoiceLine[] = [];
  let subtotal = 0n;
  for (const [index, rawLine] of input.lines.entries()) {
    const path = `invoice.lines.${index}`;
    if (!isRecord(rawLine)) {
      throw new InvoiceCalculationError(invoiceCalculationErrorCodes.CALCULATION_INPUT_INVALID, path);
    }
    assertExactKeys(rawLine, ["quantity", "unitPrice"], path);
    const quantity = requireDecimalInput(rawLine.quantity, "quantity", `${path}.quantity`);
    const unitPrice = requireDecimalInput(rawLine.unitPrice, "unitPrice", `${path}.unitPrice`);
    const base = new CalculationDecimal(quantity).times(new CalculationDecimal(unitPrice));
    const baseMinorValue = toCheckedMinor(base, currency.decimals, `${path}.baseMinor`);
    subtotal = checkedAdd(subtotal, baseMinorValue, "invoice.subtotalMinor");
    const baseMinor = minorString(baseMinorValue);
    lines.push({
      quantity,
      unitPrice,
      baseMinor,
      discountMinor: ZERO_MINOR,
      allocatedInvoiceDiscountMinor: ZERO_MINOR,
      taxableMinor: baseMinor,
      taxMinor: ZERO_MINOR,
      lineTotalMinor: baseMinor,
    });
  }

  const subtotalMinor = minorString(subtotal);
  return {
    currency,
    lines,
    subtotalMinor,
    lineDiscountsMinor: ZERO_MINOR,
    invoiceDiscountMinor: ZERO_MINOR,
    discountTotalMinor: ZERO_MINOR,
    taxableTotalMinor: subtotalMinor,
    taxTotalMinor: ZERO_MINOR,
    grandTotalMinor: subtotalMinor,
    grossPaidMinor: ZERO_MINOR,
    refundedTotalMinor: ZERO_MINOR,
    netCollectedMinor: ZERO_MINOR,
    remainingMinor: subtotalMinor,
  };
}

