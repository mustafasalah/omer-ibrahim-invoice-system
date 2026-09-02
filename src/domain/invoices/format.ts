import {
  asDecimalString,
  type CurrencySnapshot,
  type DecimalString,
  InvoiceCalculationError,
  invoiceCalculationErrorCodes,
  type MinorUnitString,
} from "./contracts";
import { SQLITE_MONEY_MAX } from "./calculator";

const canonicalMinorUnits = /^(?:0|[1-9]\d*)$/u;

function validateDecimals(decimals: number): void {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 3) {
    throw new InvoiceCalculationError(invoiceCalculationErrorCodes.CURRENCY_DECIMALS_INVALID, "currency.decimals");
  }
}

export function formatMinorUnits(value: MinorUnitString, decimals: number): DecimalString {
  validateDecimals(decimals);
  if (!canonicalMinorUnits.test(value) || BigInt(value) > SQLITE_MONEY_MAX) {
    throw new InvoiceCalculationError(invoiceCalculationErrorCodes.MONEY_OVERFLOW, "minorUnits");
  }
  if (decimals === 0) return asDecimalString(value);
  const padded = value.padStart(decimals + 1, "0");
  const splitAt = padded.length - decimals;
  return asDecimalString(`${padded.slice(0, splitAt)}.${padded.slice(splitAt)}`);
}

export function formatMoney(value: MinorUnitString, currency: CurrencySnapshot): string {
  return `${formatMinorUnits(value, currency.decimals)} ${currency.symbol}`;
}

