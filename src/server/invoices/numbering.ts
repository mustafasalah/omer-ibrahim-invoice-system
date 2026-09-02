import "server-only";

import { formatInvoiceNumber, InvoiceNumberPatternError } from "@/domain/settings/numbering";
import type { SequenceResetPolicy } from "@/domain/settings/contracts";
import type { DatabaseConnection } from "@/server/db/connection";
import { validationError } from "@/server/http/errors";

export type NumberingSettings = {
  prefix: string;
  pattern: string;
  sequenceStart: bigint;
  resetPolicy: SequenceResetPolicy;
  timezone: string;
};

export type ReservedInvoiceNumber = {
  invoiceNumber: string;
  sequenceKey: string;
  sequenceValue: bigint;
};

const MAX_COLLISION_RETRIES = 100;

export function reserveInvoiceNumber(
  connection: DatabaseConnection,
  settings: NumberingSettings,
  at: Date,
): ReservedInvoiceNumber {
  if (!connection.client.inTransaction) throw new Error("Invoice numbers require an active transaction.");
  try {
    const first = formatInvoiceNumber({
      prefix: settings.prefix, pattern: settings.pattern, resetPolicy: settings.resetPolicy,
      nextValue: settings.sequenceStart, at, timezone: settings.timezone,
    });
    const sequence = connection.client.prepare(
      "select last_value as lastValue from invoice_sequences where sequence_key = ?",
    ).get(first.sequenceKey) as { lastValue: bigint } | undefined;
    let nextValue = sequence && sequence.lastValue + 1n > settings.sequenceStart
      ? sequence.lastValue + 1n : settings.sequenceStart;

    for (let attempt = 0; attempt < MAX_COLLISION_RETRIES; attempt += 1) {
      const candidate = formatInvoiceNumber({
        prefix: settings.prefix, pattern: settings.pattern, resetPolicy: settings.resetPolicy,
        nextValue, at, timezone: settings.timezone,
      });
      const collision = connection.client.prepare(
        "select 1 as found from invoices where invoice_number = ? limit 1",
      ).get(candidate.invoiceNumber) as { found: bigint } | undefined;
      if (!collision) {
        connection.client.prepare(`insert into invoice_sequences (sequence_key,last_value,updated_at)
          values (?,?,?) on conflict(sequence_key) do update set last_value=excluded.last_value,
          updated_at=excluded.updated_at`).run(candidate.sequenceKey, nextValue, at.toISOString());
        return { invoiceNumber: candidate.invoiceNumber, sequenceKey: candidate.sequenceKey, sequenceValue: nextValue };
      }
      nextValue += 1n;
    }
  } catch (error) {
    if (!(error instanceof InvoiceNumberPatternError)) throw error;
  }
  throw validationError({ "invoice.invoiceNumber": "INVOICE_NUMBER_UNAVAILABLE" });
}
