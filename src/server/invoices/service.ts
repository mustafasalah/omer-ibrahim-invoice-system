import "server-only";

import { ulid } from "ulid";
import { calculateInvoice } from "@/domain/invoices/calculator";
import { InvoiceCalculationError, type CalculatedInvoice } from "@/domain/invoices/contracts";
import {
  dateInTimezone, DraftValidationError, isValidIsoDate, normalizeSuggestionName,
  parseCreateDraft, parseCreateIssue, parseUpdateDraft, parseUpdateIssue, type DraftActor, type DraftBeneficiaryInput,
  type DraftInvoiceInput, type DraftItemInput, type DraftResult, type InvoiceDraftDto,
} from "@/domain/invoices/draft";
import { SETTINGS_ID } from "@/domain/settings/contracts";
import { getMessages } from "@/i18n";
import { appendAuditEvent, type AuditEvent } from "@/server/audit/service";
import { getDatabase, type DatabaseConnection } from "@/server/db/connection";
import { withImmediateTransaction } from "@/server/db/transaction";
import { conflictError, forbiddenError, notFoundError, validationError } from "@/server/http/errors";
import { insertDefaultSettings } from "@/server/settings/defaults";
import { reserveInvoiceNumber } from "./numbering";
import { capturePrintSnapshot, readPrintSnapshot } from "./print-snapshot";

type SettingsRow = {
  currencyCode: string; currencySymbol: string; currencyDecimals: bigint;
  prefix: string; pattern: string; sequenceStart: bigint;
  resetPolicy: "NEVER" | "YEARLY"; timezone: string; defaultPaymentTerms: string | null;
};

type BeneficiaryRow = {
  id: string; name: string; normalizedName: string; phone: string | null; address: string | null;
  registrationNumber: string | null; isActive: bigint;
};

type ProductRow = {
  id: string; name: string; normalizedName: string; description: string | null; unit: string | null;
  lastUnitPrice: string | null; lastCurrencyCode: string | null; isActive: bigint;
};

type InvoiceRow = {
  id: string; invoiceNumber: string; invoiceStatus: "DRAFT" | "ISSUED" | "CANCELLED";
  paymentStatus: string; isArchived: bigint; invoiceDate: string; dueDate: string | null;
  beneficiaryId: string | null; beneficiaryName: string | null; beneficiaryPhone: string | null;
  beneficiaryAddress: string | null; beneficiaryRegistrationNumber: string | null;
  currencyCode: string; currencySymbol: string; currencyDecimals: bigint;
  subtotalMinor: bigint; lineDiscountsMinor: bigint; invoiceDiscountMinor: bigint;
  discountTotalMinor: bigint; taxableTotalMinor: bigint; taxTotalMinor: bigint;
  grandTotalMinor: bigint; grossPaidMinor: bigint; refundedTotalMinor: bigint;
  netCollectedMinor: bigint; remainingMinor: bigint; notes: string | null; paymentTerms: string | null;
  createdAt: string; createdBy: string; createdByName: string; updatedAt: string;
  updatedBy: string; updatedByName: string; issuedAt: string | null;
  issuedBy: string | null; issuedByName: string | null; copiedFromInvoiceId: string | null;
  sourceInvoiceNumber: string | null; rowVersion: bigint;
};

type ItemRow = {
  id: string; productId: string | null; sortOrder: bigint; productName: string | null;
  description: string | null; unit: string | null; quantity: string | null; unitPrice: string | null;
  baseMinor: bigint; discountMinor: bigint; allocatedDiscountMinor: bigint; taxableMinor: bigint;
  taxMinor: bigint; lineTotalMinor: bigint;
};

type PreparedBeneficiary = DraftBeneficiaryInput & { row: BeneficiaryRow | null };
type PreparedItem = DraftItemInput & { row: ProductRow | null; productId: string | null };

export type InvoiceFaultPoint = "afterSequence" | "afterSuggestions" | "afterInvoice" | "afterItems" |
  "afterSnapshot" | "afterStatus" | "afterAudit";
type FaultInjector = (point: InvoiceFaultPoint) => void;
type AuditAppender = (connection: DatabaseConnection, event: AuditEvent) => void;
type SnapshotCapturer = typeof capturePrintSnapshot;

function issuePath(path: string): string {
  if (path.startsWith("invoice.itemsByClientKey.")) return path.slice("invoice.".length);
  if (path.startsWith("invoice.items.")) return path.slice("invoice.".length);
  if (path === "invoice.invoiceDate") return "invoiceDate";
  if (path === "invoice.dueDate") return "dueDate";
  if (path === "invoice.beneficiary.name") return "beneficiary.name";
  return path;
}

function toIssueFieldErrors(fields: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(fields).map(([path, value]) => [issuePath(path), value]));
}

function settingsRow(connection: DatabaseConnection, now: string): SettingsRow {
  let row = connection.client.prepare(`select currency_code as currencyCode, currency_symbol_ar as currencySymbol,
    currency_decimals as currencyDecimals, invoice_number_prefix as prefix, invoice_number_pattern as pattern,
    sequence_start as sequenceStart, sequence_reset_policy as resetPolicy, timezone,
    default_payment_terms as defaultPaymentTerms from app_settings where id=?`).get(SETTINGS_ID) as SettingsRow | undefined;
  if (!row) { insertDefaultSettings(connection, now); row = connection.client.prepare(`select currency_code as currencyCode,
    currency_symbol_ar as currencySymbol, currency_decimals as currencyDecimals, invoice_number_prefix as prefix,
    invoice_number_pattern as pattern, sequence_start as sequenceStart, sequence_reset_policy as resetPolicy,
    timezone, default_payment_terms as defaultPaymentTerms from app_settings where id=?`).get(SETTINGS_ID) as SettingsRow | undefined; }
  if (!row) throw new Error("Settings unavailable.");
  return row;
}

function validateDates(input: DraftInvoiceInput, fallbackDate: string, timezone: string, at: Date,
  role: DraftActor["role"], paths: "draft" | "issue" = "draft"): {
  invoiceDate: string; dueDate: string | null; warnings: DraftResult["warnings"];
} {
  const invoiceDate = input.invoiceDate ?? fallbackDate;
  const fields: Record<string, string> = {};
  if (!isValidIsoDate(invoiceDate)) fields["invoice.invoiceDate"] = "INVALID_DATE";
  if (input.dueDate !== null && !isValidIsoDate(input.dueDate)) fields["invoice.dueDate"] = "INVALID_DATE";
  if (input.dueDate !== null && isValidIsoDate(invoiceDate) && input.dueDate < invoiceDate) {
    fields["invoice.dueDate"] = "DUE_DATE_BEFORE_INVOICE_DATE";
  }
  const companyToday = dateInTimezone(at, timezone);
  if (role === "EMPLOYEE" && isValidIsoDate(invoiceDate) && invoiceDate > companyToday) {
    fields["invoice.invoiceDate"] = "FUTURE_DATE_FORBIDDEN";
  }
  if (Object.keys(fields).length > 0) throw validationError(paths === "issue" ? toIssueFieldErrors(fields) : fields);
  return { invoiceDate, dueDate: input.dueDate, warnings: invoiceDate > companyToday ? [{ code: "FUTURE_INVOICE_DATE" }] : [] };
}

function beneficiaryById(connection: DatabaseConnection, id: string): BeneficiaryRow | undefined {
  return connection.client.prepare(`select id,name,normalized_name as normalizedName,phone,address,
    registration_number as registrationNumber,is_active as isActive from beneficiaries where id=?`).get(id) as BeneficiaryRow | undefined;
}

function beneficiaryByName(connection: DatabaseConnection, normalized: string): BeneficiaryRow | undefined {
  return connection.client.prepare(`select id,name,normalized_name as normalizedName,phone,address,
    registration_number as registrationNumber,is_active as isActive from beneficiaries
    where normalized_name=? order by is_active desc,last_used_at desc,id limit 1`).get(normalized) as BeneficiaryRow | undefined;
}

function prepareBeneficiary(connection: DatabaseConnection, input: DraftBeneficiaryInput | null,
  paths: "draft" | "issue" = "draft"): PreparedBeneficiary | null {
  if (!input) return null;
  const row = input.suggestionId ? beneficiaryById(connection, input.suggestionId)
    : input.name ? beneficiaryByName(connection, normalizeSuggestionName(input.name)) : undefined;
  if (input.suggestionId && !row) throw validationError({
    [paths === "issue" ? "beneficiary.suggestionId" : "invoice.beneficiary.suggestionId"]: "SUGGESTION_NOT_FOUND",
  });
  if (row?.isActive === 0n && !input.reactivateSuggestion) {
    throw validationError({
      [paths === "issue" ? "beneficiary.reactivateSuggestion" : "invoice.beneficiary.reactivateSuggestion"]:
        "EXPLICIT_REACTIVATION_REQUIRED",
    });
  }
  return {
    ...input, row: row ?? null,
    name: input.name ?? row?.name ?? null, phone: input.phone ?? row?.phone ?? null,
    address: input.address ?? row?.address ?? null,
    registrationNumber: input.registrationNumber ?? row?.registrationNumber ?? null,
  };
}

function productById(connection: DatabaseConnection, id: string): ProductRow | undefined {
  return connection.client.prepare(`select id,name,normalized_name as normalizedName,description,unit,
    last_unit_price_decimal as lastUnitPrice,last_currency_code as lastCurrencyCode,is_active as isActive
    from products where id=?`).get(id) as ProductRow | undefined;
}

function productByName(connection: DatabaseConnection, normalized: string): ProductRow | undefined {
  return connection.client.prepare(`select id,name,normalized_name as normalizedName,description,unit,
    last_unit_price_decimal as lastUnitPrice,last_currency_code as lastCurrencyCode,is_active as isActive
    from products where normalized_name=? order by is_active desc,last_used_at desc,id limit 1`).get(normalized) as ProductRow | undefined;
}

function prepareItems(connection: DatabaseConnection, items: DraftItemInput[], currencyCode: string,
  paths: "draft" | "issue" = "draft"): PreparedItem[] {
  return items.map((input, index) => {
    const row = input.productSuggestionId ? productById(connection, input.productSuggestionId)
      : input.productName ? productByName(connection, normalizeSuggestionName(input.productName)) : undefined;
    if (input.productSuggestionId && !row) {
      throw validationError({ [`${paths === "issue" ? "" : "invoice."}items.${index}.productSuggestionId`]: "SUGGESTION_NOT_FOUND" });
    }
    if (row?.isActive === 0n && !input.reactivateSuggestion) {
      throw validationError({ [`${paths === "issue" ? "" : "invoice."}items.${index}.reactivateSuggestion`]: "EXPLICIT_REACTIVATION_REQUIRED" });
    }
    const selectedPrice = input.productSuggestionId && row?.lastCurrencyCode === currencyCode ? row.lastUnitPrice : null;
    return { ...input, row: row ?? null, productId: row?.id ?? null,
      productName: input.productName ?? row?.name ?? null,
      description: input.description ?? row?.description ?? null, unit: input.unit ?? row?.unit ?? null,
      unitPrice: input.unitPrice ?? selectedPrice };
  });
}

function calculate(items: PreparedItem[], currency: { code: string; symbol: string; decimals: number },
  paths: "draft" | "issue" = "draft"): {
  calculated: CalculatedInvoice; lineCalculations: Array<CalculatedInvoice["lines"][number] | null>;
} {
  const completeIndexes: number[] = [];
  const lines: Array<{ quantity: string; unitPrice: string }> = [];
  items.forEach((item, index) => {
    if (item.productName && item.quantity !== null && item.unitPrice !== null) {
      completeIndexes.push(index); lines.push({ quantity: item.quantity, unitPrice: item.unitPrice });
    }
  });
  try {
    const calculated = calculateInvoice({ lines }, currency);
    const lineCalculations: Array<CalculatedInvoice["lines"][number] | null> = items.map(() => null);
    completeIndexes.forEach((itemIndex, calculatedIndex) => { lineCalculations[itemIndex] = calculated.lines[calculatedIndex] ?? null; });
    return { calculated, lineCalculations };
  } catch (error) {
    if (error instanceof InvoiceCalculationError) {
      const match = /^invoice\.lines\.(\d+)(.*)$/u.exec(error.path ?? "");
      if (match) {
        const completeIndex = Number(match[1]);
        const itemIndex = completeIndexes[completeIndex];
        if (itemIndex !== undefined) {
          const suffix = match[2] ?? "";
          const prefix = paths === "issue" ? "" : "invoice.";
          const fields: Record<string, string> = { [`${prefix}items.${itemIndex}${suffix}`]: error.code };
          const clientKey = items[itemIndex]?.clientKey;
          if (clientKey) fields[`${prefix}itemsByClientKey.${clientKey}${suffix}`] = error.code;
          throw validationError(fields);
        }
      }
      throw validationError({ [paths === "issue" ? issuePath(error.path ?? "invoice") : (error.path ?? "invoice")]: error.code });
    }
    throw error;
  }
}

function persistBeneficiary(connection: DatabaseConnection, prepared: PreparedBeneficiary | null, actorId: string, now: string): string | null {
  if (!prepared?.name) return null;
  let row = prepared.row;
  if (!row) row = beneficiaryByName(connection, normalizeSuggestionName(prepared.name)) ?? null;
  const id = row?.id ?? ulid();
  if (!row) {
    connection.client.prepare(`insert into beneficiaries (id,name,normalized_name,phone,address,registration_number,
      is_active,use_count,last_used_at,created_at,updated_at,updated_by) values (?,?,?,?,?,?,1,1,?,?,?,?)`)
      .run(id, prepared.name, normalizeSuggestionName(prepared.name), prepared.phone, prepared.address,
        prepared.registrationNumber, now, now, now, actorId);
  } else {
    connection.client.prepare(`update beneficiaries set name=case when ? then ? else name end,
      normalized_name=case when ? then ? else normalized_name end, phone=case when ? then ? else phone end,
      address=case when ? then ? else address end, registration_number=case when ? then ? else registration_number end,
      is_active=case when ? then 1 else is_active end,use_count=use_count+1,last_used_at=?,updated_at=?,updated_by=? where id=?`)
      .run(prepared.updateSuggestion ? 1 : 0, prepared.name, prepared.updateSuggestion ? 1 : 0,
        normalizeSuggestionName(prepared.name), prepared.updateSuggestion ? 1 : 0, prepared.phone,
        prepared.updateSuggestion ? 1 : 0, prepared.address, prepared.updateSuggestion ? 1 : 0,
        prepared.registrationNumber, prepared.reactivateSuggestion ? 1 : 0, now, now, actorId, id);
  }
  return id;
}

function persistProducts(connection: DatabaseConnection, items: PreparedItem[], currencyCode: string, actorId: string, now: string): void {
  const lastPrice = new Map<string, string>();
  for (const item of items) {
    if (!item.productName) continue;
    let row = item.row ?? productByName(connection, normalizeSuggestionName(item.productName));
    const id = row?.id ?? ulid();
    if (!row) {
      connection.client.prepare(`insert into products (id,name,normalized_name,description,unit,is_active,use_count,
        last_used_at,created_at,updated_at,updated_by) values (?,?,?,?,?,1,1,?,?,?,?)`)
        .run(id, item.productName, normalizeSuggestionName(item.productName), item.description, item.unit,
          now, now, now, actorId);
      row = productById(connection, id);
    } else {
      connection.client.prepare(`update products set name=case when ? then ? else name end,
        normalized_name=case when ? then ? else normalized_name end,
        description=case when ? then ? else description end,unit=case when ? then ? else unit end,
        is_active=case when ? then 1 else is_active end,use_count=use_count+1,last_used_at=?,updated_at=?,updated_by=? where id=?`)
        .run(item.updateSuggestion ? 1 : 0, item.productName, item.updateSuggestion ? 1 : 0,
          normalizeSuggestionName(item.productName), item.updateSuggestion ? 1 : 0, item.description,
          item.updateSuggestion ? 1 : 0, item.unit, item.reactivateSuggestion ? 1 : 0, now, now, actorId, id);
    }
    item.productId = id;
    if (item.quantity !== null && item.unitPrice !== null) lastPrice.set(id, item.unitPrice);
  }
  for (const [id, price] of lastPrice) {
    connection.client.prepare(`update products set last_unit_price_decimal=?,last_currency_code=?,updated_at=?,updated_by=? where id=?`)
      .run(price, currencyCode, now, actorId, id);
  }
}

function insertItems(connection: DatabaseConnection, invoiceId: string, items: PreparedItem[], lines: Array<CalculatedInvoice["lines"][number] | null>, now: string): void {
  const statement = connection.client.prepare(`insert into invoice_items (id,invoice_id,product_id,sort_order,
    product_name,description,unit,quantity_decimal,unit_price_decimal,base_minor,discount_kind,discount_minor,
    allocated_invoice_discount_minor,tax_rate_bps,taxable_minor,tax_minor,line_total_minor,created_at,updated_at)
    values (?,?,?,?,?,?,?,?,?,?,'NONE',?, ?,0,?,?,?, ?,?)`);
  items.forEach((item, index) => {
    const line = lines[index];
    statement.run(ulid(), invoiceId, item.productId, index, item.productName, item.description, item.unit,
      item.quantity, item.unitPrice, BigInt(line?.baseMinor ?? "0"), 0n, 0n,
      BigInt(line?.taxableMinor ?? "0"), 0n, BigInt(line?.lineTotalMinor ?? "0"), now, now);
  });
}

function readInvoiceRow(connection: DatabaseConnection, id: string): InvoiceRow | undefined {
  return connection.client.prepare(`select i.id,i.invoice_number as invoiceNumber,i.invoice_status as invoiceStatus,
    i.payment_status as paymentStatus,i.is_archived as isArchived,i.invoice_date as invoiceDate,i.due_date as dueDate,
    i.beneficiary_id as beneficiaryId,i.beneficiary_name as beneficiaryName,i.beneficiary_phone as beneficiaryPhone,
    i.beneficiary_address as beneficiaryAddress,i.beneficiary_registration_number as beneficiaryRegistrationNumber,
    i.currency_code as currencyCode,i.currency_symbol as currencySymbol,i.currency_decimals as currencyDecimals,
    i.subtotal_minor as subtotalMinor,i.line_discounts_minor as lineDiscountsMinor,
    i.invoice_discount_minor as invoiceDiscountMinor,i.discount_total_minor as discountTotalMinor,
    i.taxable_total_minor as taxableTotalMinor,i.tax_total_minor as taxTotalMinor,i.grand_total_minor as grandTotalMinor,
    i.gross_paid_minor as grossPaidMinor,i.refunded_total_minor as refundedTotalMinor,
    i.net_collected_minor as netCollectedMinor,i.remaining_minor as remainingMinor,i.notes,i.payment_terms as paymentTerms,
    i.created_at as createdAt,i.created_by as createdBy,cu.display_name as createdByName,
    i.updated_at as updatedAt,i.updated_by as updatedBy,uu.display_name as updatedByName,
    i.issued_at as issuedAt,i.issued_by as issuedBy,iu.display_name as issuedByName,
    i.copied_from_invoice_id as copiedFromInvoiceId,source.invoice_number as sourceInvoiceNumber,
    i.row_version as rowVersion
    from invoices i join users cu on cu.id=i.created_by join users uu on uu.id=i.updated_by
    left join users iu on iu.id=i.issued_by
    left join invoices source on source.id=i.copied_from_invoice_id
    where i.id=?`).get(id) as InvoiceRow | undefined;
}

function toDto(connection: DatabaseConnection, row: InvoiceRow): InvoiceDraftDto {
  const items = connection.client.prepare(`select id,product_id as productId,sort_order as sortOrder,product_name as productName,
    description,unit,quantity_decimal as quantity,unit_price_decimal as unitPrice,base_minor as baseMinor,
    discount_minor as discountMinor,allocated_invoice_discount_minor as allocatedDiscountMinor,
    taxable_minor as taxableMinor,tax_minor as taxMinor,line_total_minor as lineTotalMinor
    from invoice_items where invoice_id=? order by sort_order`).all(row.id) as ItemRow[];
  return {
    id: row.id, invoiceNumber: row.invoiceNumber, invoiceStatus: row.invoiceStatus,
    paymentStatus: row.paymentStatus, isArchived: row.isArchived === 1n, invoiceDate: row.invoiceDate, dueDate: row.dueDate,
    beneficiary: { suggestionId: row.beneficiaryId, name: row.beneficiaryName, phone: row.beneficiaryPhone,
      address: row.beneficiaryAddress, registrationNumber: row.beneficiaryRegistrationNumber },
    currency: { code: row.currencyCode, symbol: row.currencySymbol, decimals: Number(row.currencyDecimals) },
    items: items.map((item) => ({ id: item.id, productSuggestionId: item.productId,
      sortOrder: Number(item.sortOrder), productName: item.productName, description: item.description, unit: item.unit,
      quantity: item.quantity, unitPrice: item.unitPrice, baseMinor: item.baseMinor.toString(),
      discountMinor: item.discountMinor.toString(), allocatedInvoiceDiscountMinor: item.allocatedDiscountMinor.toString(),
      taxableMinor: item.taxableMinor.toString(), taxMinor: item.taxMinor.toString(), lineTotalMinor: item.lineTotalMinor.toString() })),
    totals: { subtotalMinor: row.subtotalMinor.toString(), lineDiscountsMinor: row.lineDiscountsMinor.toString(),
      invoiceDiscountMinor: row.invoiceDiscountMinor.toString(), discountTotalMinor: row.discountTotalMinor.toString(),
      taxableTotalMinor: row.taxableTotalMinor.toString(), taxTotalMinor: row.taxTotalMinor.toString(),
      grandTotalMinor: row.grandTotalMinor.toString(), grossPaidMinor: row.grossPaidMinor.toString(),
      refundedTotalMinor: row.refundedTotalMinor.toString(), netCollectedMinor: row.netCollectedMinor.toString(),
      remainingMinor: row.remainingMinor.toString() }, notes: row.notes, paymentTerms: row.paymentTerms,
    createdAt: row.createdAt, createdBy: { id: row.createdBy, displayName: row.createdByName },
    updatedAt: row.updatedAt, updatedBy: { id: row.updatedBy, displayName: row.updatedByName },
    issuedAt: row.issuedAt,
    issuedBy: row.issuedBy && row.issuedByName ? { id: row.issuedBy, displayName: row.issuedByName } : null,
    sourceInvoice: row.copiedFromInvoiceId && row.sourceInvoiceNumber
      ? { id: row.copiedFromInvoiceId, invoiceNumber: row.sourceInvoiceNumber }
      : null,
    printSnapshot: readPrintSnapshot(connection, row.id),
    rowVersion: Number(row.rowVersion),
  };
}

function getRequiredInvoice(connection: DatabaseConnection, id: string): InvoiceRow {
  const row = readInvoiceRow(connection, id);
  if (!row) throw notFoundError();
  return row;
}

function invoiceChanges(before: InvoiceDraftDto, after: InvoiceDraftDto): Record<string, { before: unknown; after: unknown }> {
  const changes: Record<string, { before: unknown; after: unknown }> = {};
  const fields: Array<keyof InvoiceDraftDto> = ["invoiceDate", "dueDate", "beneficiary", "items", "totals", "notes", "paymentTerms"];
  for (const field of fields) if (JSON.stringify(before[field]) !== JSON.stringify(after[field])) {
    if (field === "items") {
      const summarize = (items: InvoiceDraftDto["items"]) => ({ count: items.length,
        completeCount: items.filter((item) => item.productName && item.quantity !== null && item.unitPrice !== null).length });
      changes[field] = { before: summarize(before.items), after: summarize(after.items) };
    } else if (field === "totals") {
      changes[field] = {
        before: { grandTotalMinor: before.totals.grandTotalMinor, remainingMinor: before.totals.remainingMinor },
        after: { grandTotalMinor: after.totals.grandTotalMinor, remainingMinor: after.totals.remainingMinor },
      };
    } else {
      changes[field] = { before: before[field], after: after[field] };
    }
  }
  return changes;
}

export function getInvoiceDraft(id: string, options: { connection?: DatabaseConnection } = {}): InvoiceDraftDto {
  const connection = options.connection ?? getDatabase();
  return toDto(connection, getRequiredInvoice(connection, id));
}

export function createInvoiceDraft(options: { input: unknown; actor: DraftActor; requestId: string;
  connection?: DatabaseConnection; now?: Date; faultInjector?: FaultInjector; auditAppender?: AuditAppender }): DraftResult {
  let request;
  try { request = parseCreateDraft(options.input); }
  catch (error) { if (error instanceof DraftValidationError) throw validationError(error.fieldErrors); throw error; }
  const connection = options.connection ?? getDatabase();
  const at = options.now ?? new Date(); const now = at.toISOString();
  return withImmediateTransaction(connection.client, () => {
    const settings = settingsRow(connection, now);
    const dates = validateDates(request.invoice, dateInTimezone(at, settings.timezone), settings.timezone, at, options.actor.role);
    const beneficiary = prepareBeneficiary(connection, request.invoice.beneficiary);
    const items = prepareItems(connection, request.invoice.items, settings.currencyCode);
    const currency = { code: settings.currencyCode, symbol: settings.currencySymbol, decimals: Number(settings.currencyDecimals) };
    const calculation = calculate(items, currency);
    const reserved = reserveInvoiceNumber(connection, { prefix: settings.prefix, pattern: settings.pattern,
      sequenceStart: settings.sequenceStart, resetPolicy: settings.resetPolicy, timezone: settings.timezone }, at);
    options.faultInjector?.("afterSequence");
    const beneficiaryId = persistBeneficiary(connection, beneficiary, options.actor.id, now);
    persistProducts(connection, items, currency.code, options.actor.id, now);
    options.faultInjector?.("afterSuggestions");
    const id = ulid(); const total = calculation.calculated;
    connection.client.prepare(`insert into invoices (id,invoice_number,invoice_status,payment_status,is_archived,
      invoice_date,due_date,beneficiary_id,beneficiary_name,beneficiary_phone,beneficiary_address,
      beneficiary_registration_number,currency_code,currency_symbol,currency_decimals,tax_enabled,
      invoice_discount_kind,subtotal_minor,line_discounts_minor,invoice_discount_minor,discount_total_minor,
      taxable_total_minor,tax_total_minor,grand_total_minor,gross_paid_minor,refunded_total_minor,
      net_collected_minor,remaining_minor,notes,payment_terms,created_at,created_by,updated_at,updated_by,row_version)
      values (?,?,'DRAFT','UNPAID',0,?,?,?,?,?,?,?,?,?,?,0,'NONE',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`)
      .run(id, reserved.invoiceNumber, dates.invoiceDate, dates.dueDate, beneficiaryId, beneficiary?.name ?? null,
        beneficiary?.phone ?? null, beneficiary?.address ?? null, beneficiary?.registrationNumber ?? null,
        currency.code, currency.symbol, currency.decimals, BigInt(total.subtotalMinor), BigInt(total.lineDiscountsMinor),
        BigInt(total.invoiceDiscountMinor), BigInt(total.discountTotalMinor), BigInt(total.taxableTotalMinor),
        BigInt(total.taxTotalMinor), BigInt(total.grandTotalMinor), BigInt(total.grossPaidMinor),
        BigInt(total.refundedTotalMinor), BigInt(total.netCollectedMinor), BigInt(total.remainingMinor),
        request.invoice.notes, request.invoice.paymentTerms === undefined ? settings.defaultPaymentTerms : request.invoice.paymentTerms,
        now, options.actor.id, now, options.actor.id);
    options.faultInjector?.("afterInvoice");
    insertItems(connection, id, items, calculation.lineCalculations, now);
    options.faultInjector?.("afterItems");
    (options.auditAppender ?? appendAuditEvent)(connection, { eventType: "INVOICE_CREATED",
      actorUserId: options.actor.id, actorDisplayName: options.actor.displayName, invoiceId: id,
      invoiceNumber: reserved.invoiceNumber, entityType: "INVOICE", entityId: id,
      summary: getMessages().audit.invoiceCreated, changes: { invoiceStatus: { before: null, after: "DRAFT" } },
      createdAt: now, requestId: options.requestId });
    options.faultInjector?.("afterAudit");
    return { invoice: toDto(connection, getRequiredInvoice(connection, id)), warnings: dates.warnings };
  });
}

export function updateInvoiceDraft(options: { id: string; input: unknown; actor: DraftActor; requestId: string;
  connection?: DatabaseConnection; now?: Date; faultInjector?: FaultInjector; auditAppender?: AuditAppender }): DraftResult {
  let request;
  try { request = parseUpdateDraft(options.input); }
  catch (error) { if (error instanceof DraftValidationError) throw validationError(error.fieldErrors); throw error; }
  const connection = options.connection ?? getDatabase(); const at = options.now ?? new Date(); const now = at.toISOString();
  return withImmediateTransaction(connection.client, () => {
    const existing = getRequiredInvoice(connection, options.id);
    if (existing.invoiceStatus === "ISSUED" && options.actor.role === "EMPLOYEE") throw forbiddenError();
    if (existing.rowVersion !== BigInt(request.rowVersion)) {
      throw conflictError({ rowVersion: existing.rowVersion.toString() });
    }
    if (existing.invoiceStatus !== "DRAFT" || existing.isArchived === 1n) throw conflictError();
    const before = toDto(connection, existing);
    const settings = settingsRow(connection, now);
    const dates = validateDates(request.invoice, existing.invoiceDate, settings.timezone, at, options.actor.role);
    const beneficiary = prepareBeneficiary(connection, request.invoice.beneficiary);
    const items = prepareItems(connection, request.invoice.items, existing.currencyCode);
    const calculation = calculate(items, { code: existing.currencyCode, symbol: existing.currencySymbol,
      decimals: Number(existing.currencyDecimals) });
    const beneficiaryId = persistBeneficiary(connection, beneficiary, options.actor.id, now);
    persistProducts(connection, items, existing.currencyCode, options.actor.id, now);
    options.faultInjector?.("afterSuggestions");
    const total = calculation.calculated;
    const updated = connection.client.prepare(`update invoices set invoice_date=?,due_date=?,beneficiary_id=?,
      beneficiary_name=?,beneficiary_phone=?,beneficiary_address=?,beneficiary_registration_number=?,
      subtotal_minor=?,line_discounts_minor=?,invoice_discount_minor=?,discount_total_minor=?,taxable_total_minor=?,
      tax_total_minor=?,grand_total_minor=?,remaining_minor=?,notes=?,payment_terms=?,updated_at=?,updated_by=?,
      row_version=row_version+1 where id=? and row_version=?`).run(dates.invoiceDate, dates.dueDate, beneficiaryId,
        beneficiary?.name ?? null, beneficiary?.phone ?? null, beneficiary?.address ?? null,
        beneficiary?.registrationNumber ?? null, BigInt(total.subtotalMinor), BigInt(total.lineDiscountsMinor),
        BigInt(total.invoiceDiscountMinor), BigInt(total.discountTotalMinor), BigInt(total.taxableTotalMinor),
        BigInt(total.taxTotalMinor), BigInt(total.grandTotalMinor), BigInt(total.remainingMinor), request.invoice.notes,
        request.invoice.paymentTerms === undefined ? existing.paymentTerms : request.invoice.paymentTerms,
        now, options.actor.id, options.id, request.rowVersion);
    if (updated.changes !== 1) throw conflictError();
    options.faultInjector?.("afterInvoice");
    connection.client.prepare("delete from invoice_items where invoice_id=?").run(options.id);
    insertItems(connection, options.id, items, calculation.lineCalculations, now);
    options.faultInjector?.("afterItems");
    const after = toDto(connection, getRequiredInvoice(connection, options.id));
    (options.auditAppender ?? appendAuditEvent)(connection, { eventType: "INVOICE_DRAFT_UPDATED",
      actorUserId: options.actor.id, actorDisplayName: options.actor.displayName, invoiceId: options.id,
      invoiceNumber: existing.invoiceNumber, entityType: "INVOICE", entityId: options.id,
      summary: getMessages().audit.invoiceDraftUpdated, changes: invoiceChanges(before, after),
      createdAt: now, requestId: options.requestId });
    options.faultInjector?.("afterAudit");
    return { invoice: after, warnings: dates.warnings };
  });
}

function previousIssuedRequest(
  connection: DatabaseConnection,
  requestId: string,
  actorId: string,
  invoiceId?: string,
): InvoiceDraftDto | null {
  const row = connection.client.prepare(`select invoice_id as invoiceId from audit_logs
    where request_id=? and actor_user_id=? and event_type='INVOICE_ISSUED'
      and invoice_id is not null order by created_at,id limit 1`).get(requestId, actorId) as { invoiceId: string } | undefined;
  if (!row || (invoiceId && row.invoiceId !== invoiceId)) return null;
  const invoice = readInvoiceRow(connection, row.invoiceId);
  return invoice?.invoiceStatus === "ISSUED" ? toDto(connection, invoice) : null;
}

function insertIssuedInvoice(options: {
  connection: DatabaseConnection;
  id: string;
  invoiceNumber: string;
  input: DraftInvoiceInput;
  dates: { invoiceDate: string; dueDate: string | null };
  beneficiary: PreparedBeneficiary | null;
  beneficiaryId: string | null;
  currency: { code: string; symbol: string; decimals: number };
  total: CalculatedInvoice;
  paymentTerms: string | null;
  actorId: string;
  now: string;
}): void {
  options.connection.client.prepare(`insert into invoices
    (id,invoice_number,invoice_status,payment_status,is_archived,invoice_date,due_date,
     beneficiary_id,beneficiary_name,beneficiary_phone,beneficiary_address,beneficiary_registration_number,
     currency_code,currency_symbol,currency_decimals,tax_enabled,invoice_discount_kind,
     subtotal_minor,line_discounts_minor,invoice_discount_minor,discount_total_minor,taxable_total_minor,
     tax_total_minor,grand_total_minor,gross_paid_minor,refunded_total_minor,net_collected_minor,remaining_minor,
     notes,payment_terms,created_at,created_by,updated_at,updated_by,issued_at,issued_by,row_version)
    values (@id,@invoiceNumber,'ISSUED','UNPAID',0,@invoiceDate,@dueDate,@beneficiaryId,@beneficiaryName,
      @beneficiaryPhone,@beneficiaryAddress,@beneficiaryRegistrationNumber,@currencyCode,@currencySymbol,
      @currencyDecimals,0,'NONE',@subtotalMinor,@lineDiscountsMinor,@invoiceDiscountMinor,@discountTotalMinor,
      @taxableTotalMinor,@taxTotalMinor,@grandTotalMinor,0,0,0,@remainingMinor,@notes,@paymentTerms,
      @now,@actorId,@now,@actorId,@now,@actorId,1)`).run({
        id: options.id,
        invoiceNumber: options.invoiceNumber,
        invoiceDate: options.dates.invoiceDate,
        dueDate: options.dates.dueDate,
        beneficiaryId: options.beneficiaryId,
        beneficiaryName: options.beneficiary?.name ?? null,
        beneficiaryPhone: options.beneficiary?.phone ?? null,
        beneficiaryAddress: options.beneficiary?.address ?? null,
        beneficiaryRegistrationNumber: options.beneficiary?.registrationNumber ?? null,
        currencyCode: options.currency.code,
        currencySymbol: options.currency.symbol,
        currencyDecimals: options.currency.decimals,
        subtotalMinor: BigInt(options.total.subtotalMinor),
        lineDiscountsMinor: BigInt(options.total.lineDiscountsMinor),
        invoiceDiscountMinor: BigInt(options.total.invoiceDiscountMinor),
        discountTotalMinor: BigInt(options.total.discountTotalMinor),
        taxableTotalMinor: BigInt(options.total.taxableTotalMinor),
        taxTotalMinor: BigInt(options.total.taxTotalMinor),
        grandTotalMinor: BigInt(options.total.grandTotalMinor),
        remainingMinor: BigInt(options.total.remainingMinor),
        notes: options.input.notes,
        paymentTerms: options.paymentTerms,
        now: options.now,
        actorId: options.actorId,
      });
}

function issuedAuditChanges(
  before: InvoiceDraftDto | null,
  after: InvoiceDraftDto,
): Record<string, unknown> {
  return {
    ...(before ? invoiceChanges(before, after) : {}),
    invoiceStatus: { before: before?.invoiceStatus ?? null, after: "ISSUED" },
    issuedAt: { before: before?.issuedAt ?? null, after: after.issuedAt },
  };
}

export function createIssuedInvoice(options: { input: unknown; actor: DraftActor; requestId: string;
  connection?: DatabaseConnection; now?: Date; faultInjector?: FaultInjector; auditAppender?: AuditAppender;
  snapshotCapturer?: SnapshotCapturer }): DraftResult {
  let request;
  try { request = parseCreateIssue(options.input); }
  catch (error) { if (error instanceof DraftValidationError) throw validationError(error.fieldErrors); throw error; }
  const connection = options.connection ?? getDatabase();
  const at = options.now ?? new Date(); const now = at.toISOString();
  return withImmediateTransaction(connection.client, () => {
    const repeated = previousIssuedRequest(connection, options.requestId, options.actor.id);
    if (repeated) return { invoice: repeated, warnings: [] };
    const settings = settingsRow(connection, now);
    const dates = validateDates(request.invoice, dateInTimezone(at, settings.timezone), settings.timezone,
      at, options.actor.role, "issue");
    const beneficiary = prepareBeneficiary(connection, request.invoice.beneficiary, "issue");
    const items = prepareItems(connection, request.invoice.items, settings.currencyCode, "issue");
    const currency = { code: settings.currencyCode, symbol: settings.currencySymbol,
      decimals: Number(settings.currencyDecimals) };
    const calculation = calculate(items, currency, "issue");
    const reserved = reserveInvoiceNumber(connection, { prefix: settings.prefix, pattern: settings.pattern,
      sequenceStart: settings.sequenceStart, resetPolicy: settings.resetPolicy, timezone: settings.timezone }, at);
    options.faultInjector?.("afterSequence");
    const beneficiaryId = persistBeneficiary(connection, beneficiary, options.actor.id, now);
    persistProducts(connection, items, currency.code, options.actor.id, now);
    options.faultInjector?.("afterSuggestions");
    const id = ulid();
    insertIssuedInvoice({ connection, id, invoiceNumber: reserved.invoiceNumber, input: request.invoice,
      dates, beneficiary, beneficiaryId, currency, total: calculation.calculated,
      paymentTerms: request.invoice.paymentTerms === undefined ? settings.defaultPaymentTerms : request.invoice.paymentTerms,
      actorId: options.actor.id, now });
    options.faultInjector?.("afterInvoice");
    insertItems(connection, id, items, calculation.lineCalculations, now);
    options.faultInjector?.("afterItems");
    (options.snapshotCapturer ?? capturePrintSnapshot)(connection, { invoiceId: id, capturedAt: now });
    options.faultInjector?.("afterSnapshot");
    options.faultInjector?.("afterStatus");
    const after = toDto(connection, getRequiredInvoice(connection, id));
    const append = options.auditAppender ?? appendAuditEvent;
    append(connection, { eventType: "INVOICE_CREATED", actorUserId: options.actor.id,
      actorDisplayName: options.actor.displayName, invoiceId: id, invoiceNumber: reserved.invoiceNumber,
      entityType: "INVOICE", entityId: id, summary: getMessages().audit.invoiceCreatedIssued,
      changes: { invoiceStatus: { before: null, after: "ISSUED" } }, createdAt: now, requestId: options.requestId });
    append(connection, { eventType: "INVOICE_ISSUED", actorUserId: options.actor.id,
      actorDisplayName: options.actor.displayName, invoiceId: id, invoiceNumber: reserved.invoiceNumber,
      entityType: "INVOICE", entityId: id, summary: getMessages().audit.invoiceIssued,
      changes: issuedAuditChanges(null, after), createdAt: now, requestId: options.requestId });
    options.faultInjector?.("afterAudit");
    return { invoice: after, warnings: dates.warnings };
  });
}

export function issueInvoiceDraft(options: { id: string; input: unknown; actor: DraftActor; requestId: string;
  connection?: DatabaseConnection; now?: Date; faultInjector?: FaultInjector; auditAppender?: AuditAppender;
  snapshotCapturer?: SnapshotCapturer }): DraftResult {
  let request;
  try { request = parseUpdateIssue(options.input); }
  catch (error) { if (error instanceof DraftValidationError) throw validationError(error.fieldErrors); throw error; }
  const connection = options.connection ?? getDatabase();
  const at = options.now ?? new Date(); const now = at.toISOString();
  return withImmediateTransaction(connection.client, () => {
    const repeated = previousIssuedRequest(connection, options.requestId, options.actor.id, options.id);
    if (repeated) return { invoice: repeated, warnings: [] };
    const existing = getRequiredInvoice(connection, options.id);
    if (existing.rowVersion !== BigInt(request.rowVersion)) {
      throw conflictError({ rowVersion: existing.rowVersion.toString() });
    }
    if (existing.invoiceStatus !== "DRAFT" || existing.isArchived === 1n) throw conflictError();
    const before = toDto(connection, existing);
    const settings = settingsRow(connection, now);
    const dates = validateDates(request.invoice, existing.invoiceDate, settings.timezone, at, options.actor.role, "issue");
    const beneficiary = prepareBeneficiary(connection, request.invoice.beneficiary, "issue");
    const items = prepareItems(connection, request.invoice.items, existing.currencyCode, "issue");
    const calculation = calculate(items, { code: existing.currencyCode, symbol: existing.currencySymbol,
      decimals: Number(existing.currencyDecimals) }, "issue");
    const beneficiaryId = persistBeneficiary(connection, beneficiary, options.actor.id, now);
    persistProducts(connection, items, existing.currencyCode, options.actor.id, now);
    options.faultInjector?.("afterSuggestions");
    const total = calculation.calculated;
    const paymentTerms = request.invoice.paymentTerms === undefined ? existing.paymentTerms : request.invoice.paymentTerms;
    const updated = connection.client.prepare(`update invoices set invoice_date=?,due_date=?,beneficiary_id=?,
      beneficiary_name=?,beneficiary_phone=?,beneficiary_address=?,beneficiary_registration_number=?,
      subtotal_minor=?,line_discounts_minor=?,invoice_discount_minor=?,discount_total_minor=?,taxable_total_minor=?,
      tax_total_minor=?,grand_total_minor=?,remaining_minor=?,notes=?,payment_terms=?,updated_at=?,updated_by=?,
      row_version=row_version+1
      where id=? and row_version=? and invoice_status='DRAFT' and is_archived=0`).run(
        dates.invoiceDate, dates.dueDate, beneficiaryId, beneficiary?.name ?? null, beneficiary?.phone ?? null,
        beneficiary?.address ?? null, beneficiary?.registrationNumber ?? null, BigInt(total.subtotalMinor),
        BigInt(total.lineDiscountsMinor), BigInt(total.invoiceDiscountMinor), BigInt(total.discountTotalMinor),
        BigInt(total.taxableTotalMinor), BigInt(total.taxTotalMinor), BigInt(total.grandTotalMinor),
        BigInt(total.remainingMinor), request.invoice.notes, paymentTerms, now, options.actor.id,
        options.id, request.rowVersion);
    if (updated.changes !== 1) throw conflictError();
    options.faultInjector?.("afterInvoice");
    connection.client.prepare("delete from invoice_items where invoice_id=?").run(options.id);
    insertItems(connection, options.id, items, calculation.lineCalculations, now);
    options.faultInjector?.("afterItems");
    (options.snapshotCapturer ?? capturePrintSnapshot)(connection, { invoiceId: options.id, capturedAt: now });
    options.faultInjector?.("afterSnapshot");
    const issued = connection.client.prepare(`update invoices set invoice_status='ISSUED',issued_at=?,issued_by=?
      where id=? and row_version=? and invoice_status='DRAFT' and is_archived=0`).run(
        now, options.actor.id, options.id, request.rowVersion + 1,
      );
    if (issued.changes !== 1) throw conflictError();
    options.faultInjector?.("afterStatus");
    const after = toDto(connection, getRequiredInvoice(connection, options.id));
    (options.auditAppender ?? appendAuditEvent)(connection, { eventType: "INVOICE_ISSUED",
      actorUserId: options.actor.id, actorDisplayName: options.actor.displayName, invoiceId: options.id,
      invoiceNumber: existing.invoiceNumber, entityType: "INVOICE", entityId: options.id,
      summary: getMessages().audit.invoiceIssued, changes: issuedAuditChanges(before, after),
      createdAt: now, requestId: options.requestId });
    options.faultInjector?.("afterAudit");
    return { invoice: after, warnings: dates.warnings };
  });
}
