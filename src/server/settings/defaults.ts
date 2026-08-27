import "server-only";

import type { DatabaseConnection } from "@/server/db/connection";
import { appSettings } from "@/server/db/schema";

export const DEFAULT_SETTINGS = {
  companyNameAr: "أعمال عمر إبراهيم أحمد سليمان للاستيراد وتوزيع المستلزمات الطبية",
  companyNameEn: "OMER IBRAHIM MEDICAL SUPPLIES",
  currencyCode: "SDG",
  currencySymbolAr: "ج.س",
  currencyDecimals: 2,
  invoiceNumberPrefix: "OI",
  invoiceNumberPattern: "{PREFIX}-{YYYY}-{SEQ:5}",
  sequenceStart: 1,
  sequenceResetPolicy: "YEARLY" as const,
  dateDisplayFormat: "DD/MM/YYYY" as const,
  paperFormat: "A4" as const,
  timezone: "Africa/Khartoum",
  sessionIdleMinutes: 30,
  sessionAbsoluteHours: 12,
};

export function insertDefaultSettings(connection: DatabaseConnection, now: string): void {
  connection.db.insert(appSettings).values({
    id: "default",
    companyNameAr: DEFAULT_SETTINGS.companyNameAr,
    companyNameEn: DEFAULT_SETTINGS.companyNameEn,
    address: null,
    phonesJson: "[]",
    email: null,
    registrationNumber: null,
    currencyCode: DEFAULT_SETTINGS.currencyCode,
    currencySymbolAr: DEFAULT_SETTINGS.currencySymbolAr,
    currencyDecimals: DEFAULT_SETTINGS.currencyDecimals,
    taxEnabled: false,
    defaultTaxRateBps: 0,
    invoiceNumberPrefix: DEFAULT_SETTINGS.invoiceNumberPrefix,
    invoiceNumberPattern: DEFAULT_SETTINGS.invoiceNumberPattern,
    sequenceStart: DEFAULT_SETTINGS.sequenceStart,
    sequenceResetPolicy: DEFAULT_SETTINGS.sequenceResetPolicy,
    defaultPaymentTerms: null,
    footerText: null,
    dateDisplayFormat: DEFAULT_SETTINGS.dateDisplayFormat,
    paperFormat: DEFAULT_SETTINGS.paperFormat,
    timezone: DEFAULT_SETTINGS.timezone,
    lanAccessEnabled: false,
    sessionIdleMinutes: DEFAULT_SETTINGS.sessionIdleMinutes,
    sessionAbsoluteHours: DEFAULT_SETTINGS.sessionAbsoluteHours,
    companyLogoAssetId: null,
    stampAssetId: null,
    signatureAssetId: null,
    updatedAt: now,
    updatedBy: null,
    rowVersion: 1,
  }).onConflictDoNothing({ target: appSettings.id }).run();
}
