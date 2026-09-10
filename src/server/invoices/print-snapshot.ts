import "server-only";

import type { PrintSnapshotDto } from "@/domain/invoices/draft";
import { SETTINGS_ID } from "@/domain/settings/contracts";
import type { DatabaseConnection } from "@/server/db/connection";

type SnapshotSourceRow = {
  companyNameAr: string;
  companyNameEn: string;
  address: string | null;
  phonesJson: string;
  email: string | null;
  registrationNumber: string | null;
  footerText: string | null;
  paperFormat: "A4" | "A5";
};

type SnapshotRow = SnapshotSourceRow & { capturedAt: string };

function parsePhones(value: string): string[] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || !parsed.every((entry) => typeof entry === "string")) {
    throw new Error("Stored phone settings are invalid.");
  }
  return parsed;
}

export function capturePrintSnapshot(
  connection: DatabaseConnection,
  options: { invoiceId: string; capturedAt: string },
): void {
  if (!connection.client.inTransaction) {
    throw new Error("Print snapshots require the caller's active issue transaction.");
  }
  const source = connection.client.prepare(`select company_name_ar as companyNameAr,
    company_name_en as companyNameEn,address,phones_json as phonesJson,email,
    registration_number as registrationNumber,footer_text as footerText,paper_format as paperFormat
    from app_settings where id=?`).get(SETTINGS_ID) as SnapshotSourceRow | undefined;
  if (!source) throw new Error("Settings unavailable for print snapshot.");
  parsePhones(source.phonesJson);
  connection.client.prepare(`insert into invoice_print_snapshots
    (invoice_id,company_name_ar,company_name_en,address,phones_json,email,registration_number,
     footer_text,company_logo_asset_id,stamp_asset_id,signature_asset_id,paper_format,captured_at)
    values (?,?,?,?,?,?,?,?,null,null,null,?,?)`).run(
      options.invoiceId, source.companyNameAr, source.companyNameEn, source.address, source.phonesJson,
      source.email, source.registrationNumber, source.footerText, source.paperFormat, options.capturedAt,
    );
}

export function readPrintSnapshot(
  connection: DatabaseConnection,
  invoiceId: string,
): PrintSnapshotDto | null {
  const row = connection.client.prepare(`select company_name_ar as companyNameAr,
    company_name_en as companyNameEn,address,phones_json as phonesJson,email,
    registration_number as registrationNumber,footer_text as footerText,paper_format as paperFormat,
    captured_at as capturedAt from invoice_print_snapshots where invoice_id=?`).get(invoiceId) as SnapshotRow | undefined;
  if (!row) return null;
  return {
    companyNameAr: row.companyNameAr,
    companyNameEn: row.companyNameEn,
    address: row.address,
    phones: parsePhones(row.phonesJson),
    email: row.email,
    registrationNumber: row.registrationNumber,
    footerText: row.footerText,
    paperFormat: row.paperFormat,
    capturedAt: row.capturedAt,
  };
}
