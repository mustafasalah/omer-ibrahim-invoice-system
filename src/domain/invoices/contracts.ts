declare const decimalStringBrand: unique symbol;
declare const minorUnitStringBrand: unique symbol;

/** Canonical, non-exponent decimal notation. Construct through the decimal helpers. */
export type DecimalString = string & { readonly [decimalStringBrand]: true };

/** Canonical non-negative integer notation for JSON-safe minor units. */
export type MinorUnitString = string & { readonly [minorUnitStringBrand]: true };

export type CurrencySnapshot = {
  code: string;
  symbol: string;
  decimals: number;
};

export type InvoiceCalculationLineInput = {
  quantity: string;
  unitPrice: string;
};

export type InvoiceCalculationInput = {
  lines: readonly InvoiceCalculationLineInput[];
};

export type CalculatedInvoiceLine = {
  quantity: DecimalString;
  unitPrice: DecimalString;
  baseMinor: MinorUnitString;
  discountMinor: MinorUnitString;
  allocatedInvoiceDiscountMinor: MinorUnitString;
  taxableMinor: MinorUnitString;
  taxMinor: MinorUnitString;
  lineTotalMinor: MinorUnitString;
};

export type CalculatedInvoice = {
  currency: CurrencySnapshot;
  lines: readonly CalculatedInvoiceLine[];
  subtotalMinor: MinorUnitString;
  lineDiscountsMinor: MinorUnitString;
  invoiceDiscountMinor: MinorUnitString;
  discountTotalMinor: MinorUnitString;
  taxableTotalMinor: MinorUnitString;
  taxTotalMinor: MinorUnitString;
  grandTotalMinor: MinorUnitString;
  grossPaidMinor: MinorUnitString;
  refundedTotalMinor: MinorUnitString;
  netCollectedMinor: MinorUnitString;
  remainingMinor: MinorUnitString;
};

export const invoiceCalculationErrorCodes = {
  CALCULATION_INPUT_INVALID: "CALCULATION_INPUT_INVALID",
  UNKNOWN_CALCULATION_FIELD: "UNKNOWN_CALCULATION_FIELD",
  DECIMAL_REQUIRED: "DECIMAL_REQUIRED",
  DECIMAL_INCOMPLETE: "DECIMAL_INCOMPLETE",
  INVALID_DECIMAL: "INVALID_DECIMAL",
  DECIMAL_SCALE_EXCEEDED: "DECIMAL_SCALE_EXCEEDED",
  QUANTITY_MUST_BE_POSITIVE: "QUANTITY_MUST_BE_POSITIVE",
  UNIT_PRICE_MUST_BE_NON_NEGATIVE: "UNIT_PRICE_MUST_BE_NON_NEGATIVE",
  CURRENCY_DECIMALS_INVALID: "CURRENCY_DECIMALS_INVALID",
  CURRENCY_SNAPSHOT_INVALID: "CURRENCY_SNAPSHOT_INVALID",
  MONEY_OVERFLOW: "MONEY_OVERFLOW",
} as const;

export type InvoiceCalculationErrorCode =
  (typeof invoiceCalculationErrorCodes)[keyof typeof invoiceCalculationErrorCodes];

export class InvoiceCalculationError extends Error {
  constructor(
    readonly code: InvoiceCalculationErrorCode,
    readonly path?: string,
  ) {
    super(code);
    this.name = "InvoiceCalculationError";
  }
}

export type DecimalInputKind = "quantity" | "unitPrice";

export type DecimalInputInspection =
  | { state: "empty" }
  | { state: "incomplete" }
  | { state: "malformed"; code: InvoiceCalculationErrorCode }
  | { state: "valid"; value: DecimalString };

export function asDecimalString(value: string): DecimalString {
  return value as DecimalString;
}

export function asMinorUnitString(value: string): MinorUnitString {
  return value as MinorUnitString;
}

