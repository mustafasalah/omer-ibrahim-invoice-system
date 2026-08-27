import { describe, expect, it } from "vitest";
import { formatInvoiceNumber, parseInvoiceNumberPattern, yearInTimezone } from "@/domain/settings/numbering";

describe("invoice numbering settings", () => {
  it("parses the constrained tokens and formats a padded preview", () => {
    expect(parseInvoiceNumberPattern("{PREFIX}-{YYYY}-{SEQ:5}")).toEqual({ sequenceWidth: 5 });
    expect(formatInvoiceNumber({ prefix: "OI", pattern: "{PREFIX}-{YY}-{SEQ:5}",
      resetPolicy: "YEARLY", nextValue: 42n, at: new Date("2026-08-27T10:00:00Z"),
      timezone: "Africa/Khartoum" })).toMatchObject({ invoiceNumber: "OI-26-00042", sequenceKey: "invoice:2026" });
  });

  it.each(["{PREFIX}-{SEQ:2}", "{PREFIX}-{SEQ:11}", "{PREFIX}", "{SEQ:5}-{SEQ:5}", "{PREFIX}-{BAD}-{SEQ:5}"])(
    "rejects invalid pattern %s", (pattern) => expect(() => parseInvoiceNumberPattern(pattern)).toThrow(),
  );

  it("uses company timezone at a year boundary", () => {
    const instant = new Date("2026-12-31T22:30:00.000Z");
    expect(yearInTimezone(instant, "Africa/Khartoum")).toBe(2027);
    expect(yearInTimezone(instant, "UTC")).toBe(2026);
  });

  it("requires a year token for yearly reset and rejects unsafe prefixes", () => {
    expect(() => formatInvoiceNumber({ prefix: "OI", pattern: "{PREFIX}-{SEQ:5}", resetPolicy: "YEARLY",
      nextValue: 1n, at: new Date(), timezone: "UTC" })).toThrow();
    expect(() => formatInvoiceNumber({ prefix: "../OI", pattern: "{PREFIX}-{SEQ:5}", resetPolicy: "NEVER",
      nextValue: 1n, at: new Date(), timezone: "UTC" })).toThrow();
  });
});

