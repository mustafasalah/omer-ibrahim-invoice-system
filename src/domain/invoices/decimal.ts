import {
  asDecimalString,
  type DecimalInputInspection,
  type DecimalInputKind,
  type DecimalString,
  InvoiceCalculationError,
  invoiceCalculationErrorCodes,
} from "./contracts";

export const MAX_DECIMAL_SCALE = 6;
export const MAX_DECIMAL_CHARACTERS = 100;

const plainUnsignedDecimal = /^\d+(?:\.\d+)?$/u;
const incompleteUnsignedDecimal = /^(?:\.|\d+\.)$/u;

function canonicalizeUnsignedDecimal(value: string): DecimalString {
  const [integerPart = "", fractionPart] = value.split(".");
  const canonicalInteger = integerPart.replace(/^0+(?=\d)/u, "");
  if (fractionPart === undefined) return asDecimalString(canonicalInteger);
  const canonicalFraction = fractionPart.replace(/0+$/u, "");
  return asDecimalString(canonicalFraction ? `${canonicalInteger}.${canonicalFraction}` : canonicalInteger);
}

export function inspectDecimalInput(value: unknown, kind: DecimalInputKind): DecimalInputInspection {
  if (value === "") return { state: "empty" };
  if (typeof value !== "string" || value.length > MAX_DECIMAL_CHARACTERS) {
    return { state: "malformed", code: invoiceCalculationErrorCodes.INVALID_DECIMAL };
  }
  if (incompleteUnsignedDecimal.test(value)) return { state: "incomplete" };
  if (!plainUnsignedDecimal.test(value)) {
    if (/^-\d+(?:\.\d+)?$/u.test(value)) {
      return {
        state: "malformed",
        code: kind === "quantity"
          ? invoiceCalculationErrorCodes.QUANTITY_MUST_BE_POSITIVE
          : invoiceCalculationErrorCodes.UNIT_PRICE_MUST_BE_NON_NEGATIVE,
      };
    }
    return { state: "malformed", code: invoiceCalculationErrorCodes.INVALID_DECIMAL };
  }
  const fractionLength = value.includes(".") ? (value.split(".")[1]?.length ?? 0) : 0;
  if (fractionLength > MAX_DECIMAL_SCALE) {
    return { state: "malformed", code: invoiceCalculationErrorCodes.DECIMAL_SCALE_EXCEEDED };
  }
  const canonical = canonicalizeUnsignedDecimal(value);
  if (kind === "quantity" && /^0(?:\.0*)?$/u.test(value)) {
    return { state: "malformed", code: invoiceCalculationErrorCodes.QUANTITY_MUST_BE_POSITIVE };
  }
  return { state: "valid", value: canonical };
}

export function requireDecimalInput(value: unknown, kind: DecimalInputKind, path: string): DecimalString {
  const inspection = inspectDecimalInput(value, kind);
  if (inspection.state === "valid") return inspection.value;
  const code = inspection.state === "empty"
    ? invoiceCalculationErrorCodes.DECIMAL_REQUIRED
    : inspection.state === "incomplete"
      ? invoiceCalculationErrorCodes.DECIMAL_INCOMPLETE
      : inspection.code;
  throw new InvoiceCalculationError(code, path);
}

