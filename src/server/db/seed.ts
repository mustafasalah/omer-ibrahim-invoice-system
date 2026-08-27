import "server-only";

import type { DatabaseConnection } from "./connection";
import { appSettings } from "./schema";
import { withImmediateTransaction } from "./transaction";

export function seedDevelopmentSettings(connection: DatabaseConnection, now: string): void {
  withImmediateTransaction(connection.client, () => {
    connection.db
      .insert(appSettings)
      .values({
        id: "default",
        companyNameAr: "أعمال عمر إبراهيم أحمد سليمان للاستيراد وتوزيع المستلزمات الطبية",
        companyNameEn: "OMER IBRAHIM MEDICAL SUPPLIES",
        address: null,
        phonesJson: "[]",
        email: null,
        registrationNumber: null,
        currencyCode: "SDG",
        currencySymbolAr: "ج.س",
        currencyDecimals: 2,
        taxEnabled: false,
        defaultTaxRateBps: 0,
        invoiceNumberPrefix: "OI",
        invoiceNumberPattern: "{PREFIX}-{YYYY}-{SEQ:5}",
        sequenceStart: 1,
        sequenceResetPolicy: "YEARLY",
        defaultPaymentTerms: null,
        footerText: null,
        dateDisplayFormat: "DD/MM/YYYY",
        paperFormat: "A4",
        timezone: "Africa/Khartoum",
        lanAccessEnabled: false,
        sessionIdleMinutes: 30,
        sessionAbsoluteHours: 12,
        companyLogoAssetId: null,
        stampAssetId: null,
        signatureAssetId: null,
        updatedAt: now,
        updatedBy: null,
        rowVersion: 1,
      })
      .onConflictDoNothing({ target: appSettings.id })
      .run();
  });
}
