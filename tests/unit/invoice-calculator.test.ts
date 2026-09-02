import { describe, expect, it } from "vitest";
import { calculateInvoice, SQLITE_MONEY_MAX } from "@/domain/invoices/calculator";
import {
  asMinorUnitString,
  type CurrencySnapshot,
  InvoiceCalculationError,
  invoiceCalculationErrorCodes,
  type InvoiceCalculationInput,
} from "@/domain/invoices/contracts";
import { inspectDecimalInput } from "@/domain/invoices/decimal";
import { formatMinorUnits, formatMoney } from "@/domain/invoices/format";

const SDG: CurrencySnapshot = { code: "SDG", symbol: "ج.س", decimals: 2 };

function oneLine(quantity: string, unitPrice: string, currency = SDG) {
  return calculateInvoice({ lines: [{ quantity, unitPrice }] }, currency);
}

function expectCode(operation: () => unknown, code: string, path?: string): void {
  try {
    operation();
    throw new Error("Expected calculation to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(InvoiceCalculationError);
    expect(error).toMatchObject({ code, ...(path ? { path } : {}) });
  }
}

describe("basic Decimal invoice calculator", () => {
  it("covers AT-CALC-001 with quantity 2 × unit price 100", () => {
    const result = oneLine("2", "100");
    expect(result.lines[0]).toMatchObject({ baseMinor: "20000", taxableMinor: "20000", lineTotalMinor: "20000" });
    expect(result).toMatchObject({ subtotalMinor: "20000", taxableTotalMinor: "20000",
      grandTotalMinor: "20000", remainingMinor: "20000" });
    expect(formatMinorUnits(result.grandTotalMinor, 2)).toBe("200.00");
  });

  it("covers AT-CALC-002 without floating-point artifacts", () => {
    const result = oneLine("1.25", "80.00");
    expect(result.lines[0]).toMatchObject({ quantity: "1.25", unitPrice: "80", baseMinor: "10000" });
    expect(formatMinorUnits(result.grandTotalMinor, 2)).toBe("100.00");
  });

  it.each([
    { quantity: "0.1", price: "0.2", decimals: 2, minor: "2", display: "0.02" },
    { quantity: "1", price: "1.5", decimals: 0, minor: "2", display: "2" },
    { quantity: "1", price: "1.005", decimals: 2, minor: "101", display: "1.01" },
    { quantity: "1", price: "1.2345", decimals: 3, minor: "1235", display: "1.235" },
  ])("rounds $quantity × $price to $decimals places with ROUND_HALF_UP", ({ quantity, price, decimals, minor, display }) => {
    const result = oneLine(quantity, price, { code: "TST", symbol: "¤", decimals });
    expect(result.grandTotalMinor).toBe(minor);
    expect(formatMinorUnits(result.grandTotalMinor, decimals)).toBe(display);
  });

  it("adds multiple already-rounded line minor units exactly", () => {
    const result = calculateInvoice({ lines: [
      { quantity: "3", unitPrice: "0.335" },
      { quantity: "1.25", unitPrice: "80" },
      { quantity: "2", unitPrice: "100" },
    ] }, SDG);
    expect(result.lines.map((line) => line.baseMinor)).toEqual(["101", "10000", "20000"]);
    expect(result.subtotalMinor).toBe("30101");
  });

  it("allows a zero unit price and an empty invoice", () => {
    expect(oneLine("1", "0").grandTotalMinor).toBe("0");
    expect(calculateInvoice({ lines: [] }, SDG)).toMatchObject({ lines: [], subtotalMinor: "0", grandTotalMinor: "0" });
  });

  it.each([
    { quantity: "0", price: "1", code: invoiceCalculationErrorCodes.QUANTITY_MUST_BE_POSITIVE },
    { quantity: "-1", price: "1", code: invoiceCalculationErrorCodes.QUANTITY_MUST_BE_POSITIVE },
    { quantity: "1", price: "-0.01", code: invoiceCalculationErrorCodes.UNIT_PRICE_MUST_BE_NON_NEGATIVE },
    { quantity: "1.0000001", price: "1", code: invoiceCalculationErrorCodes.DECIMAL_SCALE_EXCEEDED },
    { quantity: "1", price: "0.0000001", code: invoiceCalculationErrorCodes.DECIMAL_SCALE_EXCEEDED },
  ])("rejects business-invalid values", ({ quantity, price, code }) => {
    expectCode(() => oneLine(quantity, price), code);
  });

  it.each(["1e3", "NaN", "Infinity", "1,000", "$1", "+1", " 1", "1 "])(
    "rejects non-canonical decimal notation %s", (value) => {
      expectCode(() => oneLine("1", value), invoiceCalculationErrorCodes.INVALID_DECIMAL);
    },
  );

  it("canonicalizes leading and trailing zeros without Number conversion", () => {
    const result = oneLine("0001.250000", "00080.000000");
    expect(result.lines[0]).toMatchObject({ quantity: "1.25", unitPrice: "80", baseMinor: "10000" });
  });

  it("distinguishes empty, incomplete, malformed, and valid draft input", () => {
    expect(inspectDecimalInput("", "quantity")).toEqual({ state: "empty" });
    expect(inspectDecimalInput("1.", "quantity")).toEqual({ state: "incomplete" });
    expect(inspectDecimalInput("abc", "quantity")).toEqual({ state: "malformed", code: "INVALID_DECIMAL" });
    expect(inspectDecimalInput("001.200", "quantity")).toEqual({ state: "valid", value: "1.2" });
    expectCode(() => oneLine("", "1"), invoiceCalculationErrorCodes.DECIMAL_REQUIRED, "invoice.lines.0.quantity");
    expectCode(() => oneLine("1.", "1"), invoiceCalculationErrorCodes.DECIMAL_INCOMPLETE);
  });

  it.each([-1, 4, 1.5])("rejects currencyDecimals=%s", (decimals) => {
    expectCode(() => oneLine("1", "1", { code: "TST", symbol: "¤", decimals }),
      invoiceCalculationErrorCodes.CURRENCY_DECIMALS_INVALID, "currency.decimals");
  });

  it("accepts the SQLite maximum and rejects a single-line overflow", () => {
    const maximum = oneLine("1", SQLITE_MONEY_MAX.toString(), { code: "TST", symbol: "¤", decimals: 0 });
    expect(maximum.grandTotalMinor).toBe(SQLITE_MONEY_MAX.toString());
    expectCode(() => oneLine("2", SQLITE_MONEY_MAX.toString(), { code: "TST", symbol: "¤", decimals: 0 }),
      invoiceCalculationErrorCodes.MONEY_OVERFLOW, "invoice.lines.0.baseMinor");
  });

  it("rejects cumulative overflow even when every line fits SQLite", () => {
    const halfPlusOne = "4611686018427387904";
    expectCode(() => calculateInvoice({ lines: [
      { quantity: "1", unitPrice: halfPlusOne },
      { quantity: "1", unitPrice: halfPlusOne },
    ] }, { code: "TST", symbol: "¤", decimals: 0 }),
    invoiceCalculationErrorCodes.MONEY_OVERFLOW, "invoice.subtotalMinor");
  });

  it("keeps all discount, tax, and collection fields at zero in Milestone 1", () => {
    const result = oneLine("2", "100");
    expect(result.lines[0]).toMatchObject({ discountMinor: "0", allocatedInvoiceDiscountMinor: "0", taxMinor: "0" });
    expect(result).toMatchObject({ lineDiscountsMinor: "0", invoiceDiscountMinor: "0", discountTotalMinor: "0",
      taxTotalMinor: "0", grossPaidMinor: "0", refundedTotalMinor: "0", netCollectedMinor: "0" });
    expect(result.remainingMinor).toBe(result.grandTotalMinor);
  });

  it("rejects forged top-level and line totals instead of trusting them", () => {
    const forgedInvoice = { lines: [{ quantity: "1", unitPrice: "1" }], grandTotalMinor: "1" } as unknown as InvoiceCalculationInput;
    expectCode(() => calculateInvoice(forgedInvoice, SDG), invoiceCalculationErrorCodes.UNKNOWN_CALCULATION_FIELD,
      "invoice.grandTotalMinor");
    const forgedLine = { lines: [{ quantity: "1", unitPrice: "1", lineTotalMinor: "1" }] } as unknown as InvoiceCalculationInput;
    expectCode(() => calculateInvoice(forgedLine, SDG), invoiceCalculationErrorCodes.UNKNOWN_CALCULATION_FIELD,
      "invoice.lines.0.lineTotalMinor");
  });

  it("returns JSON-safe strings and copies the currency snapshot", () => {
    const currency = { ...SDG };
    const result = oneLine("1.25", "80", currency);
    currency.decimals = 0;
    expect(result.currency).toEqual(SDG);
    expect(() => JSON.stringify(result)).not.toThrow();
    expect(JSON.stringify(result)).not.toContain("bigint");
    expect(Object.values(result).some((value) => typeof value === "bigint")).toBe(false);
  });

  it("formats the largest value textually without losing precision", () => {
    const maximum = asMinorUnitString(SQLITE_MONEY_MAX.toString());
    expect(formatMinorUnits(maximum, 3)).toBe("9223372036854775.807");
    expect(formatMoney(maximum, { code: "TST", symbol: "¤", decimals: 3 }))
      .toBe("9223372036854775.807 ¤");
  });
});
