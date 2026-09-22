import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  formatCalendarDate,
  formatStoredMoney,
  formatStoredQuantity,
  formatStoredUnitPrice,
  formatTimestampInTimezone,
  invoiceStatusKey,
  paymentStatusKey,
} from "@/domain/invoices/details";

describe("invoice detail presentation", () => {
  it("maps stored lifecycle axes without deriving or changing them", () => {
    expect(invoiceStatusKey("DRAFT")).toBe("draft");
    expect(invoiceStatusKey("ISSUED")).toBe("issued");
    expect(invoiceStatusKey("CANCELLED")).toBe("cancelled");
    expect(invoiceStatusKey("FUTURE_STATUS")).toBe("unknown");
    expect(paymentStatusKey("UNPAID")).toBe("unpaid");
    expect(paymentStatusKey("PARTIALLY_REFUNDED")).toBe("partiallyRefunded");
    expect(paymentStatusKey("FUTURE_STATUS")).toBe("unknown");
  });

  it("formats stored minor-unit strings exactly without floating point", () => {
    expect(formatStoredMoney("9223372036854775807", { code: "SDG", symbol: "ج.س", decimals: 3 }))
      .toBe("9223372036854775.807 ج.س");
    expect(formatStoredMoney("5", { code: "SDG", symbol: "ج.س", decimals: 2 })).toBe("0.05 ج.س");
    expect(formatStoredQuantity("1.2500")).toBe("1.2500");
    expect(formatStoredQuantity(null)).toBeNull();
    expect(formatStoredUnitPrice("40.000", { code: "SDG", symbol: "ج.س", decimals: 2 })).toBe("40.000 ج.س");

    const sources = [
      path.resolve(process.cwd(), "src/domain/invoices/details.ts"),
      path.resolve(process.cwd(), "src/app/invoices/[id]/page.tsx"),
    ].map((file) => readFileSync(file, "utf8")).join("\n");
    expect(sources).not.toMatch(/\b(?:parseFloat|parseInt)\s*\(/u);
    expect(sources).not.toMatch(/\bNumber\s*\(/u);
  });

  it("uses the saved date format and establishment timezone across a UTC year boundary", () => {
    expect(formatCalendarDate("2026-09-10", "DD/MM/YYYY", "en-GB")).toBe("10/09/2026");
    expect(formatCalendarDate("2026-09-10", "YYYY-MM-DD", "en-GB")).toBe("2026-09-10");
    expect(formatTimestampInTimezone(
      "2026-12-31T22:30:00.000Z", "Africa/Khartoum", "DD/MM/YYYY", "en-GB",
    )).toBe("01/01/2027 00:30");
    expect(formatTimestampInTimezone(
      "2026-12-31T22:30:00.000Z", "UTC", "YYYY-MM-DD", "en-GB",
    )).toBe("2026-12-31 22:30");
    expect(formatCalendarDate("stored-as-is", "DD/MM/YYYY", "en-GB")).toBe("stored-as-is");
  });
});
