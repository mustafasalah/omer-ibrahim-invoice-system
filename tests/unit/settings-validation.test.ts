import { describe, expect, it } from "vitest";
import { parseSettingsPatch, SettingsValidationError } from "@/domain/settings/validation";

const valid = { rowVersion: 1, settings: {
  company: { nameAr: "شركة", nameEn: "Company", address: null, phones: ["+249 123"], email: null, registrationNumber: null },
  currency: { code: "sdg", symbolAr: "ج.س", decimals: 2 },
  numbering: { prefix: "OI", pattern: "{PREFIX}-{YYYY}-{SEQ:5}", sequenceStart: 1, resetPolicy: "YEARLY" },
  regional: { dateDisplayFormat: "DD/MM/YYYY", timezone: "Africa/Khartoum", paperFormat: "A4" },
  session: { idleMinutes: 30 }, defaultPaymentTerms: null, footerText: null,
} };

describe("settings validation", () => {
  it("normalizes controlled fields and de-duplicates phones", () => {
    const parsed = parseSettingsPatch({ ...valid, settings: { ...valid.settings,
      company: { ...valid.settings.company, phones: ["+249 123", "+249 123"], email: " ADMIN@EXAMPLE.COM " } } });
    expect(parsed.settings.currency.code).toBe("SDG");
    expect(parsed.settings.company.email).toBe("admin@example.com");
    expect(parsed.settings.company.phones).toEqual(["+249 123"]);
  });

  it.each([
    { extra: true },
    { settings: { ...valid.settings, currency: { ...valid.settings.currency, decimals: 4 } } },
    { settings: { ...valid.settings, regional: { ...valid.settings.regional, timezone: "Not/AZone" } } },
    { settings: { ...valid.settings, regional: { ...valid.settings.regional, paperFormat: "A5" } } },
    { settings: { ...valid.settings, session: { idleMinutes: 4 } } },
  ])("rejects unsafe or unknown input", (override) => {
    expect(() => parseSettingsPatch({ ...valid, ...override })).toThrow(SettingsValidationError);
  });

  it("returns stable domain codes instead of raw validator messages", () => {
    try {
      parseSettingsPatch({ ...valid, settings: { ...valid.settings,
        regional: { ...valid.settings.regional, timezone: "Not/AZone" } } });
      throw new Error("Expected validation to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(SettingsValidationError);
      expect((error as SettingsValidationError).fieldErrors["settings.regional.timezone"]).toBe("INVALID_TIMEZONE");
      expect(JSON.stringify((error as SettingsValidationError).fieldErrors)).not.toMatch(/expected|received|invalid_type/iu);
    }
  });
});
