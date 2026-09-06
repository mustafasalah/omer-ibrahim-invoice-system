import "server-only";

import { dateInTimezone, type InvoiceEditorDefaults } from "@/domain/invoices/draft";
import type { DatabaseConnection } from "@/server/db/connection";
import { getSettings } from "@/server/settings/service";

export function getInvoiceEditorDefaults(options: { connection?: DatabaseConnection; now?: Date } = {}): InvoiceEditorDefaults {
  const at = options.now ?? new Date();
  const { settings } = getSettings({ connection: options.connection, now: at });
  return { invoiceDate: dateInTimezone(at, settings.regional.timezone),
    currency: { code: settings.currency.code, symbol: settings.currency.symbolAr, decimals: settings.currency.decimals },
    taxEnabled: false, paymentTerms: settings.defaultPaymentTerms };
}
