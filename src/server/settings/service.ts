import "server-only";

import type { EditableSettings, InvoiceNumberPreview, SettingsDto } from "@/domain/settings/contracts";
import { SESSION_ABSOLUTE_HOURS, SETTINGS_ID } from "@/domain/settings/contracts";
import { formatInvoiceNumber, InvoiceNumberPatternError } from "@/domain/settings/numbering";
import { parseSettingsPatch, SettingsValidationError, type SettingsPatchInput } from "@/domain/settings/validation";
import { getMessages } from "@/i18n";
import { appendAuditEvent, type AuditEvent } from "@/server/audit/service";
import { getDatabase, type DatabaseConnection } from "@/server/db/connection";
import { withImmediateTransaction } from "@/server/db/transaction";
import { conflictError, validationError } from "@/server/http/errors";
import { insertDefaultSettings } from "./defaults";

type SettingsRow = {
  companyNameAr: string; companyNameEn: string; address: string | null; phonesJson: string;
  email: string | null; registrationNumber: string | null; currencyCode: string;
  currencySymbolAr: string; currencyDecimals: bigint; invoiceNumberPrefix: string;
  invoiceNumberPattern: string; sequenceStart: bigint; sequenceResetPolicy: "NEVER" | "YEARLY";
  defaultPaymentTerms: string | null; footerText: string | null;
  dateDisplayFormat: "DD/MM/YYYY" | "YYYY-MM-DD"; paperFormat: "A4" | "A5";
  timezone: string; sessionIdleMinutes: bigint; updatedAt: string; rowVersion: bigint;
};

type AuditAppender = (connection: DatabaseConnection, event: AuditEvent) => void;

function readRow(connection: DatabaseConnection): SettingsRow | undefined {
  return connection.client.prepare(`select company_name_ar as companyNameAr,
    company_name_en as companyNameEn, address, phones_json as phonesJson, email,
    registration_number as registrationNumber, currency_code as currencyCode,
    currency_symbol_ar as currencySymbolAr, currency_decimals as currencyDecimals,
    invoice_number_prefix as invoiceNumberPrefix, invoice_number_pattern as invoiceNumberPattern,
    sequence_start as sequenceStart, sequence_reset_policy as sequenceResetPolicy,
    default_payment_terms as defaultPaymentTerms, footer_text as footerText,
    date_display_format as dateDisplayFormat, paper_format as paperFormat, timezone,
    session_idle_minutes as sessionIdleMinutes, updated_at as updatedAt,
    row_version as rowVersion from app_settings where id = ?`).get(SETTINGS_ID) as SettingsRow | undefined;
}

function phonesFromJson(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : [];
  } catch { return []; }
}

function rowToDto(row: SettingsRow): SettingsDto {
  return {
    company: { nameAr: row.companyNameAr, nameEn: row.companyNameEn, address: row.address,
      phones: phonesFromJson(row.phonesJson), email: row.email, registrationNumber: row.registrationNumber },
    currency: { code: row.currencyCode, symbolAr: row.currencySymbolAr, decimals: Number(row.currencyDecimals) },
    numbering: { prefix: row.invoiceNumberPrefix, pattern: row.invoiceNumberPattern,
      sequenceStart: Number(row.sequenceStart), resetPolicy: row.sequenceResetPolicy },
    regional: { dateDisplayFormat: row.dateDisplayFormat, timezone: row.timezone, paperFormat: "A4" },
    session: { idleMinutes: Number(row.sessionIdleMinutes), absoluteHours: SESSION_ABSOLUTE_HOURS },
    defaultPaymentTerms: row.defaultPaymentTerms, footerText: row.footerText,
    rowVersion: Number(row.rowVersion), updatedAt: row.updatedAt,
  };
}

function editable(settings: SettingsDto): EditableSettings {
  return { company: settings.company, currency: settings.currency, numbering: settings.numbering,
    regional: settings.regional, session: { idleMinutes: settings.session.idleMinutes },
    defaultPaymentTerms: settings.defaultPaymentTerms, footerText: settings.footerText };
}

function ensureRow(connection: DatabaseConnection, now: string): SettingsRow {
  let row = readRow(connection);
  if (!row) { insertDefaultSettings(connection, now); row = readRow(connection); }
  if (!row) throw new Error("Settings row could not be initialized.");
  return row;
}

function previewFor(connection: DatabaseConnection, settings: EditableSettings, at: Date): InvoiceNumberPreview {
  const initial = BigInt(settings.numbering.sequenceStart);
  const provisional = formatInvoiceNumber({ ...settings.numbering, nextValue: initial, at,
    timezone: settings.regional.timezone });
  const sequence = connection.client.prepare("select last_value as lastValue from invoice_sequences where sequence_key = ?")
    .get(provisional.sequenceKey) as { lastValue: bigint } | undefined;
  const storedNext = sequence ? sequence.lastValue + 1n : initial;
  return formatInvoiceNumber({ ...settings.numbering, nextValue: storedNext > initial ? storedNext : initial,
    at, timezone: settings.regional.timezone });
}

function changesBetween(before: EditableSettings, after: EditableSettings): Record<string, { before: unknown; after: unknown }> {
  const changes: Record<string, { before: unknown; after: unknown }> = {};
  const walk = (left: unknown, right: unknown, path: string): void => {
    if (left && right && typeof left === "object" && typeof right === "object" && !Array.isArray(left) && !Array.isArray(right)) {
      for (const key of Object.keys(right as object)) walk((left as Record<string, unknown>)[key],
        (right as Record<string, unknown>)[key], path ? `${path}.${key}` : key);
    } else if (JSON.stringify(left) !== JSON.stringify(right)) changes[path] = { before: left, after: right };
  };
  walk(before, after, "");
  return changes;
}

export function getSettings(options: { connection?: DatabaseConnection; now?: Date } = {}) {
  const connection = options.connection ?? getDatabase();
  const at = options.now ?? new Date();
  const row = withImmediateTransaction(connection.client, () => ensureRow(connection, at.toISOString()));
  const settings = rowToDto(row);
  return { settings, preview: previewFor(connection, editable(settings), at) };
}

export function updateSettings(options: { input: unknown; actor: { id: string; displayName: string };
  requestId: string; connection?: DatabaseConnection; now?: Date; auditAppender?: AuditAppender }) {
  let input: SettingsPatchInput;
  try { input = parseSettingsPatch(options.input); }
  catch (error) { if (error instanceof SettingsValidationError) throw validationError(error.fieldErrors); throw error; }
  const connection = options.connection ?? getDatabase();
  const at = options.now ?? new Date();
  return withImmediateTransaction(connection.client, () => {
    const row = ensureRow(connection, at.toISOString());
    if (row.rowVersion !== BigInt(input.rowVersion)) throw conflictError();
    const changes = changesBetween(editable(rowToDto(row)), input.settings);
    let preview: InvoiceNumberPreview;
    try { preview = previewFor(connection, input.settings, at); }
    catch (error) {
      if (error instanceof InvoiceNumberPatternError || error instanceof RangeError) {
        throw validationError({ "settings.numbering.pattern": "The next invoice number cannot be generated." });
      }
      throw error;
    }
    const collision = connection.client.prepare("select 1 as found from invoices where invoice_number = ? limit 1")
      .get(preview.invoiceNumber) as { found: bigint } | undefined;
    if (collision) throw validationError({ "settings.numbering.pattern": "The preview collides with an existing invoice number." });
    if (Object.keys(changes).length === 0) return { settings: rowToDto(row), preview };
    connection.client.prepare(`update app_settings set company_name_ar=?, company_name_en=?, address=?,
      phones_json=?, email=?, registration_number=?, currency_code=?, currency_symbol_ar=?, currency_decimals=?,
      tax_enabled=0, default_tax_rate_bps=0, invoice_number_prefix=?, invoice_number_pattern=?, sequence_start=?,
      sequence_reset_policy=?, default_payment_terms=?, footer_text=?, date_display_format=?, paper_format='A4',
      timezone=?, session_idle_minutes=?, session_absolute_hours=?, updated_at=?, updated_by=?, row_version=row_version+1
      where id=? and row_version=?`).run(input.settings.company.nameAr, input.settings.company.nameEn,
      input.settings.company.address, JSON.stringify(input.settings.company.phones), input.settings.company.email,
      input.settings.company.registrationNumber, input.settings.currency.code, input.settings.currency.symbolAr,
      input.settings.currency.decimals, input.settings.numbering.prefix, input.settings.numbering.pattern,
      input.settings.numbering.sequenceStart, input.settings.numbering.resetPolicy, input.settings.defaultPaymentTerms,
      input.settings.footerText, input.settings.regional.dateDisplayFormat, input.settings.regional.timezone,
      input.settings.session.idleMinutes, SESSION_ABSOLUTE_HOURS, at.toISOString(), options.actor.id,
      SETTINGS_ID, input.rowVersion);
    (options.auditAppender ?? appendAuditEvent)(connection, { eventType: "SETTINGS_UPDATED",
      actorUserId: options.actor.id, actorDisplayName: options.actor.displayName,
      entityType: "APP_SETTINGS", entityId: SETTINGS_ID, summary: getMessages().audit.settingsUpdated,
      changes, createdAt: at.toISOString(), requestId: options.requestId });
    const updated = readRow(connection);
    if (!updated) throw new Error("Settings disappeared after update.");
    return { settings: rowToDto(updated), preview };
  });
}
